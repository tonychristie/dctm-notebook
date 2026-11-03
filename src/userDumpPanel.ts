import * as vscode from 'vscode';
import { UserCache, UserInfo, UserAttribute } from './userCache';
import { escapeHtml } from './htmlUtils';
import { buildUserQuery } from './dqlQueries';
import { UserAttributeGroup as AttributeGroup, describeAttributeValue, groupUserAttributes } from './attributeGroups';
import { WebviewAssets, webviewAssets, webviewData, webviewResourceRoots } from './webviewHtml';

/**
 * WebviewPanel for displaying Documentum user details with grouped attributes
 */
export class UserDumpPanel {
    public static currentPanel: UserDumpPanel | undefined;
    private static allPanels: Set<UserDumpPanel> = new Set();
    private static panelCounter: number = 0;
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

        // Check the reuseWindow setting
        const config = vscode.workspace.getConfiguration('documentum.panels');
        const reuseWindow = config.get<boolean>('reuseWindow', false);

        // If reuseWindow is true and we already have a panel, show it and update content
        if (reuseWindow && UserDumpPanel.currentPanel) {
            UserDumpPanel.currentPanel.panel.reveal(column);
            await UserDumpPanel.currentPanel.loadUser(userName);
            return;
        }

        // Create a new panel
        UserDumpPanel.panelCounter++;
        const panelTitle = reuseWindow ? `User: ${userName}` : `User #${UserDumpPanel.panelCounter}: ${userName}`;
        const panel = vscode.window.createWebviewPanel(
            UserDumpPanel.viewType,
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewResourceRoots(extensionUri)
            }
        );

        const userPanel = new UserDumpPanel(panel, userCache, extensionUri);
        UserDumpPanel.allPanels.add(userPanel);

        // Only track as currentPanel when reuseWindow is true
        if (reuseWindow) {
            UserDumpPanel.currentPanel = userPanel;
        }

        await userPanel.loadUser(userName);
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
                        await this.loadUser(this.currentUserName, true);
                        break;
                    case 'copyValue':
                        await vscode.env.clipboard.writeText(message.value);
                        vscode.window.showInformationMessage('Value copied to clipboard');
                        break;
                    case 'generateDql':
                        await this.generateDqlQuery();
                        break;
                    case 'openGroup':
                        await vscode.commands.executeCommand('dctm.openGroupByName', message.groupName);
                        break;
                    case 'dumpObject':
                        await vscode.commands.executeCommand('dctm.dumpObject', message.objectId);
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
    public async loadUser(userName: string, refresh = false): Promise<void> {
        this.currentUserName = userName;
        this.panel.title = `User: ${userName}`;
        this.panel.webview.html = this.getLoadingHtml();

        try {
            const user = await this.userCache.fetchUserDetails(userName, refresh);
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
     * Generate a DQL query for the current user
     */
    private async generateDqlQuery(): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({
            content: buildUserQuery(this.currentUserName),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    private assets(): WebviewAssets {
        return webviewAssets(this.panel.webview, this.extensionUri, 'userDumpPanel');
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
                <div>Loading user...</div>
            </div>
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Generate error HTML
     */
    private getErrorHtml(userName: string, error: string): string {
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
                <div class="error-title">Failed to load user: ${escapeHtml(userName)}</div>
                <div>${escapeHtml(error)}</div>
                <button data-action="refresh">Retry</button>
            </div>
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Generate content HTML with user details and grouped attributes
     */
    private getContentHtml(user: UserInfo): string {
        const groups = groupUserAttributes(user.attributes);

        const groupLabels: Record<AttributeGroup, string> = {
            identity: 'Identity',
            access: 'Access & Permissions',
            preferences: 'Preferences',
            system: 'System Attributes',
            other: 'Other Attributes'
        };

        const groupOrder: AttributeGroup[] = ['identity', 'access', 'preferences', 'other', 'system'];

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
                .attr-value.object-id {
                    color: var(--vscode-textLink-foreground);
                    cursor: pointer;
                }
                .attr-value.object-id:hover {
                    text-decoration: underline;
                    color: var(--vscode-textLink-activeForeground);
                }
                .no-groups {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
            </style>
        </head>
        <body ${webviewData({ userName: user.userName })}>
            <div class="header">
                <div class="header-title">
                    <span class="icon">&#128100;</span>
                    ${escapeHtml(user.userName)}
                </div>
                <div class="header-info">
                    Login: ${escapeHtml(user.userLoginName || 'N/A')} |
                    State: ${user.userState === 0 ? 'Active' : 'Inactive'} |
                    Source: ${escapeHtml(user.userSource || 'N/A')} |
                    Groups: ${this.userGroups.length}
                </div>
                <div class="header-actions">
                    <button data-action="refresh">Refresh</button>
                    <button data-action="generateDql" class="primary">Generate DQL</button>
                    <button data-action="copyUserName">Copy User Name</button>
                    <button data-action="collapseAll">Collapse All</button>
                    <button data-action="expandAll">Expand All</button>
                </div>
                <div class="filter-bar">
                    <input type="text" id="filter" placeholder="Filter attributes by name or value...">
                </div>
            </div>
            <div class="content">
                <div class="groups-section">
                    <div class="group-header" data-action="toggleGroup">
                        <span class="toggle" id="toggle-memberof">&#9660;</span>
                        Group Membership
                        <span class="count">${this.userGroups.length}</span>
                    </div>
                    <div class="group-content" id="group-memberof">
                        ${this.userGroups.length > 0
                            ? `<div class="group-tags">${this.userGroups.map(g => `<span class="group-tag" data-action="openGroup" data-value="${escapeHtml(g)}">${escapeHtml(g)}</span>`).join('')}</div>`
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
                            <div class="group-header" data-action="toggleGroup">
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
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Render a single attribute row
     */
    private renderAttribute(attr: UserAttribute): string {
        const { text: valueStr, isEmpty: isNull, isObjectId: isObjectIdField } = describeAttributeValue(attr.value);
        const valueClass = isNull ? ' null' : (isObjectIdField ? ' object-id' : '');
        const valueAction = isObjectIdField ? 'dumpObject' : 'copyValue';

        return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-value="${escapeHtml(valueStr)}">
            <div class="attr-name" title="${escapeHtml(attr.name)}" data-action="copyValue" data-value="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
            <div class="attr-value${valueClass}" data-action="${valueAction}" data-value="${escapeHtml(valueStr)}">${isNull ? '(empty)' : escapeHtml(valueStr)}</div>
        </div>`;
    }

    public dispose(): void {
        UserDumpPanel.allPanels.delete(this);
        if (UserDumpPanel.currentPanel === this) {
            UserDumpPanel.currentPanel = undefined;
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
