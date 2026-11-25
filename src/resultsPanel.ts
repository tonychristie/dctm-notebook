import * as vscode from 'vscode';
import { DqlResult } from './dqlExecutor';
import { escapeHtml } from './htmlUtils';
import { exportToExcel, exportToJson } from './notebook/exporter';
import type { ConnectionWorkspaces } from './workspace/connectionWorkspace';
import { webviewAssets, webviewData, webviewResourceRoots, webviewStylesheet } from './webviewHtml';

export type ResultsWorkspaces = Pick<ConnectionWorkspaces, 'showDump'>;

export interface ResultsExporter {
    exportToExcel(columns: string[], rows: Record<string, unknown>[]): Promise<void>;
    exportToJson(columns: string[], rows: Record<string, unknown>[]): Promise<void>;
}

export type ResultsPanelMessage =
    | { command: 'dumpObject'; objectId: string }
    | { command: 'exportData'; data: { format: 'excel' | 'json'; columns: string[]; rows: Record<string, unknown>[] } };

export async function handleResultsMessage(
    message: ResultsPanelMessage,
    connectionName: string,
    workspaces: ResultsWorkspaces,
    exporter: ResultsExporter = { exportToExcel, exportToJson }
): Promise<void> {
    if (message.command === 'dumpObject') {
        await workspaces.showDump(connectionName, { kind: 'object', objectId: message.objectId });
        return;
    }
    const { format, columns, rows } = message.data;
    await exportRows(format, columns, rows, exporter);
}

export async function exportRows(
    format: 'excel' | 'json',
    columns: string[],
    rows: Record<string, unknown>[],
    exporter: ResultsExporter = { exportToExcel, exportToJson }
): Promise<void> {
    try {
        if (format === 'excel') {
            await exporter.exportToExcel(columns, rows);
        } else {
            await exporter.exportToJson(columns, rows);
        }
    } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Export failed: ${errorMsg}`);
    }
}

export class ResultsPanel {
    public static currentPanel: ResultsPanel | undefined;
    private static readonly viewType = 'dctmResults';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private disposables: vscode.Disposable[] = [];
    private connectionName = '';

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri, workspaces: ResultsWorkspaces) {
        this.panel = panel;
        this.extensionUri = extensionUri;

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        this.panel.webview.onDidReceiveMessage(
            (message: ResultsPanelMessage) => handleResultsMessage(message, this.connectionName, workspaces),
            null,
            this.disposables
        );
    }

    public static createOrShow(
        extensionUri: vscode.Uri,
        connectionName: string,
        results: DqlResult,
        workspaces: ResultsWorkspaces
    ): void {
        const column = vscode.ViewColumn.Beside;

        if (ResultsPanel.currentPanel) {
            ResultsPanel.currentPanel.panel.reveal(column);
            ResultsPanel.currentPanel.update(connectionName, results);
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

        ResultsPanel.currentPanel = new ResultsPanel(panel, extensionUri, workspaces);
        ResultsPanel.currentPanel.update(connectionName, results);
    }

    private update(connectionName: string, results: DqlResult): void {
        this.connectionName = connectionName;
        this.panel.title = `DQL Results (${results.rowCount} rows)`;
        this.panel.webview.html = this.getHtmlForWebview(results);
    }

    private getHtmlForWebview(results: DqlResult): string {
        const webview = this.panel.webview;
        const assets = webviewAssets(webview, this.extensionUri, 'resultsPanel');
        const data = {
            columns: results.columns,
            rows: results.rows,
            rowCount: results.rowCount,
            executionTime: results.executionTime
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${assets.csp}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${webviewStylesheet(webview, this.extensionUri, 'resultsPanel')}
    <title>DQL Results</title>
</head>
<body ${webviewData(data)}>
    <div class="query">${escapeHtml(results.query)}</div>
    <div id="results" class="results"></div>
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
