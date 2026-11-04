import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { escapeHtml } from './htmlUtils';
import { RepositoryConnection } from './repositoryConnection';
import { WebviewEntry, dumpPanelStylesheet, webviewAssets, webviewData, webviewResourceRoots } from './webviewHtml';

export interface DumpPanelConfig {
    viewType: string;
    entry: WebviewEntry;
    title: string;
    noun: string;
}

export type DumpPanelMessage = { command: string } & Record<string, string>;

interface PanelState {
    current: DumpPanelBase<string, unknown> | undefined;
    counter: number;
}

export abstract class DumpPanelBase<TKey extends string, TData> {
    private static readonly states = new Map<string, PanelState>();

    protected readonly panel: vscode.WebviewPanel;
    protected readonly connectionManager: ConnectionManager;
    protected readonly extensionUri: vscode.Uri;
    protected connectionName: string;
    protected currentKey: TKey;
    private readonly config: DumpPanelConfig;
    private latestRequest = 0;
    private readonly disposables: vscode.Disposable[] = [];

    protected static async show<TKey extends string>(
        config: DumpPanelConfig,
        extensionUri: vscode.Uri,
        connectionName: string,
        key: TKey,
        create: (panel: vscode.WebviewPanel) => DumpPanelBase<TKey, unknown>
    ): Promise<void> {
        const column = vscode.window.activeTextEditor?.viewColumn;
        const reuseWindow = vscode.workspace.getConfiguration('documentum.panels').get<boolean>('reuseWindow', false);
        const state = DumpPanelBase.stateFor(config.viewType);

        if (reuseWindow && state.current) {
            state.current.panel.reveal(column);
            await state.current.load(key, connectionName);
            return;
        }

        state.counter++;
        const panelTitle = reuseWindow ? `${config.title}: ${key}` : `${config.title} #${state.counter}: ${key}`;
        const panel = vscode.window.createWebviewPanel(
            config.viewType,
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewResourceRoots(extensionUri)
            }
        );

        const dumpPanel = create(panel);
        if (reuseWindow) {
            state.current = dumpPanel;
        }
        await dumpPanel.load(key, connectionName);
    }

    private static stateFor(viewType: string): PanelState {
        let state = DumpPanelBase.states.get(viewType);
        if (!state) {
            state = { current: undefined, counter: 0 };
            DumpPanelBase.states.set(viewType, state);
        }
        return state;
    }

    protected constructor(
        config: DumpPanelConfig,
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        key: TKey,
        extensionUri: vscode.Uri
    ) {
        this.config = config;
        this.panel = panel;
        this.connectionManager = connectionManager;
        this.connectionName = connectionName;
        this.currentKey = key;
        this.extensionUri = extensionUri;

        this.panel.webview.html = this.loadingHtml();
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
        this.panel.webview.onDidReceiveMessage(
            (message: DumpPanelMessage) => this.onMessage(message),
            null,
            this.disposables
        );
    }

    public async load(key: TKey, connectionName: string, refresh = false): Promise<void> {
        const request = ++this.latestRequest;
        this.currentKey = key;
        this.connectionName = connectionName;
        this.panel.title = `${this.config.title}: ${key}`;
        this.panel.webview.html = this.loadingHtml();

        try {
            const connection = this.connectionManager.getOpenConnection(connectionName);
            if (!connection) {
                throw new Error(`Not connected to ${connectionName}`);
            }
            const data = await this.fetch(connection, key, refresh);
            if (request !== this.latestRequest) {
                return;
            }
            this.onLatestResponse(data, refresh);
            this.panel.webview.html = this.page(this.renderContent(data), webviewData(this.pageData(data)));
        } catch (error) {
            if (request !== this.latestRequest) {
                return;
            }
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.panel.webview.html = this.errorHtml(key, errorMessage);
        }
    }

    protected abstract fetch(connection: RepositoryConnection, key: TKey, refresh: boolean): Promise<TData>;

    protected abstract renderContent(data: TData): string;

    protected abstract pageData(data: TData): unknown;

    protected abstract handleMessage(message: DumpPanelMessage): Promise<void>;

    protected onLatestResponse(_data: TData, _refresh: boolean): void {
    }

    private async onMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'refresh':
                await this.load(this.currentKey, this.connectionName, true);
                break;
            case 'copyValue':
                await vscode.env.clipboard.writeText(message.value);
                vscode.window.showInformationMessage('Value copied to clipboard');
                break;
            default:
                await this.handleMessage(message);
        }
    }

    private page(body: string, bodyAttributes = ''): string {
        const assets = webviewAssets(this.panel.webview, this.extensionUri, this.config.entry);
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            ${assets.csp}
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            ${dumpPanelStylesheet(this.panel.webview, this.extensionUri)}
        </head>
        <body ${bodyAttributes}>
            ${body}
            ${assets.script}
        </body>
        </html>`;
    }

    private loadingHtml(): string {
        return this.page(`<div class="loader">
                <div class="spinner"></div>
                <div>Loading ${this.config.noun}...</div>
            </div>`);
    }

    private errorHtml(key: TKey, error: string): string {
        return this.page(`<div class="error-page">
                <div class="error">
                    <div class="error-title">Failed to load ${this.config.noun}: ${escapeHtml(key)}</div>
                    <div>${escapeHtml(error)}</div>
                    <button data-action="refresh">Retry</button>
                </div>
            </div>`);
    }

    public dispose(): void {
        const state = DumpPanelBase.states.get(this.config.viewType);
        if (state?.current === this) {
            state.current = undefined;
        }

        this.panel.dispose();

        while (this.disposables.length) {
            this.disposables.pop()?.dispose();
        }
    }
}
