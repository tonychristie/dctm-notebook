import type { ApiMethodRequest } from '../apiExecutor';

export type OutputFormat = 'html' | 'json';

export type DmApiCallType = 'get' | 'exec' | 'set';

export interface DmApiCommand {
    callType: DmApiCallType;
    args: string;
}

export function stripComments(code: string, includeBlockComments: boolean = false): string {
    let stripped = code;

    if (includeBlockComments) {
        stripped = stripped.replace(/\/\*[\s\S]*?\*\//g, '');
    }

    stripped = stripped.replace(/--.*$/gm, '');

    return stripped
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0)
        .join('\n')
        .trim();
}

export function parseDmApiCommand(command: string): DmApiCommand | null {
    const match = command.match(/^dmAPI(Get|Exec|Set)\s*\(\s*["'](.+?)["']\s*\)$/i);
    if (!match) {
        return null;
    }
    return {
        callType: match[1].toLowerCase() as DmApiCallType,
        args: match[2]
    };
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
