import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';

/**
 * Attribute grouping categories similar to Repoint's PropertiesView
 */
export type AttributeGroup = 'standard' | 'custom' | 'system' | 'application' | 'internal';

/**
 * Attribute information with value
 */
export interface AttributeInfo {
    name: string;
    type: string;
    value: unknown;
    isRepeating: boolean;
    group: AttributeGroup;
}

/**
 * Object dump data
 */
export interface ObjectDump {
    objectId: string;
    typeName: string;
    objectName: string;
    attributes: AttributeInfo[];
    fetchTime: number;
}

/**
 * Navigation history entry
 */
export interface NavigationEntry {
    objectId: string;
    objectName: string;
    typeName: string;
}

/**
 * WebviewPanel for displaying Documentum object dumps with grouped attributes
 * Similar to Repoint's PropertiesView with attribute categorization
 */
export class ObjectDumpPanel {
    public static currentPanel: ObjectDumpPanel | undefined;
    private static readonly viewType = 'dctmObjectDump';

    private readonly panel: vscode.WebviewPanel;
    private readonly connectionManager: ConnectionManager;
    private disposables: vscode.Disposable[] = [];

    // Navigation history
    private navigationHistory: NavigationEntry[] = [];
    private historyIndex: number = -1;

    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        objectId: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it and update content
        if (ObjectDumpPanel.currentPanel) {
            ObjectDumpPanel.currentPanel.panel.reveal(column);
            await ObjectDumpPanel.currentPanel.loadObject(objectId);
            return;
        }

        // Otherwise, create a new panel
        const panel = vscode.window.createWebviewPanel(
            ObjectDumpPanel.viewType,
            'Object Dump',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        ObjectDumpPanel.currentPanel = new ObjectDumpPanel(panel, connectionManager, extensionUri);
        await ObjectDumpPanel.currentPanel.loadObject(objectId);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        private readonly extensionUri: vscode.Uri
    ) {
        this.panel = panel;
        this.connectionManager = connectionManager;

        // Set initial loading content
        this.panel.webview.html = this.getLoadingHtml();

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this.loadObject(message.objectId, false);
                        break;
                    case 'copyValue':
                        await vscode.env.clipboard.writeText(message.value);
                        vscode.window.showInformationMessage('Value copied to clipboard');
                        break;
                    case 'dumpObject':
                        await this.loadObject(message.objectId, true);
                        break;
                    case 'goBack':
                        await this.goBack();
                        break;
                    case 'goForward':
                        await this.goForward();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    /**
     * Load and display an object's attributes
     * @param objectId The object ID to load
     * @param addToHistory Whether to add this navigation to history (default: true)
     */
    public async loadObject(objectId: string, addToHistory: boolean = true): Promise<void> {
        this.panel.title = `Object: ${objectId}`;
        this.panel.webview.html = this.getLoadingHtml();

        try {
            const dump = await this.fetchObjectDump(objectId);
            this.panel.title = `${dump.objectName} (${dump.typeName})`;

            // Update navigation history
            if (addToHistory) {
                // Remove any forward history when navigating to a new object
                if (this.historyIndex < this.navigationHistory.length - 1) {
                    this.navigationHistory = this.navigationHistory.slice(0, this.historyIndex + 1);
                }

                // Add new entry to history
                this.navigationHistory.push({
                    objectId: dump.objectId,
                    objectName: dump.objectName,
                    typeName: dump.typeName
                });
                this.historyIndex = this.navigationHistory.length - 1;
            }

            this.panel.webview.html = this.getContentHtml(dump);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.panel.webview.html = this.getErrorHtml(objectId, errorMessage);
        }
    }

    /**
     * Navigate back in history
     */
    private async goBack(): Promise<void> {
        if (this.historyIndex > 0) {
            this.historyIndex--;
            const entry = this.navigationHistory[this.historyIndex];
            await this.loadObject(entry.objectId, false);
        }
    }

    /**
     * Navigate forward in history
     */
    private async goForward(): Promise<void> {
        if (this.historyIndex < this.navigationHistory.length - 1) {
            this.historyIndex++;
            const entry = this.navigationHistory[this.historyIndex];
            await this.loadObject(entry.objectId, false);
        }
    }

    /**
     * Check if back navigation is available
     */
    private canGoBack(): boolean {
        return this.historyIndex > 0;
    }

    /**
     * Check if forward navigation is available
     */
    private canGoForward(): boolean {
        return this.historyIndex < this.navigationHistory.length - 1;
    }

    /**
     * Fetch object dump via the DFC Bridge
     */
    private async fetchObjectDump(objectId: string): Promise<ObjectDump> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            throw new Error('Not connected to Documentum');
        }

