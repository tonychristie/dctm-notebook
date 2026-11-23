import type { MethodInfo, ParameterInfo } from './apiExecutor';
import { escapeHtml, isObjectIdLink } from './htmlUtils';

export { formatValue as formatResult } from './notebook/commandParsing';

export function convertParameters(parameters: ParameterInfo[], values: string[]): unknown[] | undefined {
    const args: unknown[] = [];
    for (const [i, parameter] of parameters.entries()) {
        const value = values[i];
        const text = value.trim();
        if (!text) {
            if (parameter.required) {
                return undefined;
            }
            args.push('');
            continue;
        }
        const converted = convertValue(parameter.type, value, text);
        if (converted === undefined) {
            return undefined;
        }
        args.push(converted);
    }
    return args;
}

function convertValue(type: string, value: string, text: string): unknown {
    switch (type) {
        case 'int':
            return /^-?\d+$/.test(text) ? Number(text) : undefined;
        case 'double': {
            const number = Number(text);
            return Number.isFinite(number) ? number : undefined;
        }
        case 'boolean': {
            const lower = text.toLowerCase();
            if (lower === 'true' || lower === 'false') {
                return lower === 'true';
            }
            return undefined;
        }
        default:
            return value;
    }
}

export function matchesFilter(filter: string, name: string, secondField: string): boolean {
    const lower = filter.toLowerCase();
    return !lower || name.toLowerCase().includes(lower) || secondField.toLowerCase().includes(lower);
}

export function filterMethods(
    methods: Record<string, MethodInfo[]>,
    category: string | null,
    search: string
): MethodInfo[] {
    if (search) {
        return Object.values(methods).flat().filter(m => matchesFilter(search, m.name, m.description ?? ''));
    }
    return category ? methods[category] : Object.values(methods).flat();
}

export function isGroupVisible(isInherited: boolean, showInherited: boolean, visibleCount: number): boolean {
    if (isInherited && !showInherited) {
        return false;
    }
    return visibleCount > 0;
}

export function formatResultWithLinks(text: string): string {
    return escapeHtml(text).replace(/\b([0-9a-f]{16})\b/gi, match => isObjectIdLink(match)
        ? `<span class="object-id" data-object-id="${escapeHtml(match)}">${escapeHtml(match)}</span>`
        : match
    );
}
