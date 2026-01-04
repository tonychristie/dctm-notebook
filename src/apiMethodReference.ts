import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * Server API method information from reference data
 */
export interface ServerApiMethod {
    name: string;
    signature: string;
    description: string;
}

/**
 * Server API category
 */
export interface ServerApiCategory {
    description: string;
    methods: ServerApiMethod[];
}

/**
 * Server API reference data structure
 */
export interface ServerApiData {
    description: string;
    categories: {
        exec: ServerApiCategory;
        get: ServerApiCategory;
        set: ServerApiCategory;
    };
}

/**
 * Full API reference data
 */
export interface ApiReferenceData {
    serverApi: ServerApiData;
}

/**
 * Manager for API method reference data
 * Provides autocomplete and hover documentation for dmAPI methods
 */
export class ApiMethodReference {
    private data: ApiReferenceData | null = null;
    private methodsByName: Map<string, ServerApiMethod> = new Map();
    private methodsByCategory: Map<string, ServerApiMethod[]> = new Map();
    private extensionPath: string;

    constructor(extensionPath: string) {
        this.extensionPath = extensionPath;
    }

    /**
     * Load API method reference data from JSON file
     */
    async load(): Promise<void> {
        const dataPath = path.join(this.extensionPath, 'data', 'api-methods.json');

        try {
            const content = await fs.promises.readFile(dataPath, 'utf8');
            this.data = JSON.parse(content) as ApiReferenceData;
            this.buildIndexes();
        } catch (error) {
            console.error('Failed to load API method reference:', error);
            // Continue with empty data - not critical
        }
    }

    /**
     * Build lookup indexes for fast access
     */
    private buildIndexes(): void {
        if (!this.data) {
            return;
        }

        this.methodsByName.clear();
        this.methodsByCategory.clear();

        const categories = this.data.serverApi.categories;

        // Index all categories
        for (const categoryName of ['exec', 'get', 'set'] as const) {
            const methods = categories[categoryName].methods;
            for (const method of methods) {
                this.methodsByName.set(method.name.toLowerCase(), method);
            }
            this.methodsByCategory.set(categoryName, methods);
        }
    }

    /**
     * Check if reference data is loaded
     */
    hasData(): boolean {
        return this.data !== null;
    }

    /**
     * Find method by name (case-insensitive)
     */
    findMethod(name: string): ServerApiMethod | undefined {
        return this.methodsByName.get(name.toLowerCase());
    }

    /**
     * Get all methods in a category
     */
    getMethodsByCategory(category: 'exec' | 'get' | 'set'): ServerApiMethod[] {
        return this.methodsByCategory.get(category) || [];
    }

    /**
     * Get all methods
     */
    getAllMethods(): ServerApiMethod[] {
        return Array.from(this.methodsByName.values());
    }

    /**
     * Search methods by name pattern
     */
    searchMethods(pattern: string): ServerApiMethod[] {
        const lowerPattern = pattern.toLowerCase();
        return this.getAllMethods().filter(m =>
            m.name.toLowerCase().includes(lowerPattern) ||
            m.description.toLowerCase().includes(lowerPattern)
        );
    }

    /**
     * Get completion items for API methods
     * @param prefix Optional prefix to filter method names
     * @param category Optional category to filter by ('exec', 'get', or 'set')
     */
    getCompletionItems(prefix: string = '', category?: 'exec' | 'get' | 'set'): vscode.CompletionItem[] {
        let methods: ServerApiMethod[];

        if (category) {
            // Filter by category first
            methods = this.getMethodsByCategory(category);
            if (prefix) {
                const lowerPrefix = prefix.toLowerCase();
                methods = methods.filter(m =>
                    m.name.toLowerCase().includes(lowerPrefix) ||
                    m.description.toLowerCase().includes(lowerPrefix)
                );
            }
        } else {
            // No category filter - search all methods
            methods = prefix ? this.searchMethods(prefix) : this.getAllMethods();
        }

        return methods.map(method => {
            const item = new vscode.CompletionItem(
                method.name,
                vscode.CompletionItemKind.Method
            );

            item.detail = this.getMethodCategory(method.name);
            item.documentation = new vscode.MarkdownString(
                `**${method.signature}**\n\n${method.description}`
            );
            item.insertText = method.name;

            return item;
        });
    }

