import * as vscode from 'vscode';
import { DqlResult } from './dqlExecutor';

export class ResultsPanel {
    public static currentPanel: ResultsPanel | undefined;
    private static readonly viewType = 'dctmResults';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    public static createOrShow(extensionUri: vscode.Uri, results: DqlResult): void {
        const column = vscode.ViewColumn.Beside;

        if (ResultsPanel.currentPanel) {
            ResultsPanel.currentPanel.panel.reveal(column);
            ResultsPanel.currentPanel.update(results);
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ResultsPanel.viewType,
            'DQL Results',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ResultsPanel.currentPanel = new ResultsPanel(panel, extensionUri);
        ResultsPanel.currentPanel.update(results);
    }

    private update(results: DqlResult): void {
        this.panel.title = `DQL Results (${results.rowCount} rows)`;
        this.panel.webview.html = this.getHtmlForWebview(results);
    }

    private getHtmlForWebview(results: DqlResult): string {
        const tableRows = results.rows.map(row => {
            const cells = results.columns.map(col => {
                const value = row[col];
                const displayValue = value === null || value === undefined
                    ? '<span class="null">NULL</span>'
                    : this.escapeHtml(String(value));
                return `<td>${displayValue}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        const headerCells = results.columns.map(col =>
            `<th>${this.escapeHtml(col)}</th>`
        ).join('');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DQL Results</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 10px;
            margin: 0;
        }
        .info {
            margin-bottom: 10px;
            padding: 8px;
            background-color: var(--vscode-textBlockQuote-background);
            border-radius: 4px;
        }
        .info span {
            margin-right: 20px;
        }
        .query {
            font-family: var(--vscode-editor-font-family);
            background-color: var(--vscode-textCodeBlock-background);
            padding: 8px;
            border-radius: 4px;
            margin-bottom: 10px;
            white-space: pre-wrap;
            overflow-x: auto;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            font-size: 12px;
        }
        th {
            position: sticky;
            top: 0;
            background-color: var(--vscode-editor-background);
            border-bottom: 2px solid var(--vscode-panel-border);
            text-align: left;
            padding: 8px 6px;
            font-weight: 600;
        }
        td {
            border-bottom: 1px solid var(--vscode-panel-border);
            padding: 6px;
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        tr:hover td {
            background-color: var(--vscode-list-hoverBackground);
        }
        .null {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .actions {
            margin-top: 10px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 14px;
            border-radius: 2px;
            cursor: pointer;
            margin-right: 8px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
    </style>
</head>
<body>
    <div class="info">
        <span><strong>Rows:</strong> ${results.rowCount}</span>
        <span><strong>Time:</strong> ${results.executionTime}ms</span>
        <span><strong>Columns:</strong> ${results.columns.length}</span>
    </div>
    <div class="query">${this.escapeHtml(results.query)}</div>
    <div class="table-container">
        <table>
            <thead>
                <tr>${headerCells}</tr>
            </thead>
            <tbody>
                ${tableRows}
            </tbody>
        </table>
    </div>
    <div class="actions">
        <button onclick="exportCsv()">Export CSV</button>
        <button onclick="copyToClipboard()">Copy All</button>
    </div>
    <script>
        const vscode = acquireVsCodeApi();
        const results = ${JSON.stringify(results)};

        function exportCsv() {
            const header = results.columns.join(',');
            const rows = results.rows.map(row =>
                results.columns.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return '';
                    const str = String(val);
                    if (str.includes(',') || str.includes('"') || str.includes('\\n')) {
                        return '"' + str.replace(/"/g, '""') + '"';
                    }
                    return str;
                }).join(',')
            );
            const csv = [header, ...rows].join('\\n');
            vscode.postMessage({ type: 'export', format: 'csv', data: csv });
        }

        function copyToClipboard() {
            const header = results.columns.join('\\t');
            const rows = results.rows.map(row =>
                results.columns.map(col => row[col] ?? '').join('\\t')
            );
            const text = [header, ...rows].join('\\n');
            navigator.clipboard.writeText(text);
        }
    </script>
</body>
</html>`;
    }

    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose(): void {
        ResultsPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) {
                d.dispose();
            }
        }
    }
}
