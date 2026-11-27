export type SortDirection = 'asc' | 'desc';

export function sortRows(
    rows: Record<string, unknown>[],
    column: string,
    direction: SortDirection
): Record<string, unknown>[] {
    const sign = direction === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => sign * compareValues(a[column], b[column]));
}

function compareValues(a: unknown, b: unknown): number {
    const aVal = a ?? '';
    const bVal = b ?? '';
    if (typeof aVal === 'number' && typeof bVal === 'number') {
        return aVal - bVal;
    }
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    if (aStr < bStr) {
        return -1;
    }
    return aStr > bStr ? 1 : 0;
}