    /**
     * Get hover information for a method
     */
    getHoverInfo(methodName: string): vscode.Hover | undefined {
        const method = this.findMethod(methodName);
        if (!method) {
            return undefined;
        }

        const category = this.getMethodCategory(methodName);
        const markdown = new vscode.MarkdownString();

        markdown.appendCodeblock(method.signature, 'dql');
        markdown.appendMarkdown(`\n\n**Category:** ${category}\n\n`);
        markdown.appendMarkdown(method.description);

        return new vscode.Hover(markdown);
    }

    /**
     * Get the category of a method
     */
    private getMethodCategory(methodName: string): string {
        if (!this.data) {
            return 'Unknown';
        }

        const name = methodName.toLowerCase();
        const categoryMap: Record<string, string> = {
            exec: 'dmAPIExec',
            get: 'dmAPIGet',
            set: 'dmAPISet'
        };

        for (const [category, label] of Object.entries(categoryMap)) {
            const methods = this.data.serverApi.categories[category as 'exec' | 'get' | 'set'].methods;
            if (methods.some(m => m.name.toLowerCase() === name)) {
                return label;
            }
        }

        return 'Unknown';
    }
}

/**
 * Completion provider for API methods in DQL and API files
 */
export class ApiMethodCompletionProvider implements vscode.CompletionItemProvider {
    private reference: ApiMethodReference;

    constructor(reference: ApiMethodReference) {
        this.reference = reference;
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken,
        _context: vscode.CompletionContext
    ): vscode.CompletionItem[] {
        // Get the word being typed
        const wordRange = document.getWordRangeAtPosition(position);
        const prefix = wordRange ? document.getText(wordRange) : '';

        // Check if we're in an API command context
        const lineText = document.lineAt(position.line).text;
        const beforeCursor = lineText.substring(0, position.character);

        // Match dmAPI patterns like: dmAPIExec("methodname or dmAPI*("
        // Capture the API type (Exec, Get, Set) to filter completions
        const apiPattern = /dmAPI(Exec|Get|Set)?\s*\(\s*["']?(\w*)$/i;
        const match = beforeCursor.match(apiPattern);

        if (match) {
            // Determine category from API type (if specified)
            let category: 'exec' | 'get' | 'set' | undefined;
            if (match[1]) {
                const apiType = match[1].toLowerCase();
                if (apiType === 'exec' || apiType === 'get' || apiType === 'set') {
                    category = apiType;
                }
            }

            // We're inside an API call - provide method completions filtered by category
            return this.reference.getCompletionItems(match[2] || prefix, category);
        }

        // Also provide completions after common keywords like 'exec', 'api' etc.
        const keywordPattern = /(?:exec|api|execute)\s+(\w*)$/i;
        if (keywordPattern.test(beforeCursor)) {
            return this.reference.getCompletionItems(prefix);
        }

        return [];
    }
}

/**
 * Hover provider for API methods
 */
export class ApiMethodHoverProvider implements vscode.HoverProvider {
    private reference: ApiMethodReference;

    constructor(reference: ApiMethodReference) {
        this.reference = reference;
    }

    provideHover(
        document: vscode.TextDocument,
        position: vscode.Position,
        _token: vscode.CancellationToken
    ): vscode.Hover | undefined {
        const wordRange = document.getWordRangeAtPosition(position);
        if (!wordRange) {
            return undefined;
        }

        const word = document.getText(wordRange);

        // Check if this word is a known API method
        return this.reference.getHoverInfo(word);
    }
}

/**
 * Register API method reference providers
 */
export function registerApiMethodReference(
    context: vscode.ExtensionContext
): ApiMethodReference {
    const reference = new ApiMethodReference(context.extensionPath);

    // Load reference data asynchronously
    reference.load().then(() => {
        if (reference.hasData()) {
            console.log('API method reference data loaded');
        }
    });

    // Register completion provider for DQL and API files
    const completionProvider = new ApiMethodCompletionProvider(reference);
    const completionDisposable = vscode.languages.registerCompletionItemProvider(
        [
            { language: 'dql' },
            { language: 'plaintext', pattern: '**/*.api' }
        ],
        completionProvider,
        '"', "'", '(' // Trigger characters
    );
    context.subscriptions.push(completionDisposable);

    // Register hover provider
    const hoverProvider = new ApiMethodHoverProvider(reference);
    const hoverDisposable = vscode.languages.registerHoverProvider(
        [
            { language: 'dql' },
            { language: 'plaintext', pattern: '**/*.api' }
        ],
        hoverProvider
    );
    context.subscriptions.push(hoverDisposable);

    return reference;
}
