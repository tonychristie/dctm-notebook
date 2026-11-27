import * as vscode from 'vscode';
import { ConnectionManager, DocumentumConnection, StorageScope } from './connectionManager';
import { ConnectionForm, formToConnection } from './connectionForm';
import { webviewAssets, webviewData, webviewResourceRoots } from './webviewHtml';

export interface ConnectionsPanelData {
    connections: DocumentumConnection[];
    scope: StorageScope;
    newConnection: boolean;
}

type WebviewMessage =
    | { type: 'save'; originalName?: string; form: ConnectionForm }
    | { type: 'delete'; name: string }
    | { type: 'test'; form: ConnectionForm }
    | { type: 'openSettingsJson' };

interface ManageConnectionsOptions {
    newConnection?: boolean;
}

export type ConnectionSettingsSource = Pick<
    ConnectionManager,
    'storedConnections' | 'saveConnections' | 'requestCredentials' | 'testConnection'
>;

export class ConnectionSettingsHandler {
    constructor(
        private readonly connectionManager: ConnectionSettingsSource,
        private readonly post: (message: unknown) => void,
        private readonly confirmDelete: (message: string) => Thenable<boolean>,
        private readonly notify: (message: string) => void
    ) {}

    async save(originalName: string | undefined, connection: DocumentumConnection): Promise<void> {
        const connections = [...this.connectionManager.storedConnections()];
        const index = originalName === undefined ? -1 : connections.findIndex(c => c.name === originalName);
        if (index >= 0) {
            connections[index] = connection;
        } else {
            connections.push(connection);
        }

        await this.connectionManager.saveConnections(connections);

        if (originalName !== undefined && originalName !== connection.name) {
            this.notify(
                `Notebooks and DQL files bound or linked to "${originalName}" must be bound or linked to "${connection.name}" again.`
            );
        }
    }

    async delete(name: string): Promise<void> {
        const confirmed = await this.confirmDelete(
            `Delete connection "${name}"? Notebooks and DQL files bound or linked to it must be bound or linked to another connection.`
        );
        if (!confirmed) {
            return;
        }

        const connections = this.connectionManager.storedConnections().filter(c => c.name !== name);
        await this.connectionManager.saveConnections(connections);
    }

    async test(connection: DocumentumConnection): Promise<void> {
        const credentials = await this.connectionManager.requestCredentials(connection);
        if (!credentials) {
            this.post({ type: 'testResult' });
            return;
        }

        try {
            await this.connectionManager.testConnection(connection, credentials);
            this.post({
                type: 'testResult',
                success: true,
                message: `Connected to ${connection.repository} as ${credentials.username}.`
            });
        } catch (error) {
            this.post({
                type: 'testResult',
                success: false,
                message: error instanceof Error ? error.message : String(error)
            });
        }
    }
}

