import * as vscode from 'vscode';
import { UserCache, UserInfo, UserAttribute } from './userCache';

/**
 * Attribute grouping categories
 */
type AttributeGroup = 'identity' | 'access' | 'preferences' | 'system' | 'other';

/**
 * WebviewPanel for displaying Documentum user details with grouped attributes
 */
export class UserDumpPanel {
    public static currentPanel: UserDumpPanel | undefined;
    private static readonly viewType = 'dctmUserDump';

    private readonly panel: vscode.WebviewPanel;
    private readonly userCache: UserCache;
    private disposables: vscode.Disposable[] = [];

    // Current state
    private currentUserName: string = '';
    private userGroups: string[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        userCache: UserCache,
        userName: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // If we already have a panel, show it and update content
        if (UserDumpPanel.currentPanel) {
            UserDumpPanel.currentPanel.panel.reveal(column);
            await UserDumpPanel.currentPanel.loadUser(userName);
            return;
        }

        // Create a new panel
        const panel = vscode.window.createWebviewPanel(
            UserDumpPanel.viewType,
            `User: ${userName}`,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [extensionUri]
            }
        );

        UserDumpPanel.currentPanel = new UserDumpPanel(panel, userCache, extensionUri);
        await UserDumpPanel.currentPanel.loadUser(userName);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        userCache: UserCache,
        private readonly extensionUri: vscode.Uri
    ) {
        this.panel = panel;
        this.userCache = userCache;

        // Set initial loading content
        this.panel.webview.html = this.getLoadingHtml();

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this.loadUser(this.currentUserName);
                        break;
                    case 'copyValue':
                        await vscode.env.clipboard.writeText(message.value);
                        vscode.window.showInformationMessage('Value copied to clipboard');
                        break;
                    case 'generateDql':
                        await this.generateDqlQuery();
                        break;
                    case 'openGroup':
                        // Could open group panel here
                        await vscode.commands.executeCommand('dctm.searchGroups');
                        break;
                }
            },
            null,
            this.disposables
        );
    }

    /**
     * Load and display a user's details
     */
    public async loadUser(userName: string): Promise<void> {
        this.currentUserName = userName;
        this.panel.title = `User: ${userName}`;
        this.panel.webview.html = this.getLoadingHtml();

        try {
            const user = await this.userCache.fetchUserDetails(userName);
            if (!user) {
                this.panel.webview.html = this.getErrorHtml(userName, 'User not found');
                return;
            }

            // Fetch user's groups
            this.userGroups = await this.userCache.getUserGroups(userName);

            this.panel.webview.html = this.getContentHtml(user);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.panel.webview.html = this.getErrorHtml(userName, errorMessage);
        }
    }

    /**
     * Categorize attribute based on name
     */
    private categorizeAttribute(name: string): AttributeGroup {
        // Identity-related
        if (['user_name', 'user_login_name', 'user_os_name', 'user_address', 'user_db_name',
             'user_source', 'user_ldap_dn', 'user_global_unique_id'].includes(name)) {
            return 'identity';
        }
        // Access-related
        if (['acl_domain', 'acl_name', 'owner_name', 'owner_permit', 'user_privileges',
             'user_xprivileges', 'client_capability', 'alias_set_id'].includes(name)) {
            return 'access';
        }
        // Preferences
        if (['default_folder', 'default_group', 'home_docbase', 'user_web_page',
             'user_delegation', 'user_email'].includes(name)) {
            return 'preferences';
        }
        // System attributes (r_, i_)
        if (name.startsWith('r_') || name.startsWith('i_')) {
            return 'system';
        }
        return 'other';
    }

    /**
     * Generate a DQL query for the current user
     */
    private async generateDqlQuery(): Promise<void> {
        const dql = `SELECT user_name, user_login_name, user_os_name, user_address,
    default_folder, default_group, description, user_state
FROM dm_user
WHERE user_name = '${this.currentUserName}'`;

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
                <div>Loading user...</div>
            </div>
        </body>
        </html>`;
    }

    /**
     * Generate error HTML
     */
    private getErrorHtml(userName: string, error: string): string {
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
                <div class="error-title">Failed to load user: ${this.escapeHtml(userName)}</div>
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
     * Generate content HTML with user details and grouped attributes
     */
    private getContentHtml(user: UserInfo): string {
        // Group attributes by category
        const groups: Record<AttributeGroup, UserAttribute[]> = {
            identity: [],
            access: [],
            preferences: [],
            system: [],
            other: []
        };

        for (const attr of user.attributes) {
            const group = this.categorizeAttribute(attr.name);
            groups[group].push(attr);
        }

        // Sort attributes within each group
        for (const group of Object.values(groups)) {
            group.sort((a, b) => a.name.localeCompare(b.name));
        }

        const groupLabels: Record<AttributeGroup, string> = {
            identity: 'Identity',
            access: 'Access & Permissions',
            preferences: 'Preferences',
            system: 'System Attributes',
            other: 'Other Attributes'
        };

        const groupOrder: AttributeGroup[] = ['identity', 'access', 'preferences', 'other', 'system'];

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
                .groups-section {
                    margin-bottom: 24px;
                }
                .group-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                }
                .group-tag {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    cursor: pointer;
                }
                .group-tag:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .attribute {
                    display: flex;
                    padding: 6px 0;
                    border-bottom: 1px solid var(--vscode-panel-border);
                    align-items: flex-start;
                }
                .attribute:hover {
                    background: var(--vscode-list-hoverBackground);
                }
                .attribute.hidden {
                    display: none;
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
                    cursor: pointer;
                }
                .attr-name:hover {
                    text-decoration: underline;
                }
                .attr-value {
                    flex-grow: 1;
                    word-break: break-word;
                    cursor: pointer;
                }
                .attr-value:hover {
                    text-decoration: underline;
                }
                .attr-value.null {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
                .no-groups {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
            </style>
        </head>
        <body>
            <div class="header">
                <div class="header-title">
                    <span class="icon">&#128100;</span>
                    ${this.escapeHtml(user.userName)}
                </div>
                <div class="header-info">
                    Login: ${this.escapeHtml(user.userLoginName || 'N/A')} |
                    State: ${user.userState === 0 ? 'Active' : 'Inactive'} |
                    Source: ${this.escapeHtml(user.userSource || 'N/A')} |
                    Groups: ${this.userGroups.length}
                </div>
                <div class="header-actions">
                    <button onclick="refresh()">Refresh</button>
                    <button onclick="generateDql()" class="primary">Generate DQL</button>
                    <button onclick="copyUserName()">Copy User Name</button>
                    <button onclick="collapseAll()">Collapse All</button>
                    <button onclick="expandAll()">Expand All</button>
                </div>
                <div class="filter-bar">
                    <input type="text" id="filter" placeholder="Filter attributes by name or value..." oninput="filterAttributes(this.value)">
                </div>
            </div>
            <div class="content">
                <div class="groups-section">
                    <div class="group-header" onclick="toggleGroup('memberof')">
                        <span class="toggle" id="toggle-memberof">&#9660;</span>
                        Group Membership
                        <span class="count">${this.userGroups.length}</span>
                    </div>
                    <div class="group-content" id="group-memberof">
                        ${this.userGroups.length > 0
                            ? `<div class="group-tags">${this.userGroups.map(g => `<span class="group-tag" onclick="openGroup('${this.escapeHtml(g)}')">${this.escapeHtml(g)}</span>`).join('')}</div>`
                            : '<div class="no-groups">User is not a member of any groups</div>'
                        }
                    </div>
                </div>

                ${groupOrder.map(groupKey => {
                    const attrs = groups[groupKey];
                    if (attrs.length === 0) {
                        return '';
                    }
                    return `
                        <div class="group" data-group="${groupKey}">
                            <div class="group-header" onclick="toggleGroup('${groupKey}')">
                                <span class="toggle" id="toggle-${groupKey}">&#9660;</span>
                                ${groupLabels[groupKey]}
                                <span class="count" id="count-${groupKey}">${attrs.length}</span>
                            </div>
                            <div class="group-content" id="group-${groupKey}">
                                ${attrs.map(attr => this.renderAttribute(attr)).join('')}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
            <script>
                const vscode = acquireVsCodeApi();
                const userName = '${this.escapeHtml(user.userName)}';

                function refresh() {
                    vscode.postMessage({ command: 'refresh' });
                }

                function filterAttributes(value) {
                    const filter = value.toLowerCase();
                    document.querySelectorAll('.attribute').forEach(el => {
                        const name = (el.dataset.name || '').toLowerCase();
                        const attrValue = (el.dataset.value || '').toLowerCase();
                        const matches = !filter || name.includes(filter) || attrValue.includes(filter);
                        el.classList.toggle('hidden', !matches);
                    });

                    // Update group counts
                    document.querySelectorAll('.group').forEach(group => {
                        const groupKey = group.dataset.group;
                        const visibleAttrs = group.querySelectorAll('.attribute:not(.hidden)');
                        const countEl = document.getElementById('count-' + groupKey);
                        if (countEl) {
                            countEl.textContent = visibleAttrs.length;
                        }
                        group.style.display = visibleAttrs.length > 0 ? 'block' : 'none';
                    });
                }

                function copyUserName() {
                    vscode.postMessage({ command: 'copyValue', value: userName });
                }

                function copyValue(value) {
                    vscode.postMessage({ command: 'copyValue', value: value });
                }

                function generateDql() {
                    vscode.postMessage({ command: 'generateDql' });
                }

                function openGroup(groupName) {
                    vscode.postMessage({ command: 'openGroup', groupName: groupName });
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
    private renderAttribute(attr: UserAttribute): string {
        const valueStr = attr.value === null || attr.value === undefined
            ? 'null'
            : String(attr.value);
        const isNull = attr.value === null || attr.value === undefined || valueStr === '';

        return `<div class="attribute" data-name="${this.escapeHtml(attr.name)}" data-value="${this.escapeHtml(valueStr)}">
            <div class="attr-name" title="${this.escapeHtml(attr.name)}" onclick="copyValue('${this.escapeHtml(attr.name)}')">${this.escapeHtml(attr.name)}</div>
            <div class="attr-value${isNull ? ' null' : ''}" onclick="copyValue('${this.escapeHtml(valueStr)}')">${isNull ? '(empty)' : this.escapeHtml(valueStr)}</div>
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
        UserDumpPanel.currentPanel = undefined;

        this.panel.dispose();

        while (this.disposables.length) {
            const disposable = this.disposables.pop();
            if (disposable) {
                disposable.dispose();
            }
        }
    }
}
