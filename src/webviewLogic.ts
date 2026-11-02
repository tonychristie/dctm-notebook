import { escapeHtml } from './htmlUtils';

export { formatValue as formatResult } from './notebook/commandParsing';

export function matchesFilter(filter: string, name: string, secondField: string): boolean {
    const lower = filter.toLowerCase();
    return !lower || name.toLowerCase().includes(lower) || secondField.toLowerCase().includes(lower);
}

export function isGroupVisible(isInherited: boolean, showInherited: boolean, visibleCount: number): boolean {
    if (isInherited && !showInherited) {
        return false;
    }
    return visibleCount > 0;
}

export function formatResultWithLinks(text: string): string {
    return escapeHtml(text).replace(/\b([0-9a-f]{16})\b/gi, match =>
        `<span class="object-id" data-object-id="${escapeHtml(match)}">${escapeHtml(match)}</span>`
    );
}
