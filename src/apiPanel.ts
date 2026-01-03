import * as vscode from 'vscode';
import { ApiExecutor, ApiMethodResponse, COMMON_DFC_METHODS } from './apiExecutor';
import { ConnectionManager } from './connectionManager';

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
 * Webview panel for executing DFC API methods
 */
export class ApiPanel {
    public static currentPanel: ApiPanel | undefined;
    private static readonly viewType = 'dctmApiPanel';

    private readonly panel: vscode.WebviewPanel;
    private readonly extensionUri: vscode.Uri;
    private readonly apiExecutor: ApiExecutor;
    private disposables: vscode.Disposable[] = [];

    private constructor(
        panel: vscode.WebviewPanel,
        extensionUri: vscode.Uri,
        apiExecutor: ApiExecutor
    ) {
        this.panel = panel;
        this.extensionUri = extensionUri;
        this.apiExecutor = apiExecutor;

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
        objectId?: string
    ): void {
        const column = vscode.ViewColumn.Beside;

        if (ApiPanel.currentPanel) {
            ApiPanel.currentPanel.panel.reveal(column);
            if (objectId) {
                ApiPanel.currentPanel.setObjectId(objectId);
            }
            return;
        }

        const panel = vscode.window.createWebviewPanel(
            ApiPanel.viewType,
            'DFC API Execution',
            column,
            {
                enableScripts: true,
                retainContextWhenHidden: true
            }
        );

        ApiPanel.currentPanel = new ApiPanel(panel, extensionUri, apiExecutor);

        if (objectId) {
            ApiPanel.currentPanel.setObjectId(objectId);
        }
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
                    vscode.commands.executeCommand('dctm.dumpObject', message.objectId);
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

            const response: ApiMethodResponse = await this.apiExecutor.execute({
                objectId,
                method,
                args
            });

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
        // Serialize method data for the webview
        const methodsJson = JSON.stringify(COMMON_DFC_METHODS);

        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
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
<body>
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
            <input type="text" id="methodSearch" placeholder="Type to search methods..." oninput="searchMethods(this.value)">
        </div>

        <div class="category-tabs" id="categoryTabs"></div>

        <div class="method-list" id="methodList"></div>
    </div>

    <div class="section" id="parametersSection" style="display: none;">
        <h3>Parameters</h3>
        <div id="parameterInputs"></div>
    </div>

    <div class="actions">
        <button id="executeBtn" onclick="executeMethod()" disabled>Execute</button>
        <button class="secondary" onclick="clearForm()">Clear</button>
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

    <script>
        const vscode = acquireVsCodeApi();
        const METHODS = ${methodsJson};

        let selectedMethod = null;
        let selectedCategory = null;
        let executionHistory = [];

        // Initialize
        document.addEventListener('DOMContentLoaded', () => {
            renderCategories();
            renderMethodList(getAllMethods());
        });

        // Handle messages from extension
        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.type) {
                case 'setObjectId':
                    document.getElementById('objectId').value = message.objectId;
                    break;
                case 'executing':
                    showLoading(message.method);
                    break;
                case 'result':
                    showResult(message);
                    break;
                case 'methodInfo':
                    if (message.method) {
                        selectMethod(message.method);
                    }
                    break;
            }
        });

        function getAllMethods() {
            return Object.values(METHODS).flat();
        }

        function renderCategories() {
            const container = document.getElementById('categoryTabs');
            container.innerHTML = Object.keys(METHODS).map(cat =>
                \`<span class="category-tab\${selectedCategory === cat ? ' active' : ''}"
                      onclick="filterByCategory('\${cat}')">\${cat}</span>\`
            ).join('');
        }

        function filterByCategory(category) {
            selectedCategory = selectedCategory === category ? null : category;
            renderCategories();

            if (selectedCategory) {
                renderMethodList(METHODS[selectedCategory]);
            } else {
                renderMethodList(getAllMethods());
            }
        }

        function renderMethodList(methods) {
            const container = document.getElementById('methodList');
            container.innerHTML = methods.map(m =>
                \`<div class="method-item\${selectedMethod?.name === m.name ? ' selected' : ''}"
                      onclick="selectMethodByName('\${m.name}')">
                    <div>
                        <span class="method-name">\${m.name}</span>
                        <span class="method-return">: \${m.returnType}</span>
                    </div>
                    <div class="method-desc">\${m.description || ''}</div>
                </div>\`
            ).join('');
        }

        function searchMethods(query) {
            if (!query) {
                renderMethodList(selectedCategory ? METHODS[selectedCategory] : getAllMethods());
                return;
            }

            const lower = query.toLowerCase();
            const results = getAllMethods().filter(m =>
                m.name.toLowerCase().includes(lower) ||
                (m.description && m.description.toLowerCase().includes(lower))
            );
            renderMethodList(results);
        }

        function selectMethodByName(name) {
            const method = getAllMethods().find(m => m.name === name);
            if (method) {
                selectMethod(method);
            }
        }

        function selectMethod(method) {
            selectedMethod = method;
            renderMethodList(selectedCategory ? METHODS[selectedCategory] : getAllMethods());
            renderParameters(method);
            document.getElementById('executeBtn').disabled = false;
        }

        function renderParameters(method) {
            const section = document.getElementById('parametersSection');
            const container = document.getElementById('parameterInputs');

            if (!method.parameters || method.parameters.length === 0) {
                section.style.display = 'none';
                return;
            }

            section.style.display = 'block';
            container.innerHTML = method.parameters.map((p, i) =>
                \`<div class="param-row">
                    <label for="param\${i}">\${p.name}\${p.required ? ' *' : ''}</label>
                    <input type="text" id="param\${i}" data-type="\${p.type}" placeholder="\${p.type}">
                    <span class="param-type">\${p.type}</span>
                </div>\`
            ).join('');
        }

        function getParameterValues() {
            if (!selectedMethod || !selectedMethod.parameters) {
                return [];
            }

            return selectedMethod.parameters.map((p, i) => {
                const input = document.getElementById(\`param\${i}\`);
                const value = input.value;
                const type = p.type;

                // Convert to appropriate type
                if (type === 'int') return parseInt(value) || 0;
                if (type === 'double') return parseFloat(value) || 0.0;
                if (type === 'boolean') return value.toLowerCase() === 'true';
                return value;
            });
        }

        function executeMethod() {
            if (!selectedMethod) return;

            const objectId = document.getElementById('objectId').value.trim();
            const args = getParameterValues();

            vscode.postMessage({
                type: 'execute',
                objectId: objectId || undefined,
                method: selectedMethod.name,
                args: args.length > 0 ? args : undefined
            });
        }

        function showLoading(method) {
            const panel = document.getElementById('resultPanel');
            const content = document.getElementById('resultContent');

            panel.style.display = 'block';
            content.innerHTML = \`<div class="loading">
                <div class="spinner"></div>
                Executing \${method}...
            </div>\`;
        }

        function showResult(message) {
            const panel = document.getElementById('resultPanel');
            const content = document.getElementById('resultContent');
            const timeSpan = document.getElementById('executionTime');

            panel.style.display = 'block';

            if (message.success) {
                const formattedResult = formatResult(message.result);
                const resultWithLinks = formatResultWithLinks(formattedResult);
                content.innerHTML = \`<span class="success">Success</span>\\n\\n\` +
                    \`Type: \${escapeHtml(message.resultType)}\\n\\n\` +
                    \`Result:\\n\${resultWithLinks}\`;
                timeSpan.textContent = \`\${message.executionTimeMs}ms\`;

                addToHistory(selectedMethod.name, message.result, true, message.executionTimeMs);
            } else {
                content.innerHTML = \`<span class="error">Error</span>\\n\\n\${message.error}\`;
                timeSpan.textContent = '';

                addToHistory(selectedMethod.name, message.error, false, 0);
            }
        }

        function escapeHtml(text) {
            const div = document.createElement('div');
            div.textContent = text;
            return div.innerHTML;
        }

        function formatResultWithLinks(text) {
            // Replace 16-character hex strings with clickable links
            return text.replace(/\\b([0-9a-f]{16})\\b/gi, (match) => {
                return \`<span class="object-id" data-object-id="\${escapeHtml(match)}">\${escapeHtml(match)}</span>\`;
            });
        }

        function formatResult(result) {
            if (result === null || result === undefined) {
                return 'null';
            }
            if (typeof result === 'object') {
                return JSON.stringify(result, null, 2);
            }
            return String(result);
        }

        function addToHistory(method, result, success, time) {
            executionHistory.unshift({
                method,
                result: success ? formatResult(result).substring(0, 100) : result,
                success,
                time,
                timestamp: new Date().toLocaleTimeString()
            });

            // Keep only last 10
            if (executionHistory.length > 10) {
                executionHistory.pop();
            }

            renderHistory();
        }

        function renderHistory() {
            const section = document.getElementById('historySection');
            const container = document.getElementById('historyList');

            if (executionHistory.length === 0) {
                section.style.display = 'none';
                return;
            }

            section.style.display = 'block';
            container.innerHTML = executionHistory.map(h =>
                \`<div class="history-item">
                    <span class="method \${h.success ? 'success' : 'error'}">\${h.method}()</span>
                    <span class="time">\${h.timestamp}</span>
                    <div class="info" style="margin-top: 4px;">\${h.result}</div>
                </div>\`
            ).join('');
        }

        function clearForm() {
            document.getElementById('objectId').value = '';
            document.getElementById('methodSearch').value = '';
            selectedMethod = null;
            selectedCategory = null;
            document.getElementById('parametersSection').style.display = 'none';
            document.getElementById('resultPanel').style.display = 'none';
            document.getElementById('executeBtn').disabled = true;
            renderCategories();
            renderMethodList(getAllMethods());
        }

        // Initial render
        renderCategories();
        renderMethodList(getAllMethods());

        // Event delegation for object ID clicks
        document.addEventListener('click', (e) => {
            const target = e.target;
            if (target.classList && target.classList.contains('object-id')) {
                const objectId = target.getAttribute('data-object-id');
                if (objectId) {
                    vscode.postMessage({
                        type: 'dumpObject',
                        objectId: objectId
                    });
                }
            }
        });
    </script>
</body>
</html>`;
    }

    /**
     * Dispose the panel
     */
    public dispose(): void {
        ApiPanel.currentPanel = undefined;
        this.panel.dispose();
        while (this.disposables.length) {
            const d = this.disposables.pop();
            if (d) {
                d.dispose();
            }
        }
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
    // Command to open API panel
    const openApiPanelCommand = vscode.commands.registerCommand(
        'dctm.openApiPanel',
        () => {
            ApiPanel.createOrShow(context.extensionUri, apiExecutor);
        }
    );
    context.subscriptions.push(openApiPanelCommand);

    // Command to execute API on selected object
    // When called from context menu, receives ObjectBrowserItem; when called programmatically, may receive string
    const executeApiOnObjectCommand = vscode.commands.registerCommand(
        'dctm.executeApiOnObject',
        (arg?: unknown) => {
            let objectId: string | undefined;

            if (typeof arg === 'string') {
                // Direct string objectId passed
                objectId = arg;
            } else if (arg && typeof arg === 'object') {
                // ObjectBrowserItem from context menu - extract objectId from data
                const item = arg as { data?: { objectId?: string } };
                if (item.data && typeof item.data.objectId === 'string') {
                    objectId = item.data.objectId;
                }
            }

            ApiPanel.createOrShow(context.extensionUri, apiExecutor, objectId);
        }
    );
    context.subscriptions.push(executeApiOnObjectCommand);

    // Quick execute common operations
    // When called from context menu, receives ObjectBrowserItem; when called programmatically, may receive string
    const checkoutCommand = vscode.commands.registerCommand(
        'dctm.checkout',
        async (arg?: unknown) => {
            let objectId: string | undefined;

            if (typeof arg === 'string') {
                objectId = arg;
            } else if (arg && typeof arg === 'object') {
                const item = arg as { data?: { objectId?: string } };
                if (item.data && typeof item.data.objectId === 'string') {
                    objectId = item.data.objectId;
                }
            }

            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionManager.getActiveConnection();
            if (!connection?.sessionId) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            try {
                const bridge = connectionManager.getDfcBridge();
                const result = await bridge.checkout(connection.sessionId, objectId);
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
            let objectId: string | undefined;

            if (typeof arg === 'string') {
                objectId = arg;
            } else if (arg && typeof arg === 'object') {
                const item = arg as { data?: { objectId?: string } };
                if (item.data && typeof item.data.objectId === 'string') {
                    objectId = item.data.objectId;
                }
            }

            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionManager.getActiveConnection();
            if (!connection?.sessionId) {
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
                const bridge = connectionManager.getDfcBridge();
                const result = await bridge.checkin(connection.sessionId, objectId, versionLabel);
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
            let objectId: string | undefined;

            if (typeof arg === 'string') {
                objectId = arg;
            } else if (arg && typeof arg === 'object') {
                const item = arg as { data?: { objectId?: string } };
                if (item.data && typeof item.data.objectId === 'string') {
                    objectId = item.data.objectId;
                }
            }

            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionManager.getActiveConnection();
            if (!connection?.sessionId) {
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
                const bridge = connectionManager.getDfcBridge();
                await bridge.cancelCheckout(connection.sessionId, objectId);
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