export class ConnectionsPanel {
    private static currentPanel: ConnectionsPanel | undefined;
    private static readonly viewType = 'dctmConnectionsPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly connectionManager: ConnectionManager;
    private readonly settings: ConnectionSettingsHandler;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        newConnection: boolean
    ) {
        this.panel = panel;
        this.connectionManager = connectionManager;
        this.settings = new ConnectionSettingsHandler(
            connectionManager,
            message => void this.panel.webview.postMessage(message),
            async message => await vscode.window.showWarningMessage(message, { modal: true }, 'Delete') === 'Delete',
            message => void vscode.window.showInformationMessage(message)
        );

        this.panel.webview.html = this.getHtmlForWebview(extensionUri, newConnection);

        this.panel.webview.onDidReceiveMessage(
            (message: WebviewMessage) => this.handleMessage(message),
            null,
            this.disposables
        );
        this.disposables.push(connectionManager.onDidChangeConnections(() => this.postConnections()));
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    static createOrShow(extensionUri: vscode.Uri, connectionManager: ConnectionManager, newConnection: boolean): void {
        if (ConnectionsPanel.currentPanel) {
            ConnectionsPanel.currentPanel.panel.reveal(vscode.ViewColumn.Active);
            if (newConnection) {
                ConnectionsPanel.currentPanel.panel.webview.postMessage({ type: 'newConnection' });
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ConnectionsPanel.viewType,
            'Documentum Connections',
            vscode.ViewColumn.Active,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewResourceRoots(extensionUri)
            }
        );

        ConnectionsPanel.currentPanel = new ConnectionsPanel(panel, extensionUri, connectionManager, newConnection);
    }

    private postConnections(): void {
        this.panel.webview.postMessage({
            type: 'connections',
            connections: this.connectionManager.getConnections(),
            scope: this.connectionManager.storageScope()
        });
    }

    private async handleMessage(message: WebviewMessage): Promise<void> {
        try {
            switch (message.type) {
                case 'save':
                    await this.settings.save(message.originalName, formToConnection(message.form));
                    break;
                case 'delete':
                    await this.settings.delete(message.name);
                    break;
                case 'test':
                    await this.settings.test(formToConnection(message.form));
                    break;
                case 'openSettingsJson':
                    await vscode.commands.executeCommand(
                        this.connectionManager.storageScope() === 'workspace'
                            ? 'workbench.action.openWorkspaceSettingsFile'
                            : 'workbench.action.openSettingsJson'
                    );
                    break;
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Connection settings could not be saved: ${text}`);
        }
    }

    private getHtmlForWebview(extensionUri: vscode.Uri, newConnection: boolean): string {
        const assets = webviewAssets(this.panel.webview, extensionUri, 'connectionsPanel');
        const data: ConnectionsPanelData = {
            connections: this.connectionManager.getConnections(),
            scope: this.connectionManager.storageScope(),
            newConnection
        };

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${assets.csp}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Documentum Connections</title>
    <style>
        * {
            box-sizing: border-box;
        }
        body {
            font-family: var(--vscode-font-family);
            font-size: var(--vscode-font-size);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            padding: 16px;
            margin: 0;
        }
        h2 {
            margin-top: 0;
            font-size: 16px;
            font-weight: 600;
            border-bottom: 1px solid var(--vscode-panel-border);
            padding-bottom: 8px;
        }
        .layout {
            display: flex;
            gap: 24px;
            align-items: flex-start;
        }
        .list-column {
            flex: 0 0 320px;
        }
        .form-column {
            flex: 1;
            max-width: 520px;
        }
        .storage {
            margin-bottom: 8px;
        }
        .storage a {
            color: var(--vscode-textLink-foreground);
            cursor: pointer;
            margin-left: 8px;
        }
        .storage a:hover {
            color: var(--vscode-textLink-activeForeground);
        }
        .connection-list {
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            max-height: 420px;
            overflow-y: auto;
        }
        .connection-item {
            padding: 6px 10px;
            cursor: pointer;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .connection-item:last-child {
            border-bottom: none;
        }
        .connection-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .connection-item.selected {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .connection-name {
            font-weight: 500;
        }
        .connection-type {
            font-size: 11px;
            margin-left: 8px;
            text-transform: uppercase;
        }
        .connection-detail {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .connection-item.selected .connection-detail {
            color: inherit;
        }
        label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
        }
        input, select {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        input:focus, select:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        .input-group {
            margin-bottom: 12px;
        }
        button {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 8px 16px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 13px;
        }
        button:hover {
            background-color: var(--vscode-button-hoverBackground);
        }
        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }
        button.secondary {
            background-color: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button.secondary:hover {
            background-color: var(--vscode-button-secondaryHoverBackground);
        }
        .actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
        }
        .success {
            color: var(--vscode-testing-iconPassed);
        }
        .error {
            color: var(--vscode-testing-iconFailed);
            font-size: 12px;
        }
        .info {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .test-result {
            margin-top: 12px;
            white-space: pre-wrap;
        }
    </style>
</head>
<body ${webviewData(data)}>
    <h2>Documentum Connections</h2>

    <div class="layout">
        <div class="list-column">
            <div class="storage info">
                Stored in <span id="storageScope"></span>
                <a data-action="openSettingsJson">Open settings.json</a>
            </div>
            <div class="connection-list" id="connectionList"></div>
            <div class="actions">
                <button class="secondary" data-action="add">Add</button>
                <button class="secondary" id="duplicateBtn" data-action="duplicate">Duplicate</button>
                <button class="secondary" id="deleteBtn" data-action="delete">Delete</button>
            </div>
        </div>

        <form class="form-column" id="connectionForm" novalidate>
            <div class="input-group">
                <label for="name">Name</label>
                <input type="text" id="name" name="name">
                <div class="error" id="nameError"></div>
            </div>
            <div class="input-group">
                <label for="type">Type</label>
                <select id="type" name="type">
                    <option value="dfc">DFC</option>
                    <option value="rest">REST</option>
                </select>
            </div>
            <div class="input-group" data-for-type="dfc">
                <label for="docbroker">Docbroker</label>
                <input type="text" id="docbroker" name="docbroker">
                <div class="error" id="docbrokerError"></div>
            </div>
            <div class="input-group" data-for-type="dfc">
                <label for="port">Port</label>
                <input type="text" id="port" name="port">
                <div class="error" id="portError"></div>
            </div>
            <div class="input-group" data-for-type="rest">
                <label for="endpoint">Endpoint URL</label>
                <input type="text" id="endpoint" name="endpoint" placeholder="http://host:8080/dctm-rest">
                <div class="error" id="endpointError"></div>
            </div>
            <div class="input-group">
                <label for="repository">Repository</label>
                <input type="text" id="repository" name="repository">
                <div class="error" id="repositoryError"></div>
            </div>
            <div class="input-group">
                <label for="username">Username</label>
                <input type="text" id="username" name="username">
                <span class="info">Optional. When empty, the username is asked for on connect.</span>
            </div>
            <div class="actions">
                <button type="button" id="saveBtn" data-action="save">Save</button>
                <button type="button" class="secondary" data-action="cancel">Cancel</button>
                <button type="button" class="secondary" id="testBtn" data-action="test">Test Connection</button>
            </div>
            <div class="test-result" id="testResult"></div>
        </form>
    </div>

    ${assets.script}
</body>
</html>`;
    }

    private dispose(): void {
        ConnectionsPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

export function registerConnectionsPanel(context: vscode.ExtensionContext, connectionManager: ConnectionManager): void {
    context.subscriptions.push(vscode.commands.registerCommand(
        'dctm.manageConnections',
        (options?: ManageConnectionsOptions) => {
            ConnectionsPanel.createOrShow(context.extensionUri, connectionManager, options?.newConnection === true);
        }
    ));
}
