import * as vscode from 'vscode';
import { TypeCache, TypeInfo, TypeAttribute } from './typeCache';
import { ConnectionManager } from './connectionManager';
import { escapeHtml } from './htmlUtils';
import { buildTypeQuery } from './dqlQueries';
import { TypeAttributeGroup as AttributeGroup, formatTypeDisplay, groupTypeAttributes } from './attributeGroups';
import { WebviewAssets, webviewAssets, webviewData, webviewResourceRoots } from './webviewHtml';

/**
 * WebviewPanel for displaying Documentum type details with grouped attributes
 * Similar to ObjectDumpPanel but for type definitions
 */
export class TypeDumpPanel {
    public static currentPanel: TypeDumpPanel | undefined;
    private static allPanels: Set<TypeDumpPanel> = new Set();
    private static panelCounter: number = 0;
    private static readonly viewType = 'dctmTypeDump';

    private readonly panel: vscode.WebviewPanel;
    private readonly connectionManager: ConnectionManager;
    private connectionName: string;
    private disposables: vscode.Disposable[] = [];

    // Current state
    private currentTypeName: string = '';

    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        typeName: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Check the reuseWindow setting
        const config = vscode.workspace.getConfiguration('documentum.panels');
        const reuseWindow = config.get<boolean>('reuseWindow', false);

        // If reuseWindow is true and we already have a panel, show it and update content
        if (reuseWindow && TypeDumpPanel.currentPanel) {
            TypeDumpPanel.currentPanel.panel.reveal(column);
            TypeDumpPanel.currentPanel.connectionName = connectionName;
            await TypeDumpPanel.currentPanel.loadType(typeName);
            return;
        }

