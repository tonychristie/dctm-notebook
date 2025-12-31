import * as vscode from 'vscode';
import { ApiMethodReference, ServerApiMethod } from '../apiMethodReference';

/**
 * Parsed dmAPI signature information
 */
interface ParsedSignature {
    apiType: 'Exec' | 'Get' | 'Set';
    methodName: string;
    parameters: ParsedParameter[];
}

/**
 * Parsed parameter from signature
 */
interface ParsedParameter {
    name: string;
    optional: boolean;
    alternatives?: string[]; // For parameters like "default|policy_id"
}

/**
 * Enhanced completion provider for dmAPI methods in notebooks
 *
 * Provides progressive parameter guidance:
 * - After dmAPIGet(" -> show available methods
 * - After dmAPIGet("dump, -> prompt for session
 * - After dmAPIGet("dump,session, -> prompt for object_id
 */
export class NotebookApiCompletionProvider implements vscode.CompletionItemProvider {
    private reference: ApiMethodReference;
    private signatureCache: Map<string, ParsedSignature> = new Map();

    constructor(reference: ApiMethodReference) {
        this.reference = reference;
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);

        // Match dmAPI patterns with parameters
        // dmAPIGet("method,param1,param2,...
        const apiCallMatch = beforeCursor.match(
            /dmAPI(Exec|Get|Set)\s*\(\s*["']([^"']*?)$/i
        );

        if (!apiCallMatch) {
            return [];
        }

        const apiType = apiCallMatch[1] as 'Exec' | 'Get' | 'Set';
        const content = apiCallMatch[2];
        const parts = content.split(',');

        // First part is the method name
        if (parts.length === 1) {
            // Still typing the method name
            return this.getMethodCompletions(parts[0], apiType.toLowerCase() as 'exec' | 'get' | 'set');
        }

        // Have method name, provide parameter completions
        const methodName = parts[0].trim();
        const paramIndex = parts.length - 1; // 0-indexed, skip method name
        const currentText = parts[parts.length - 1];

        return this.getParameterCompletions(methodName, paramIndex, currentText, apiType);
    }

    /**
     * Get completions for method names
     */
    private getMethodCompletions(
        prefix: string,
        category: 'exec' | 'get' | 'set'
    ): vscode.CompletionItem[] {
        return this.reference.getCompletionItems(prefix, category);
    }

    /**
     * Get completions for method parameters
     */
    private getParameterCompletions(
        methodName: string,
        paramIndex: number,
        currentText: string,
        apiType: 'Exec' | 'Get' | 'Set'
    ): vscode.CompletionItem[] {
        const method = this.reference.findMethod(methodName);
        if (!method) {
            return [];
        }

        const signature = this.parseSignature(method, apiType);
        if (!signature || paramIndex > signature.parameters.length) {
            return [];
        }

        // Parameter index is 1-based in the signature (0 is method name)
        // paramIndex 1 = first parameter after method name
        const param = signature.parameters[paramIndex - 1];

        if (!param) {
            // No more parameters expected
            return this.getEndQuoteCompletion();
        }

        const items: vscode.CompletionItem[] = [];

        // Add parameter hint as top completion
        const hintItem = new vscode.CompletionItem(
            param.name,
            vscode.CompletionItemKind.Variable
        );
        hintItem.detail = param.optional ? `(optional) ${param.name}` : `(required) ${param.name}`;
        hintItem.documentation = this.getParameterDocumentation(param, signature, paramIndex);
        hintItem.sortText = '0';
        hintItem.insertText = ''; // Don't insert, just show as hint
        items.push(hintItem);

        // Add common values based on parameter name
        const valueItems = this.getCommonParameterValues(param, currentText);
        items.push(...valueItems);

        // Add "session" placeholder for session parameters
        if (param.name === 'session' || param.name.includes('session')) {
            const sessionItem = new vscode.CompletionItem(
                'session',
                vscode.CompletionItemKind.Keyword
            );
            sessionItem.detail = 'Use active session';
            sessionItem.insertText = 'session';
            sessionItem.sortText = '1';
            items.push(sessionItem);
        }

        return items;
    }

    /**
     * Parse method signature into structured format
     */
    private parseSignature(method: ServerApiMethod, apiType: 'Exec' | 'Get' | 'Set'): ParsedSignature | null {
        const cacheKey = `${method.name}_${apiType}`;
        const cached = this.signatureCache.get(cacheKey);
        if (cached) {
            return cached;
        }

        // Parse signature like: dmAPIExec("method,session,param1[,optional_param]")
        const sigMatch = method.signature.match(/dmAPI\w+\s*\(\s*["']([^"']+)["']\s*\)/);
        if (!sigMatch) {
            return null;
        }

        const sigContent = sigMatch[1];
        const parts = this.splitSignature(sigContent);

        const parameters: ParsedParameter[] = [];

        // Skip first part (method name)
        for (let i = 1; i < parts.length; i++) {
            const part = parts[i];
            const optional = part.startsWith('[') || part.endsWith(']');
            const cleanPart = part.replace(/[[\]{}]/g, '').trim();

            // Handle alternatives like "default|policy_id"
            const alternatives = cleanPart.includes('|')
                ? cleanPart.split('|').map(s => s.trim())
                : undefined;

            parameters.push({
                name: alternatives ? alternatives[0] : cleanPart,
                optional,
                alternatives
            });
        }

        const result: ParsedSignature = {
            apiType,
            methodName: method.name,
            parameters
        };

        this.signatureCache.set(cacheKey, result);
        return result;
    }

    /**
     * Split signature content respecting brackets
     */
    private splitSignature(sig: string): string[] {
        const parts: string[] = [];
        let current = '';
        let bracketDepth = 0;

        for (const char of sig) {
            if (char === '[' || char === '{') {
                bracketDepth++;
                current += char;
            } else if (char === ']' || char === '}') {
                bracketDepth--;
                current += char;
            } else if (char === ',' && bracketDepth === 0) {
                parts.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }

        if (current.trim()) {
            parts.push(current.trim());
        }

        return parts;
    }

    /**
     * Get documentation for a parameter
     */
    private getParameterDocumentation(
        param: ParsedParameter,
        signature: ParsedSignature,
        paramIndex: number
    ): vscode.MarkdownString {
        const md = new vscode.MarkdownString();

        md.appendMarkdown(`**Parameter ${paramIndex}:** \`${param.name}\`\n\n`);

        if (param.optional) {
            md.appendMarkdown('*Optional*\n\n');
        }

        if (param.alternatives && param.alternatives.length > 1) {
            md.appendMarkdown('Accepts: ');
            md.appendMarkdown(param.alternatives.map(a => `\`${a}\``).join(' | '));
            md.appendMarkdown('\n\n');
        }

        // Show full signature for context
        md.appendMarkdown('---\n\n');
        md.appendMarkdown(`\`${signature.methodName}\` parameters:\n`);
        signature.parameters.forEach((p, i) => {
            const marker = i === paramIndex - 1 ? '**→** ' : '   ';
            const opt = p.optional ? ' (optional)' : '';
            md.appendMarkdown(`${marker}\`${p.name}\`${opt}\n`);
        });

        return md;
    }

    /**
     * Get common values for known parameter types
     */
    private getCommonParameterValues(
        param: ParsedParameter,
        _currentText: string
    ): vscode.CompletionItem[] {
        const items: vscode.CompletionItem[] = [];

        // Add alternatives if defined
        if (param.alternatives) {
            param.alternatives.forEach((alt, index) => {
                const item = new vscode.CompletionItem(
                    alt,
                    vscode.CompletionItemKind.Value
                );
                item.sortText = `2${index}`;
                items.push(item);
            });
        }

        // Add common values based on parameter name patterns
        const name = param.name.toLowerCase();

        if (name.includes('format')) {
            ['pdf', 'msw12', 'crtext', 'html', 'xml'].forEach((format, i) => {
                const item = new vscode.CompletionItem(format, vscode.CompletionItemKind.Value);
                item.sortText = `3${i}`;
                items.push(item);
            });
        }

        if (name.includes('type') && !name.includes('content')) {
            ['dm_document', 'dm_folder', 'dm_sysobject', 'dm_cabinet'].forEach((type, i) => {
                const item = new vscode.CompletionItem(type, vscode.CompletionItemKind.Class);
                item.sortText = `3${i}`;
                items.push(item);
            });
        }

        if (name === 'flag' || name.includes('_flag')) {
            ['T', 'F', '0', '1'].forEach((val, i) => {
                const item = new vscode.CompletionItem(val, vscode.CompletionItemKind.Constant);
                item.sortText = `3${i}`;
                items.push(item);
            });
        }

        return items;
    }

    /**
     * Get completion to close the API call
     */
    private getEndQuoteCompletion(): vscode.CompletionItem[] {
        const item = new vscode.CompletionItem(
            '")',
            vscode.CompletionItemKind.Snippet
        );
        item.detail = 'Close API call';
        item.insertText = '")';
        return [item];
    }
}

/**
 * Register notebook-specific completion providers
 */
export function registerNotebookCompletions(
    context: vscode.ExtensionContext,
    reference: ApiMethodReference
): void {
    const provider = new NotebookApiCompletionProvider(reference);

    // Register for dmapi language in notebooks
    const disposable = vscode.languages.registerCompletionItemProvider(
        [
            { language: 'dmapi' },
            { language: 'dql' }
        ],
        provider,
        '"', "'", ',' // Trigger on quote and comma
    );

    context.subscriptions.push(disposable);
}
