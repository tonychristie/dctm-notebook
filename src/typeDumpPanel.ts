import * as vscode from 'vscode';
import { TypeCache, TypeInfo, TypeAttribute } from './typeCache';

/**
 * Attribute grouping categories (same as ObjectDumpPanel)
 */
type AttributeGroup = 'custom' | 'standard' | 'system' | 'application' | 'internal';

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
    private readonly typeCache: TypeCache;
    private disposables: vscode.Disposable[] = [];

    // Current state
    private currentTypeName: string = '';

    public static async createOrShow(
        extensionUri: vscode.Uri,
        typeCache: TypeCache,
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
                localResourceRoots: [extensionUri]
            }
        );

        const typePanel = new TypeDumpPanel(panel, typeCache, extensionUri);
        TypeDumpPanel.allPanels.add(typePanel);

        // Only track as currentPanel when reuseWindow is true
        if (reuseWindow) {
            TypeDumpPanel.currentPanel = typePanel;
        }

        await typePanel.loadType(typeName);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        typeCache: TypeCache,
        private readonly extensionUri: vscode.Uri
    ) {
        this.panel = panel;
        this.typeCache = typeCache;

        // Set initial loading content
        this.panel.webview.html = this.getLoadingHtml();

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this.loadType(this.currentTypeName);
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
    public async loadType(typeName: string): Promise<void> {
        this.currentTypeName = typeName;
        this.panel.title = `Type: ${typeName}`;
        this.panel.webview.html = this.getLoadingHtml();

        try {
            const type = await this.typeCache.fetchTypeDetails(typeName);
            if (!type) {
                this.panel.webview.html = this.getErrorHtml(typeName, 'Type not found');
                return;
            }

            this.panel.webview.html = this.getContentHtml(type);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.panel.webview.html = this.getErrorHtml(typeName, errorMessage);
        }
    }

    /**
     * Categorize attribute based on prefix (same logic as ObjectDumpPanel)
     */
    private categorizeAttribute(name: string): AttributeGroup {
        if (name.startsWith('r_')) {
            return 'system';
        }
        if (name.startsWith('i_')) {
            return 'internal';
        }
        if (name.startsWith('a_')) {
            return 'application';
        }
        return 'standard';
    }

    /**
     * Generate a DQL query for the current type
     */
    private async generateDqlQuery(): Promise<void> {
        const type = await this.typeCache.fetchTypeDetails(this.currentTypeName);
        if (!type) {
            return;
        }

        // Get type-specific attributes (not inherited)
        const attrs = type.attributes
            .filter(a => !a.isInherited)
            .slice(0, 5)
            .map(a => a.name);

        if (attrs.length === 0) {
            attrs.push('r_object_id', 'object_name');
        }

        const dql = `SELECT ${attrs.join(', ')}\nFROM ${type.name}\nWHERE 1=1`;

        // Open in new editor
        const doc = await vscode.workspace.openTextDocument({
            content: dql,
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
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
                <div>Loading type...</div>
            </div>
        </body>
        </html>`;
    }

    /**
     * Generate error HTML
     */
    private getErrorHtml(typeName: string, error: string): string {
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
                <div class="error-title">Failed to load type: ${this.escapeHtml(typeName)}</div>
                <div>${this.escapeHtml(error)}</div>
                <button onclick="refresh()">Retry</button>
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                function refresh() {
                    vscode.postMessage({ command: 'refresh' });
                }
            </script>
        </body>
        </html>`;
    }

    /**
     * Generate content HTML with type details and grouped attributes
     */
    private getContentHtml(type: TypeInfo): string {
        // Group attributes by category (like ObjectDumpPanel)
        const groups: Record<AttributeGroup, TypeAttribute[]> = {
            custom: [],
            standard: [],
            system: [],
            application: [],
            internal: []
        };

        // Separate type-specific (custom) from inherited standard attributes
        for (const attr of type.attributes) {
            if (!attr.isInherited) {
                // Type-specific attributes go to "custom" group
                groups.custom.push(attr);
            } else {
                // Inherited attributes go by prefix
                const group = this.categorizeAttribute(attr.name);
                groups[group].push(attr);
            }
        }

        // Sort attributes within each group
        for (const group of Object.values(groups)) {
            group.sort((a, b) => a.name.localeCompare(b.name));
        }

        const groupLabels: Record<AttributeGroup, string> = {
            custom: 'Type-Specific Attributes',
            standard: 'Standard Attributes',
            system: 'System Attributes (r_)',
            application: 'Application Attributes (a_)',
            internal: 'Internal Attributes (i_)'
        };

        const groupOrder: AttributeGroup[] = ['custom', 'standard', 'application', 'system', 'internal'];

        // Get child types
        const childTypes = this.typeCache.getChildTypes(type.name);

        // Count attributes
        const totalAttrs = type.attributes.length;
        const inheritedAttrs = type.attributes.filter(a => a.isInherited).length;
        const ownAttrs = totalAttrs - inheritedAttrs;

        // Serialize attribute data for JavaScript
        const attributeData = JSON.stringify(type.attributes.map(a => ({
            name: a.name,
            dataType: a.dataType,
            length: a.length,
            isRepeating: a.isRepeating,
            isInherited: a.isInherited,
            group: a.isInherited ? this.categorizeAttribute(a.name) : 'custom'
        })));

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
        <body>
            <div class="header">
                <div class="header-title">
                    <span class="icon">&#128450;</span>
                    ${this.escapeHtml(type.name)}
                </div>
                <div class="header-info">
                    ${type.superType ? `Super Type: <a onclick="openType('${this.escapeHtml(type.superType)}')">${this.escapeHtml(type.superType)}</a> | ` : ''}
                    Attributes: ${ownAttrs} own, ${inheritedAttrs} inherited (${totalAttrs} total) |
                    Child Types: ${childTypes.length}
                </div>
                <div class="header-actions">
                    <button onclick="refresh()">Refresh</button>
                    <button onclick="generateDql()" class="primary">Generate DQL</button>
                    <button onclick="copyTypeName()">Copy Type Name</button>
                    <button onclick="collapseAll()">Collapse All</button>
                    <button onclick="expandAll()">Expand All</button>
                    <span class="toggle-container">
                        <input type="checkbox" id="showInherited" checked onchange="toggleInherited(this.checked)">
                        <label for="showInherited">Show inherited</label>
                    </span>
                </div>
                <div class="filter-bar">
                    <input type="text" id="filter" placeholder="Filter attributes by name or type..." oninput="filterAttributes(this.value)">
                </div>
            </div>
            <div class="content">
                ${childTypes.length > 0 ? `
                <div class="child-types-section">
                    <div class="group-header" onclick="toggleGroup('children')">
                        <span class="toggle" id="toggle-children">&#9660;</span>
                        Child Types
                        <span class="count">${childTypes.length}</span>
                    </div>
                    <div class="group-content" id="group-children">
                        <div class="child-types">
                            ${childTypes.map(ct => `<span class="child-type" onclick="openType('${this.escapeHtml(ct)}')">${this.escapeHtml(ct)}</span>`).join('')}
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
                            <div class="group-header" onclick="toggleGroup('${groupKey}')">
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
            <script>
                const vscode = acquireVsCodeApi();
                const typeName = '${this.escapeHtml(type.name)}';
                const allAttributes = ${attributeData};
                let showInherited = true;
                let currentFilter = '';

                function refresh() {
                    vscode.postMessage({ command: 'refresh' });
                }

                function toggleInherited(checked) {
                    showInherited = checked;
                    applyFilters();
                }

                function filterAttributes(value) {
                    currentFilter = value.toLowerCase();
                    applyFilters();
                }

                function applyFilters() {
                    // Show/hide inherited groups
                    document.querySelectorAll('.group[data-inherited="true"]').forEach(group => {
                        group.style.display = showInherited ? 'block' : 'none';
                    });

                    // Filter individual attributes by name/type
                    document.querySelectorAll('.attribute').forEach(el => {
                        const name = (el.dataset.name || '').toLowerCase();
                        const type = (el.dataset.type || '').toLowerCase();
                        const matchesFilter = !currentFilter || name.includes(currentFilter) || type.includes(currentFilter);
                        el.classList.toggle('hidden', !matchesFilter);
                    });

                    // Update group counts and visibility based on visible attributes
                    document.querySelectorAll('.group').forEach(group => {
                        const groupKey = group.dataset.group;
                        const visibleAttrs = group.querySelectorAll('.attribute:not(.hidden)');
                        const countEl = document.getElementById('count-' + groupKey);
                        if (countEl) {
                            countEl.textContent = visibleAttrs.length;
                        }
                        // Hide group if no visible attributes (but respect inherited toggle)
                        if (group.dataset.inherited === 'true' && !showInherited) {
                            group.style.display = 'none';
                        } else {
                            group.style.display = visibleAttrs.length > 0 ? 'block' : 'none';
                        }
                    });
                }

                function openType(name) {
                    vscode.postMessage({ command: 'openType', typeName: name });
                }

                function copyTypeName() {
                    vscode.postMessage({ command: 'copyValue', value: typeName });
                }

                function copyValue(value) {
                    vscode.postMessage({ command: 'copyValue', value: value });
                }

                function generateDql() {
                    vscode.postMessage({ command: 'generateDql' });
                }

                function toggleGroup(groupKey) {
                    const content = document.getElementById('group-' + groupKey);
                    const toggle = document.getElementById('toggle-' + groupKey);
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
                    });
                    document.querySelectorAll('.group-header .toggle').forEach(el => {
                        el.innerHTML = '&#9654;';
                    });
                }

                function expandAll() {
                    document.querySelectorAll('.group-content').forEach(el => {
                        el.classList.remove('collapsed');
                    });
                    document.querySelectorAll('.group-header .toggle').forEach(el => {
                        el.innerHTML = '&#9660;';
                    });
                }
            </script>
        </body>
        </html>`;
    }

    /**
     * Render a single attribute row
     */
    private renderAttribute(attr: TypeAttribute, isInherited: boolean): string {
        const typeDisplay = attr.length > 0 ? `${attr.dataType}(${attr.length})` : attr.dataType;

        return `<div class="attribute" data-name="${this.escapeHtml(attr.name)}" data-type="${this.escapeHtml(attr.dataType)}" data-inherited="${isInherited}">
            <div class="attr-name" title="${this.escapeHtml(attr.name)}" onclick="copyValue('${this.escapeHtml(attr.name)}')">${this.escapeHtml(attr.name)}</div>
            <div class="attr-type">${this.escapeHtml(typeDisplay)}</div>
            <div class="attr-details">
                ${attr.isRepeating ? '<span class="attr-badge repeating">repeating</span>' : ''}
            </div>
        </div>`;
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
