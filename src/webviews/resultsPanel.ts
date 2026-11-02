import { onActions, readWebviewData, vscode } from './common';

interface Results {
    columns: string[];
    rows: Record<string, unknown>[];
}

const results = readWebviewData<Results>();

onActions({
    exportCsv: () => {
        vscode.postMessage({ command: 'exportCsv' });
    },
    copyAll: () => {
        const header = results.columns.join('\t');
        const rows = results.rows.map(row => results.columns.map(col => row[col] ?? '').join('\t'));
        navigator.clipboard.writeText([header, ...rows].join('\n'));
    }
});
