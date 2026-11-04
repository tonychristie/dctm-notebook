import * as vscode from 'vscode';
import { ApiExecutor, ApiMethodResponse, COMMON_DFC_METHODS } from './apiExecutor';
import { ConnectionManager } from './connectionManager';
import { RepositoryConnection } from './repositoryConnection';
import { webviewAssets, webviewData, webviewResourceRoots } from './webviewHtml';

/**
 * Message types from webview to extension
 */
interface WebviewMessage {
    type: 'execute' | 'getMethodInfo' | 'searchMethods' | 'getCategories' | 'dumpObject';
    objectId?: string;
    method?: string;
    args?: unknown[];
    searchQuery?: string;
    category?: string;
}

/**
 * Extract objectId from various argument types (string, ObjectBrowserItem, or node data)
 */
export function extractObjectId(arg: unknown): string | undefined {
    if (typeof arg === 'string') {
        return arg;
    }
    if (arg && typeof arg === 'object') {
        const item = arg as { data?: { objectId?: string } };
        if (item.data && typeof item.data.objectId === 'string') {
            return item.data.objectId;
        }
    }
    return undefined;
}

export function extractConnectionName(arg: unknown): string | undefined {
    if (arg && typeof arg === 'object') {
        const item = arg as { data?: { connectionName?: string } };
        if (item.data && typeof item.data.connectionName === 'string') {
            return item.data.connectionName;
        }
    }
    return undefined;
}

/**
 * Webview panel for executing DFC API methods
 */
export class ApiPanel {
    public static currentPanel: ApiPanel | undefined;
    private static readonly viewType = 'dctmApiPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly apiExecutor: ApiExecutor;
    private readonly connectionManager: ConnectionManager;
    private connectionName: string;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        apiExecutor: ApiExecutor,
        connectionManager: ConnectionManager,
        connectionName: string
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.apiExecutor = apiExecutor;
        this.connectionManager = connectionManager;
        this.connectionName = connectionName;

        this.panel.webview.html = this.getHtmlForWebview();

