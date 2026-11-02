import { onActions, readWebviewData, vscode } from './common';

interface Results {
    columns: string[];
    rows: Record<string, unknown>[];
}

const results = readWebviewData<Results>();

function csvCell(value: unknown): string {
    if (value === null || value === undefined) {
        return '';
    }
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

onActions({
    exportCsv: () => {
        const header = results.columns.join(',');
        const rows = results.rows.map(row => results.columns.map(col => csvCell(row[col])).join(','));
        vscode.postMessage({ type: 'export', format: 'csv', data: [header, ...rows].join('\n') });
    },
    copyAll: () => {
        const header = results.columns.join('\t');
        const rows = results.rows.map(row => results.columns.map(col => row[col] ?? '').join('\t'));
        navigator.clipboard.writeText([header, ...rows].join('\n'));
    }
});