        const bridge = this.connectionManager.getDfcBridge();
        const startTime = Date.now();

        // Use dmAPIGet to get the dump
        const dumpResult = await bridge.executeDmApi(
            connection.sessionId,
            'get',
            `dump,${connection.sessionId},${objectId}`
        );

        const fetchTime = Date.now() - startTime;

        // Parse the dump result (format is attribute=value lines)
        const dumpText = String(dumpResult.result);
        const attributes = this.parseDump(dumpText, objectId);

        // Extract type and name from attributes
        const typeAttr = attributes.find(a => a.name === 'r_object_type');
        const nameAttr = attributes.find(a => a.name === 'object_name');

        return {
            objectId,
            typeName: typeAttr ? String(typeAttr.value) : 'unknown',
            objectName: nameAttr ? String(nameAttr.value) : objectId,
            attributes,
            fetchTime
        };
    }

    /**
     * Parse dump output into structured attributes
     */
    private parseDump(dumpText: string, _objectId: string): AttributeInfo[] {
        const attributes: AttributeInfo[] = [];
        const lines = dumpText.split('\n');

        // Track repeating attribute indices
        const repeatingIndices = new Map<string, number>();
        let customStartPos = -1;

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('---')) {
                continue;
            }

            // Match attribute line: "  attr_name [type] : value" or "attr_name : value"
            // Also handle repeating: "  attr_name[0] : value"
            const match = trimmed.match(/^(\S+?)(?:\[(\d+)\])?\s*(?:\[([^\]]+)\])?\s*[:=]\s*(.*)$/);
            if (match) {
                const [, name, indexStr, type, rawValue] = match;
                let value: string | string[] = rawValue;
                const index = indexStr ? parseInt(indexStr) : undefined;
                const isRepeating = index !== undefined;

                // Determine attribute group based on Repoint-style categorization
                const group = this.categorizeAttribute(name, customStartPos);

                // Track if this is a repeating attribute
                if (isRepeating) {
                    const existingIdx = repeatingIndices.get(name);
                    if (existingIdx !== undefined) {
                        // Find and update the existing attribute
                        const existing = attributes.find(a => a.name === name && a.isRepeating);
                        if (existing && Array.isArray(existing.value)) {
                            (existing.value as unknown[]).push(value);
                        }
                        continue;
                    }
                    repeatingIndices.set(name, index);
                    value = [rawValue]; // Start array for repeating
                }

                // Track start_pos for custom attribute detection
                if (name === 'start_pos') {
                    customStartPos = parseInt(rawValue) || -1;
                }

                attributes.push({
                    name,
                    type: type || 'string',
                    value: isRepeating ? [value] : value,
                    isRepeating,
                    group
                });
            }
        }

        // Re-categorize if we found start_pos (need second pass for custom attributes)
        if (customStartPos > 0) {
            let attrIndex = 0;
            for (const attr of attributes) {
                if (attr.group === 'standard') {
                    // Check if this is actually a custom attribute
                    if (attrIndex >= customStartPos) {
                        attr.group = 'custom';
                    }
                }
                if (!attr.name.startsWith('r_') && !attr.name.startsWith('i_') && !attr.name.startsWith('a_')) {
                    attrIndex++;
                }
            }
        }

        return attributes;
    }

    /**
     * Categorize attribute based on Repoint-style grouping
     * - System: r_ prefix
     * - Internal: i_ prefix
     * - Application: a_ prefix
     * - Custom: determined by start_pos from type definition
     * - Standard: everything else
     */
    private categorizeAttribute(name: string, _customStartPos: number): AttributeGroup {
        if (name.startsWith('r_')) {
            return 'system';
        }
        if (name.startsWith('i_')) {
            return 'internal';
        }
        if (name.startsWith('a_')) {
            return 'application';
        }
        // Custom vs Standard determined by position in type hierarchy
        // Will be refined in parseDump after we know start_pos
        return 'standard';
    }

    /**
     * Generate loading HTML
     */
    private getLoadingHtml(): string {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    height: 100vh;
                    margin: 0;
                }
                .loader {
                    text-align: center;
                }
                .spinner {
                    width: 40px;
                    height: 40px;
                    border: 3px solid var(--vscode-editor-foreground);
                    border-top-color: transparent;
                    border-radius: 50%;
                    animation: spin 1s linear infinite;
                    margin: 0 auto 16px;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            </style>
        </head>
        <body>
            <div class="loader">
                <div class="spinner"></div>
                <div>Loading object...</div>
            </div>
        </body>
        </html>`;
    }

    /**
     * Generate error HTML
     */
    private getErrorHtml(objectId: string, error: string): string {
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    padding: 20px;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .error {
                    background: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    padding: 16px;
                    border-radius: 4px;
                }
                .error-title {
                    font-weight: bold;
                    margin-bottom: 8px;
                }
                button {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    padding: 8px 16px;
                    border-radius: 2px;
                    cursor: pointer;
                    margin-top: 16px;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
            </style>
        </head>
        <body>
            <div class="error">
                <div class="error-title">Failed to load object: ${this.escapeHtml(objectId)}</div>
                <div>${this.escapeHtml(error)}</div>
                <button onclick="refresh()">Retry</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function refresh() {
                    vscode.postMessage({ command: 'refresh', objectId: '${objectId}' });
                }
            </script>
        </body>
        </html>`;
    }

    /**
     * Generate content HTML with grouped attributes
     */
    private getContentHtml(dump: ObjectDump): string {
        // Group attributes
        const groups: Record<AttributeGroup, AttributeInfo[]> = {
            custom: [],
            standard: [],
            system: [],
            application: [],
            internal: []
        };

        for (const attr of dump.attributes) {
            groups[attr.group].push(attr);
        }

        // Sort attributes within each group
        for (const group of Object.values(groups)) {
            group.sort((a, b) => a.name.localeCompare(b.name));
        }

        const groupLabels: Record<AttributeGroup, string> = {
            custom: 'Custom Attributes',
            standard: 'Standard Attributes',
            system: 'System Attributes (r_)',
            application: 'Application Attributes (a_)',
            internal: 'Internal Attributes (i_)'
        };

        const groupOrder: AttributeGroup[] = ['custom', 'standard', 'application', 'system', 'internal'];

        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: 13px;
                    padding: 0;
                    margin: 0;
                    color: var(--vscode-foreground);
                    background: var(--vscode-editor-background);
                }
                .header {
                    background: var(--vscode-sideBar-background);
                    padding: 12px 16px;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    position: sticky;
                    top: 0;
                    z-index: 100;
                }
                .header-title {
                    font-size: 14px;
                    font-weight: 600;
                    margin-bottom: 4px;
                }
                .header-info {
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                }
                .header-actions {
                    margin-top: 8px;
                }
                .header-actions button {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    padding: 4px 10px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 11px;
                    margin-right: 8px;
                }
                .header-actions button:hover:not(:disabled) {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .header-actions button:disabled {
                    opacity: 0.4;
                    cursor: not-allowed;
                }
                .nav-buttons {
                    display: inline-flex;
                    gap: 4px;
                    margin-right: 12px;
                    padding-right: 12px;
                    border-right: 1px solid var(--vscode-panel-border);
                }
                .nav-buttons button {
                    padding: 4px 8px;
                    min-width: 28px;
                }
                .content {
                    padding: 16px;
                }
                .group {
                    margin-bottom: 24px;
                }
                .group-header {
                    font-weight: 600;
                    font-size: 12px;
                    text-transform: uppercase;
                    color: var(--vscode-descriptionForeground);
                    padding: 8px 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    margin-bottom: 8px;
                    display: flex;
                    align-items: center;
                    cursor: pointer;
                    user-select: none;
                }
                .group-header:hover {
                    color: var(--vscode-foreground);
                }
                .group-header .count {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-size: 10px;
                    margin-left: 8px;
                }
                .group-header .toggle {
                    margin-right: 8px;
                }
                .group-content {
                    display: block;
                }
                .group-content.collapsed {
                    display: none;
                }
                .attribute {
                    display: flex;
                    padding: 4px 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                }
                .attribute:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .attr-name {
                    width: 200px;
                    flex-shrink: 0;
                    font-weight: 500;
                    color: var(--vscode-symbolIcon-propertyForeground);
                    padding-right: 12px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .attr-type {
                    width: 80px;
                    flex-shrink: 0;
                    color: var(--vscode-descriptionForeground);
                    font-size: 11px;
                    padding-right: 12px;
                }
                .attr-value {
                    flex-grow: 1;
                    word-break: break-all;
                    cursor: pointer;
                }
                .attr-value:hover {
                    text-decoration: underline;
                }
                .attr-value.null {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
                .attr-value.object-id {
                    color: var(--vscode-textLink-foreground);
                    cursor: pointer;
                }
                .attr-value.object-id:hover {
                    text-decoration: underline;
                }
                .repeating-values {
                    display: flex;
                    flex-direction: column;
                    gap: 2px;
                }
                .repeating-value {
                    display: flex;
                    gap: 8px;
                }
                .repeating-index {
                    color: var(--vscode-descriptionForeground);
                    font-size: 10px;
                    min-width: 24px;
                }
                .copy-notification {
                    position: fixed;
                    bottom: 20px;
                    right: 20px;
                    background: var(--vscode-notifications-background);
                    color: var(--vscode-notifications-foreground);
                    padding: 8px 16px;
                    border-radius: 4px;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                    z-index: 1000;
                    opacity: 0;
                    transition: opacity 0.2s;
                }
                .copy-notification.show {
                    opacity: 1;
                }
                .filter-bar {
                    margin: 8px 0;
                }
                .filter-bar input {
                    width: 100%;
                    padding: 6px 10px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    font-size: 12px;
                }
                .filter-bar input:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="header-title">${this.escapeHtml(dump.objectName)}</div>
                <div class="header-info">
                    Type: ${this.escapeHtml(dump.typeName)} |
                    ID: <span class="object-id" style="color: var(--vscode-textLink-foreground);">${dump.objectId}</span> |
                    ${dump.attributes.length} attributes |
                    Loaded in ${dump.fetchTime}ms
                </div>
                <div class="header-actions">
                    <span class="nav-buttons">
                        <button onclick="goBack()" ${this.canGoBack() ? '' : 'disabled'} title="Go back">&#9664;</button>
                        <button onclick="goForward()" ${this.canGoForward() ? '' : 'disabled'} title="Go forward">&#9654;</button>
                    </span>
                    <button onclick="refresh()">Refresh</button>
                    <button onclick="copyObjectId()">Copy Object ID</button>
                    <button onclick="collapseAll()">Collapse All</button>
                    <button onclick="expandAll()">Expand All</button>
                </div>
                <div class="filter-bar">
                    <input type="text" id="filter" placeholder="Filter attributes..." oninput="filterAttributes(this.value)">
                </div>
            </div>
            <div class="content">
                ${groupOrder.map(groupKey => {
                    const attrs = groups[groupKey];
                    if (attrs.length === 0) {
                        return '';
                    }
                    return `
                        <div class="group" data-group="${groupKey}">
                            <div class="group-header" onclick="toggleGroup('${groupKey}')">
                                <span class="toggle">&#9660;</span>
                                ${groupLabels[groupKey]}
                                <span class="count">${attrs.length}</span>
                            </div>
                            <div class="group-content" id="group-${groupKey}">
                                ${attrs.map(attr => this.renderAttribute(attr)).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            <div id="notification" class="copy-notification"></div>
            <script>
                const vscode = acquireVsCodeApi();
                const objectId = '${dump.objectId}';

                function refresh() {
                    vscode.postMessage({ command: 'refresh', objectId: objectId });
                }

                function copyObjectId() {
                    vscode.postMessage({ command: 'copyValue', value: objectId });
                }

                function goBack() {
                    vscode.postMessage({ command: 'goBack' });
                }

                function goForward() {
                    vscode.postMessage({ command: 'goForward' });
                }

                function copyValue(value) {
                    vscode.postMessage({ command: 'copyValue', value: value });
                    showNotification('Copied to clipboard');
                }

                function dumpObject(objId) {
                    vscode.postMessage({ command: 'dumpObject', objectId: objId });
                }

                function toggleGroup(groupKey) {
                    const content = document.getElementById('group-' + groupKey);
                    const header = content.previousElementSibling;
                    const toggle = header.querySelector('.toggle');
                    if (content.classList.contains('collapsed')) {
                        content.classList.remove('collapsed');
                        toggle.innerHTML = '&#9660;';
                    } else {
                        content.classList.add('collapsed');
                        toggle.innerHTML = '&#9654;';
                    }
                }

                function collapseAll() {
                    document.querySelectorAll('.group-content').forEach(el => {
                        el.classList.add('collapsed');
                        el.previousElementSibling.querySelector('.toggle').innerHTML = '&#9654;';
                    });
                }

                function expandAll() {
                    document.querySelectorAll('.group-content').forEach(el => {
                        el.classList.remove('collapsed');
                        el.previousElementSibling.querySelector('.toggle').innerHTML = '&#9660;';
                    });
                }

                function filterAttributes(query) {
                    const lower = query.toLowerCase();
                    document.querySelectorAll('.attribute').forEach(el => {
                        const name = el.dataset.name || '';
                        const value = el.dataset.value || '';
                        const matches = name.toLowerCase().includes(lower) || value.toLowerCase().includes(lower);
                        el.style.display = matches ? 'flex' : 'none';
                    });
                    // Show groups that have visible attributes
                    document.querySelectorAll('.group').forEach(group => {
                        const visibleAttrs = group.querySelectorAll('.attribute[style="display: flex;"], .attribute:not([style])');
                        group.style.display = visibleAttrs.length > 0 || !query ? 'block' : 'none';
                    });
                }

                function showNotification(msg) {
                    const notif = document.getElementById('notification');
                    notif.textContent = msg;
                    notif.classList.add('show');
                    setTimeout(() => notif.classList.remove('show'), 2000);
                }
            </script>
        </body>
        </html>`;
    }

    /**
     * Render a single attribute row
     */
    private renderAttribute(attr: AttributeInfo): string {
        const valueStr = this.formatAttributeValue(attr.value, attr.isRepeating);
        const isObjectId = this.isObjectId(attr.value);
        const valueClass = attr.value === null ? 'null' : (isObjectId ? 'object-id' : '');

        let valueHtml: string;
        if (attr.isRepeating && Array.isArray(attr.value)) {
            valueHtml = `<div class="repeating-values">
                ${(attr.value as unknown[]).map((v, i) => {
                    const itemIsObjId = this.isObjectId(v);
                    const itemClass = v === null ? 'null' : (itemIsObjId ? 'object-id' : '');
                    const onclick = itemIsObjId
                        ? `dumpObject('${this.escapeHtml(String(v))}')`
                        : `copyValue('${this.escapeHtml(String(v ?? ''))}')`;
                    return `<div class="repeating-value">
                        <span class="repeating-index">[${i}]</span>
                        <span class="${itemClass}" onclick="${onclick}">${this.escapeHtml(String(v ?? 'NULL'))}</span>
                    </div>`;
                }).join('')}
            </div>`;
        } else {
            const onclick = isObjectId
                ? `dumpObject('${this.escapeHtml(String(attr.value))}')`
                : `copyValue('${this.escapeHtml(String(attr.value ?? ''))}')`;
            valueHtml = `<span class="${valueClass}" onclick="${onclick}">${this.escapeHtml(valueStr)}</span>`;
        }

        return `<div class="attribute" data-name="${this.escapeHtml(attr.name)}" data-value="${this.escapeHtml(valueStr)}">
            <div class="attr-name" title="${this.escapeHtml(attr.name)}">${this.escapeHtml(attr.name)}</div>
            <div class="attr-type">${this.escapeHtml(attr.type)}</div>
            <div class="attr-value">${valueHtml}</div>
        </div>`;
    }

    /**
     * Format attribute value for display
     */
    private formatAttributeValue(value: unknown, isRepeating: boolean): string {
        if (value === null || value === undefined) {
            return 'NULL';
        }
        if (isRepeating && Array.isArray(value)) {
            return value.map(v => v === null ? 'NULL' : String(v)).join(', ');
        }
        return String(value);
    }

    /**
     * Check if value is an object ID
     */
    private isObjectId(value: unknown): boolean {
        if (typeof value !== 'string') {
            return false;
        }
        return /^[0-9a-f]{16}$/i.test(value);
    }

    /**
     * Escape HTML special characters
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    public dispose(): void {
        ObjectDumpPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
