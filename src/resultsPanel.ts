import * as vscode from 'vscode';
import { DqlResult } from './dqlExecutor';
import { escapeHtml } from './htmlUtils';
import { exportToCsv, toTsv } from './notebook/exporter';
import { webviewAssets, webviewResourceRoots } from './webviewHtml';

export class ResultsPanel {
    public static currentPanel: ResultsPanel | undefined;
    private static readonly viewType = 'dctmResults';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private results: DqlResult;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, results: DqlResult) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.results = results;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'exportCsv':
                        try {
                            await exportToCsv(this.results.columns, this.results.rows);
                        } catch (error) {
                            const errorMsg = error instanceof Error ? error.message : String(error);
                            vscode.window.showErrorMessage(`Export failed: ${errorMsg}`);
                        }
                        break;
                    case 'copyAll':
                        await vscode.env.clipboard.writeText(toTsv(this.results.columns, this.results.rows));
                        break;
                }
            },
            null,
            this.disposables
        );
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
                retainContextWhenHidden: true,
                localResourceRoots: webviewResourceRoots(extensionUri)
            }
        );

        ResultsPanel.currentPanel = new ResultsPanel(panel, extensionUri, results);
        ResultsPanel.currentPanel.update(results);
    }

    private update(results: DqlResult): void {
        this.results = results;
        this.panel.title = `DQL Results (${results.rowCount} rows)`;
        this.panel.webview.html = this.getHtmlForWebview(results);
    }

    private getHtmlForWebview(results: DqlResult): string {
        const tableRows = results.rows.map(row => {
            const cells = results.columns.map(col => {
                const value = row[col];
                const displayValue = value === null || value === undefined
                    ? '<span class="null">NULL</span>'
                    : escapeHtml(String(value));
                return `<td>${displayValue}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        const headerCells = results.columns.map(col =>
            `<th>${escapeHtml(col)}</th>`
        ).join('');

        const assets = webviewAssets(this.panel.webview, this.extensionUri, 'resultsPanel');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${assets.csp}
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
    <div class="query">${escapeHtml(results.query)}</div>
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
        <button data-action="exportCsv">Export CSV</button>
        <button data-action="copyAll">Copy All</button>
    </div>
    ${assets.script}
</body>
</html>`;
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
