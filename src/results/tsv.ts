export function toTsvRow(columns: string[], row: Record<string, unknown>): string {
    return columns.map(col => String(row[col] ?? '')).join('\t');
}

export function toTsv(columns: string[], rows: Record<string, unknown>[]): string {
    return [columns.join('\t'), ...rows.map(row => toTsvRow(columns, row))].join('\n');
}
