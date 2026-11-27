import type { ApiMethodRequest } from '../apiExecutor';

export type OutputFormat = 'html' | 'json';

export type DmApiCallType = 'get' | 'exec' | 'set';

export interface DmApiCommand {
    callType: DmApiCallType;
    args: string;
    value?: string;
}

// Lines break only at a newline outside quotes, so trimming and dropping blank lines never
// touch the text of a multi-line string literal.
export function stripComments(code: string, includeBlockComments: boolean = false): string {
    const lines: string[] = [];
    let line = '';
    let quote: string | null = null;
    let i = 0;

    while (i < code.length) {
        const ch = code[i];

        if (quote) {
            if (ch === quote) {
                quote = null;
            }
            line += ch;
            i++;
        } else if (ch === "'" || ch === '"') {
            quote = ch;
            line += ch;
            i++;
        } else if (ch === '\n') {
            lines.push(line.trim());
            line = '';
            i++;
        } else if (code.startsWith('--', i)) {
            const lineEnd = code.indexOf('\n', i);
            i = lineEnd === -1 ? code.length : lineEnd;
        } else if (includeBlockComments && code.startsWith('/*', i)) {
            const blockEnd = code.indexOf('*/', i + 2);
            if (blockEnd === -1) {
                line += '/*';
                i += 2;
            } else {
                i = blockEnd + 2;
            }
        } else {
            line += ch;
            i++;
        }
    }
    // An unclosed string runs to the end of the text, which is kept as typed.
    lines.push(quote ? line.trimStart() : line.trim());

    return lines.filter(l => l.length > 0).join('\n');
}

export function parseDmApiCommand(command: string): DmApiCommand | null {
    const match = command.match(/^dmAPI(Get|Exec|Set)\s*\(\s*(["'])(.+?)\2(?:\s*,\s*(["'])(.*?)\4)?\s*\)$/i);
    if (!match) {
        return null;
    }
    const callType = match[1].toLowerCase() as DmApiCallType;
    const value = match[5];
    if (value === undefined) {
        return { callType, args: match[3] };
    }
    return callType === 'set' ? { callType, args: match[3], value } : null;
}

export function parseApiCommand(command: string): ApiMethodRequest {
    const parts = command.trim().split(/\s+/);
    return {
        method: parts[0],
        args: parts.slice(1)
    };
}

export function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
    }
    return String(value);
}

export function getOutputFormat(metadata?: { [key: string]: unknown }): OutputFormat {
    return metadata?.outputFormat === 'json' ? 'json' : 'html';
}

export function nextOutputFormat(format: OutputFormat): OutputFormat {
    return format === 'html' ? 'json' : 'html';
}