        // Create a new panel
        TypeDumpPanel.panelCounter++;
        const panelTitle = reuseWindow ? `Type: ${typeName}` : `Type #${TypeDumpPanel.panelCounter}: ${typeName}`;
        const panel = vscode.window.createWebviewPanel(
            TypeDumpPanel.viewType,
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewResourceRoots(extensionUri)
            }
        );

        const typePanel = new TypeDumpPanel(panel, connectionManager, connectionName, extensionUri);
        TypeDumpPanel.allPanels.add(typePanel);

        // Only track as currentPanel when reuseWindow is true
        if (reuseWindow) {
            TypeDumpPanel.currentPanel = typePanel;
        }

        await typePanel.loadType(typeName);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        private readonly extensionUri: vscode.Uri
    ) {
        this.panel = panel;
        this.connectionManager = connectionManager;
        this.connectionName = connectionName;

        // Set initial loading content
        this.panel.webview.html = this.getLoadingHtml();

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this.loadType(this.currentTypeName, true);
                        break;
                    case 'openType':
                        await this.loadType(message.typeName);
                        break;
                    case 'copyValue':
                        await vscode.env.clipboard.writeText(message.value);
                        vscode.window.showInformationMessage('Value copied to clipboard');
                        break;
                    case 'generateDql':
                        await this.generateDqlQuery();
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    /**
     * Load and display a type's details
     */
    public async loadType(typeName: string, refresh = false): Promise<void> {
        this.currentTypeName = typeName;
        this.panel.title = `Type: ${typeName}`;
        this.panel.webview.html = this.getLoadingHtml();

        try {
            const connection = this.connectionManager.getOpenConnection(this.connectionName);
            if (!connection) {
                throw new Error(`Not connected to ${this.connectionName}`);
            }

            const type = await connection.typeCache.fetchTypeDetails(typeName, refresh);
            if (!type) {
                this.panel.webview.html = this.getErrorHtml(typeName, 'Type not found');
                return;
            }

            this.panel.webview.html = this.getContentHtml(type, connection.typeCache);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.panel.webview.html = this.getErrorHtml(typeName, errorMessage);
        }
    }

    /**
     * Generate a DQL query for the current type
     */
    private async generateDqlQuery(): Promise<void> {
        const connection = this.connectionManager.getOpenConnection(this.connectionName);
        let type;
        try {
            type = await connection?.typeCache.fetchTypeDetails(this.currentTypeName);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to generate DQL for ${this.currentTypeName}: ${message}`);
            return;
        }
        if (!type) {
            return;
        }

        const doc = await vscode.workspace.openTextDocument({
            content: buildTypeQuery(type),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    private assets(): WebviewAssets {
        return webviewAssets(this.panel.webview, this.extensionUri, 'typeDumpPanel');
    }

    /**
     * Generate loading HTML
     */
    private getLoadingHtml(): string {
        const assets = this.assets();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            ${assets.csp}
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
                <div>Loading type...</div>
            </div>
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Generate error HTML
     */
    private getErrorHtml(typeName: string, error: string): string {
        const assets = this.assets();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            ${assets.csp}
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
                <div class="error-title">Failed to load type: ${escapeHtml(typeName)}</div>
                <div>${escapeHtml(error)}</div>
                <button data-action="refresh">Retry</button>
            </div>
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Generate content HTML with type details and grouped attributes
     */
    private getContentHtml(type: TypeInfo, typeCache: TypeCache): string {
        const groups = groupTypeAttributes(type.attributes);

        const groupLabels: Record<AttributeGroup, string> = {
            custom: 'Type-Specific Attributes',
            standard: 'Standard Attributes',
            system: 'System Attributes (r_)',
            application: 'Application Attributes (a_)',
            internal: 'Internal Attributes (i_)'
        };

        const groupOrder: AttributeGroup[] = ['custom', 'standard', 'application', 'system', 'internal'];

        // Get child types
        const childTypes = typeCache.getChildTypes(type.name);

        // Count attributes
        const totalAttrs = type.attributes.length;
        const inheritedAttrs = type.attributes.filter(a => a.isInherited).length;
        const ownAttrs = totalAttrs - inheritedAttrs;

        const assets = this.assets();
        return `<!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            ${assets.csp}
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
                    font-size: 16px;
                    font-weight: 600;
                    margin-bottom: 8px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                .header-title .icon {
                    font-size: 18px;
                }
                .header-info {
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    margin-bottom: 8px;
                }
                .header-info a {
                    color: var(--vscode-textLink-foreground);
                    cursor: pointer;
                    text-decoration: none;
                }
                .header-info a:hover {
                    text-decoration: underline;
                }
                .header-actions {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                    align-items: center;
                }
                .header-actions button {
                    background: var(--vscode-button-secondaryBackground);
                    color: var(--vscode-button-secondaryForeground);
                    border: none;
                    padding: 4px 10px;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 11px;
                }
                .header-actions button:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .header-actions button.primary {
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                }
                .header-actions button.primary:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                .toggle-container {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 12px;
                }
                .toggle-container input[type="checkbox"] {
                    width: 14px;
                    height: 14px;
                    cursor: pointer;
                }
                .filter-bar {
                    margin-top: 8px;
                }
                .filter-bar input {
                    width: 100%;
                    padding: 6px 10px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    font-size: 12px;
                    box-sizing: border-box;
                }
                .filter-bar input:focus {
                    outline: 1px solid var(--vscode-focusBorder);
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
                .child-types-section {
                    margin-bottom: 24px;
                }
                .child-types {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .child-type {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    cursor: pointer;
                }
                .child-type:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .attribute {
                    display: flex;
                    padding: 6px 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    align-items: center;
                }
                .attribute:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .attribute.hidden {
                    display: none;
                }
                .attr-name {
                    width: 220px;
                    flex-shrink: 0;
                    font-weight: 500;
                    color: var(--vscode-symbolIcon-propertyForeground);
                    padding-right: 12px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    cursor: pointer;
                }
                .attr-name:hover {
                    text-decoration: underline;
                }
                .attr-type {
                    width: 100px;
                    flex-shrink: 0;
                    color: var(--vscode-descriptionForeground);
                    font-size: 12px;
                    padding-right: 12px;
                }
                .attr-details {
                    flex-grow: 1;
                    display: flex;
                    gap: 8px;
                    font-size: 11px;
                }
                .attr-badge {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                }
                .attr-badge.repeating {
                    background: var(--vscode-editorWarning-foreground);
                }
                .no-results {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                    padding: 16px;
                    text-align: center;
                }
            </style>
        </head>
        <body ${webviewData({ typeName: type.name })}>
            <div class="header">
                <div class="header-title">
                    <span class="icon">&#128450;</span>
                    ${escapeHtml(type.name)}
                </div>
                <div class="header-info">
                    ${type.superType ? `Super Type: <a data-action="openType" data-value="${escapeHtml(type.superType)}">${escapeHtml(type.superType)}</a> | ` : ''}
                    Attributes: ${ownAttrs} own, ${inheritedAttrs} inherited (${totalAttrs} total) |
                    Child Types: ${childTypes.length}
                </div>
                <div class="header-actions">
                    <button data-action="refresh">Refresh</button>
                    <button data-action="generateDql" class="primary">Generate DQL</button>
                    <button data-action="copyTypeName">Copy Type Name</button>
                    <button data-action="collapseAll">Collapse All</button>
                    <button data-action="expandAll">Expand All</button>
                    <span class="toggle-container">
                        <input type="checkbox" id="showInherited" checked>
                        <label for="showInherited">Show inherited</label>
                    </span>
                </div>
                <div class="filter-bar">
                    <input type="text" id="filter" placeholder="Filter attributes by name or type...">
                </div>
            </div>
            <div class="content">
                ${childTypes.length > 0 ? `
                <div class="child-types-section">
                    <div class="group-header" data-action="toggleGroup">
                        <span class="toggle" id="toggle-children">&#9660;</span>
                        Child Types
                        <span class="count">${childTypes.length}</span>
                    </div>
                    <div class="group-content" id="group-children">
                        <div class="child-types">
                            ${childTypes.map(ct => `<span class="child-type" data-action="openType" data-value="${escapeHtml(ct)}">${escapeHtml(ct)}</span>`).join('')}
                        </div>
                    </div>
                </div>
                ` : ''}

                ${groupOrder.map(groupKey => {
                    const attrs = groups[groupKey];
                    if (attrs.length === 0) {
                        return '';
                    }
                    const isInheritedGroup = groupKey !== 'custom';
                    return `
                        <div class="group" data-group="${groupKey}" data-inherited="${isInheritedGroup}">
                            <div class="group-header" data-action="toggleGroup">
                                <span class="toggle" id="toggle-${groupKey}">&#9660;</span>
                                ${groupLabels[groupKey]}
                                <span class="count" id="count-${groupKey}">${attrs.length}</span>
                            </div>
                            <div class="group-content" id="group-${groupKey}">
                                ${attrs.map(attr => this.renderAttribute(attr, isInheritedGroup)).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Render a single attribute row
     */
    private renderAttribute(attr: TypeAttribute, isInherited: boolean): string {
        const typeDisplay = formatTypeDisplay(attr);

        return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-type="${escapeHtml(attr.dataType)}" data-inherited="${isInherited}">
            <div class="attr-name" title="${escapeHtml(attr.name)}" data-action="copyValue" data-value="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
            <div class="attr-type">${escapeHtml(typeDisplay)}</div>
            <div class="attr-details">
                ${attr.isRepeating ? '<span class="attr-badge repeating">repeating</span>' : ''}
            </div>
        </div>`;
    }

    public dispose(): void {
        TypeDumpPanel.allPanels.delete(this);
        if (TypeDumpPanel.currentPanel === this) {
            TypeDumpPanel.currentPanel = undefined;
        }

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