        // Handle messages from webview
        this.panel.webview.onDidReceiveMessage(
            async (message: WebviewMessage) => {
                await this.handleMessage(message);
            },
            null,
            this.disposables
        );

        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);
    }

    /**
     * Create or show the API panel
     */
    public static createOrShow(
        extensionUri: vscode.Uri,
        apiExecutor: ApiExecutor,
        connectionManager: ConnectionManager,
        connectionName: string,
        objectId?: string
    ): void {
        const column = vscode.ViewColumn.Beside;

        if (ApiPanel.currentPanel) {
            ApiPanel.currentPanel.connectionName = connectionName;
            ApiPanel.currentPanel.panel.title = ApiPanel.title(connectionName);
            ApiPanel.currentPanel.panel.reveal(column);
            if (objectId) {
                ApiPanel.currentPanel.setObjectId(objectId);
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ApiPanel.viewType,
            ApiPanel.title(connectionName),
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewResourceRoots(extensionUri)
            }
        );

        ApiPanel.currentPanel = new ApiPanel(panel, extensionUri, apiExecutor, connectionManager, connectionName);

        if (objectId) {
            ApiPanel.currentPanel.setObjectId(objectId);
        }
    }

    private static title(connectionName: string): string {
        return `DFC API Execution: ${connectionName}`;
    }

    /**
     * Set the object ID in the panel
     */
    private setObjectId(objectId: string): void {
        this.panel.webview.postMessage({
            type: 'setObjectId',
            objectId
        });
    }

    /**
     * Handle messages from the webview
     */
    private async handleMessage(message: WebviewMessage): Promise<void> {
        switch (message.type) {
            case 'execute':
                await this.executeMethod(
                    message.objectId,
                    message.method!,
                    message.args
                );
                break;

            case 'getMethodInfo':
                this.sendMethodInfo(message.method!);
                break;

            case 'searchMethods':
                this.sendSearchResults(message.searchQuery!);
                break;

            case 'getCategories':
                this.sendCategories();
                break;

            case 'dumpObject':
                if (message.objectId) {
                    vscode.commands.executeCommand('dctm.dumpObject', message.objectId, this.connectionName);
                }
                break;
        }
    }

    /**
     * Execute an API method and send result to webview
     */
    private async executeMethod(
        objectId: string | undefined,
        method: string,
        args?: unknown[]
    ): Promise<void> {
        try {
            this.panel.webview.postMessage({
                type: 'executing',
                method
            });

            const connection = this.connectionManager.getOpenConnection(this.connectionName);
            if (!connection) {
                throw new Error(`Not connected to ${this.connectionName}`);
            }

            const response: ApiMethodResponse = await this.apiExecutor.execute({
                objectId,
                method,
                args
            }, connection);

            this.panel.webview.postMessage({
                type: 'result',
                success: true,
                result: response.result,
                resultType: response.resultType,
                executionTimeMs: response.executionTimeMs
            });
        } catch (error) {
            this.panel.webview.postMessage({
                type: 'result',
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    /**
     * Send method info to webview
     */
    private sendMethodInfo(methodName: string): void {
        const methodInfo = this.apiExecutor.findMethod(methodName);
        this.panel.webview.postMessage({
            type: 'methodInfo',
            method: methodInfo
        });
    }

    /**
     * Send search results to webview
     */
    private sendSearchResults(query: string): void {
        const results = this.apiExecutor.searchMethods(query);
        this.panel.webview.postMessage({
            type: 'searchResults',
            results
        });
    }

    /**
     * Send categories to webview
     */
    private sendCategories(): void {
        const categories = this.apiExecutor.getCategories();
        this.panel.webview.postMessage({
            type: 'categories',
            categories,
            methods: COMMON_DFC_METHODS
        });
    }

    /**
     * Get HTML content for the webview
     */
    private getHtmlForWebview(): string {
        const assets = webviewAssets(this.panel.webview, this.extensionUri, 'apiPanel');

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${assets.csp}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>DFC API Execution</title>
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
        h3 {
            font-size: 13px;
            font-weight: 600;
            margin: 16px 0 8px 0;
        }
        .section {
            margin-bottom: 20px;
        }
        label {
            display: block;
            margin-bottom: 4px;
            font-weight: 500;
        }
        input, select, textarea {
            width: 100%;
            padding: 6px 8px;
            border: 1px solid var(--vscode-input-border);
            background-color: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border-radius: 2px;
            font-family: var(--vscode-editor-font-family);
            font-size: 13px;
        }
        input:focus, select:focus, textarea:focus {
            outline: 1px solid var(--vscode-focusBorder);
            border-color: var(--vscode-focusBorder);
        }
        .input-row {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }
        .input-row > * {
            flex: 1;
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
            margin-top: 16px;
        }
        .result-panel {
            margin-top: 20px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            overflow: hidden;
        }
        .result-header {
            background-color: var(--vscode-sideBarSectionHeader-background);
            padding: 8px 12px;
            font-weight: 600;
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .result-content {
            padding: 12px;
            background-color: var(--vscode-textCodeBlock-background);
            font-family: var(--vscode-editor-font-family);
            font-size: 12px;
            max-height: 300px;
            overflow: auto;
            white-space: pre-wrap;
            word-break: break-all;
        }
        .success {
            color: var(--vscode-testing-iconPassed);
        }
        .error {
            color: var(--vscode-testing-iconFailed);
        }
        .info {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
        }
        .method-list {
            max-height: 200px;
            overflow-y: auto;
            border: 1px solid var(--vscode-input-border);
            border-radius: 2px;
            margin-top: 8px;
        }
        .method-item {
            padding: 6px 10px;
            cursor: pointer;
            border-bottom: 1px solid var(--vscode-panel-border);
        }
        .method-item:last-child {
            border-bottom: none;
        }
        .method-item:hover {
            background-color: var(--vscode-list-hoverBackground);
        }
        .method-item.selected {
            background-color: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .method-name {
            font-family: var(--vscode-editor-font-family);
            font-weight: 500;
        }
        .method-return {
            color: var(--vscode-descriptionForeground);
            font-size: 11px;
            margin-left: 8px;
        }
        .method-desc {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            margin-top: 2px;
        }
        .category-tabs {
            display: flex;
            flex-wrap: wrap;
            gap: 4px;
            margin-bottom: 8px;
        }
        .category-tab {
            padding: 4px 10px;
            font-size: 11px;
            border-radius: 12px;
            background-color: var(--vscode-badge-background);
            color: var(--vscode-badge-foreground);
            cursor: pointer;
        }
        .category-tab:hover {
            opacity: 0.8;
        }
        .category-tab.active {
            background-color: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        .param-row {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }
        .param-row label {
            min-width: 120px;
            margin-bottom: 0;
        }
        .param-row input {
            flex: 1;
        }
        .param-type {
            font-size: 11px;
            color: var(--vscode-descriptionForeground);
            min-width: 60px;
        }
        .loading {
            display: flex;
            align-items: center;
            gap: 8px;
            color: var(--vscode-descriptionForeground);
        }
        .spinner {
            width: 16px;
            height: 16px;
            border: 2px solid var(--vscode-progressBar-background);
            border-top-color: transparent;
            border-radius: 50%;
            animation: spin 1s linear infinite;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
        .history {
            margin-top: 20px;
        }
        .history-item {
            padding: 8px;
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            margin-bottom: 8px;
            font-size: 12px;
        }
        .history-item .method {
            font-family: var(--vscode-editor-font-family);
            font-weight: 500;
        }
        .history-item .time {
            color: var(--vscode-descriptionForeground);
            float: right;
        }
        .object-id {
            color: var(--vscode-textLink-foreground);
            text-decoration: underline;
            cursor: pointer;
        }
        .object-id:hover {
            color: var(--vscode-textLink-activeForeground);
        }
    </style>
</head>
<body ${webviewData(COMMON_DFC_METHODS)}>
    <h2>DFC API Execution</h2>

    <div class="section">
        <div class="input-group">
            <label for="objectId">Object ID (r_object_id)</label>
            <input type="text" id="objectId" placeholder="0900000180001234">
            <span class="info">Leave empty for session-level operations. Use Object Browser context menu to pre-fill.</span>
        </div>
    </div>

    <div class="section">
        <h3>Method</h3>
        <div class="input-group">
            <label for="methodSearch">Search Methods</label>
            <input type="text" id="methodSearch" placeholder="Type to search methods...">
        </div>

        <div class="category-tabs" id="categoryTabs"></div>

        <div class="method-list" id="methodList"></div>
    </div>

    <div class="section" id="parametersSection" style="display: none;">
        <h3>Parameters</h3>
        <div id="parameterInputs"></div>
    </div>

    <div class="actions">
        <button id="executeBtn" data-action="execute" disabled>Execute</button>
        <button class="secondary" data-action="clearForm">Clear</button>
    </div>

    <div class="result-panel" id="resultPanel" style="display: none;">
        <div class="result-header">
            <span>Result</span>
            <span id="executionTime" class="info"></span>
        </div>
        <div class="result-content" id="resultContent"></div>
    </div>

    <div class="history" id="historySection" style="display: none;">
        <h3>Execution History</h3>
        <div id="historyList"></div>
    </div>

    ${assets.script}
</body>
</html>`;
    }

    /**
     * Dispose the panel
     */
    public dispose(): void {
        ApiPanel.currentPanel = undefined;
        this.panel.dispose();
        this.disposables.forEach(d => d.dispose());
        this.disposables = [];
    }
}

/**
 * Register the API panel and related commands
 */
export function registerApiPanel(
    context: vscode.ExtensionContext,
    apiExecutor: ApiExecutor,
    connectionManager: ConnectionManager
): void {
    const connectionFor = (arg: unknown): RepositoryConnection | undefined => {
        const name = extractConnectionName(arg);
        return name ? connectionManager.getOpenConnection(name) : connectionManager.getSelectedConnection();
    };

    const openPanel = (arg: unknown, objectId?: string) => {
        const connection = connectionFor(arg);
        if (!connection) {
            vscode.window.showErrorMessage('Not connected to Documentum. Use "Documentum: Connect" first.');
            return;
        }
        ApiPanel.createOrShow(context.extensionUri, apiExecutor, connectionManager, connection.name, objectId);
    };

    // Command to open API panel
    const openApiPanelCommand = vscode.commands.registerCommand(
        'dctm.openApiPanel',
        () => {
            openPanel(undefined);
        }
    );
    context.subscriptions.push(openApiPanelCommand);

    // Command to execute API on selected object
    const executeApiOnObjectCommand = vscode.commands.registerCommand(
        'dctm.executeApiOnObject',
        (arg?: unknown) => {
            openPanel(arg, extractObjectId(arg));
        }
    );
    context.subscriptions.push(executeApiOnObjectCommand);

    // Quick execute common operations
    const checkoutCommand = vscode.commands.registerCommand(
        'dctm.checkout',
        async (arg?: unknown) => {
            const objectId = extractObjectId(arg);
            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionFor(arg);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            try {
                const result = await connection.bridge.checkout(connection.sessionId, objectId);
                const objectInfo = result as { objectId?: string };
                vscode.window.showInformationMessage(
                    `Checked out: ${objectInfo.objectId || objectId}`
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Checkout failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    context.subscriptions.push(checkoutCommand);

    const checkinCommand = vscode.commands.registerCommand(
        'dctm.checkin',
        async (arg?: unknown) => {
            const objectId = extractObjectId(arg);
            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionFor(arg);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            const versionLabel = await vscode.window.showInputBox({
                prompt: 'Enter version label',
                placeHolder: 'CURRENT',
                value: 'CURRENT'
            });

            if (versionLabel === undefined) {
                return; // Cancelled
            }

            try {
                const result = await connection.bridge.checkin(connection.sessionId, objectId, versionLabel);
                const objectInfo = result as { objectId?: string };
                vscode.window.showInformationMessage(
                    `Checked in: ${objectInfo.objectId || objectId}`
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Checkin failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    context.subscriptions.push(checkinCommand);

    const cancelCheckoutCommand = vscode.commands.registerCommand(
        'dctm.cancelCheckout',
        async (arg?: unknown) => {
            const objectId = extractObjectId(arg);
            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionFor(arg);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to cancel checkout? Unsaved changes will be lost.',
                'Yes',
                'No'
            );

            if (confirm !== 'Yes') {
                return;
            }

            try {
                await connection.bridge.cancelCheckout(connection.sessionId, objectId);
                vscode.window.showInformationMessage('Checkout cancelled');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Cancel checkout failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    context.subscriptions.push(cancelCheckoutCommand);
}
