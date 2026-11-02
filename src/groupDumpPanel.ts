import * as vscode from 'vscode';
import { GroupCache, GroupInfo, GroupAttribute } from './groupCache';
import { escapeHtml } from './htmlUtils';
import { buildGroupQuery } from './dqlQueries';
import { GroupAttributeGroup as AttributeGroup, describeAttributeValue, groupGroupAttributes } from './attributeGroups';
import { WebviewAssets, webviewAssets, webviewData, webviewResourceRoots } from './webviewHtml';

/**
 * WebviewPanel for displaying Documentum group details with grouped attributes
 */
export class GroupDumpPanel {
    public static currentPanel: GroupDumpPanel | undefined;
    private static allPanels: Set<GroupDumpPanel> = new Set();
    private static panelCounter: number = 0;
    private static readonly viewType = 'dctmGroupDump';

    private readonly panel: vscode.WebviewPanel;
    private readonly groupCache: GroupCache;
    private disposables: vscode.Disposable[] = [];

    // Current state
    private currentGroupName: string = '';
    private parentGroups: string[] = [];

    public static async createOrShow(
        extensionUri: vscode.Uri,
        groupCache: GroupCache,
        groupName: string
    ): Promise<void> {
        const column = vscode.window.activeTextEditor
            ? vscode.window.activeTextEditor.viewColumn
            : undefined;

        // Check the reuseWindow setting
        const config = vscode.workspace.getConfiguration('documentum.panels');
        const reuseWindow = config.get<boolean>('reuseWindow', false);

        // If reuseWindow is true and we already have a panel, show it and update content
        if (reuseWindow && GroupDumpPanel.currentPanel) {
            GroupDumpPanel.currentPanel.panel.reveal(column);
            await GroupDumpPanel.currentPanel.loadGroup(groupName);
            return;
        }

        // Create a new panel
        GroupDumpPanel.panelCounter++;
        const panelTitle = reuseWindow ? `Group: ${groupName}` : `Group #${GroupDumpPanel.panelCounter}: ${groupName}`;
        const panel = vscode.window.createWebviewPanel(
            GroupDumpPanel.viewType,
            panelTitle,
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: webviewResourceRoots(extensionUri)
            }
        );

        const groupPanel = new GroupDumpPanel(panel, groupCache, extensionUri);
        GroupDumpPanel.allPanels.add(groupPanel);

        // Only track as currentPanel when reuseWindow is true
        if (reuseWindow) {
            GroupDumpPanel.currentPanel = groupPanel;
        }

        await groupPanel.loadGroup(groupName);
    }

    private constructor(
        panel: vscode.WebviewPanel,
        groupCache: GroupCache,
        private readonly extensionUri: vscode.Uri
    ) {
        this.panel = panel;
        this.groupCache = groupCache;

        // Set initial loading content
        this.panel.webview.html = this.getLoadingHtml();

        // Handle panel disposal
        this.panel.onDidDispose(() => this.dispose(), null, this.disposables);

        // Handle messages from the webview
        this.panel.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'refresh':
                        await this.loadGroup(this.currentGroupName);
                        break;
                    case 'copyValue':
                        await vscode.env.clipboard.writeText(message.value);
                        vscode.window.showInformationMessage('Value copied to clipboard');
                        break;
                    case 'generateDql':
                        await this.generateDqlQuery();
                        break;
                    case 'openGroup':
                        await GroupDumpPanel.createOrShow(this.extensionUri, this.groupCache, message.groupName);
                        break;
                    case 'openUser':
                        await vscode.commands.executeCommand('dctm.openUserByName', message.userName);
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
     * Load and display a group's details
     */
    public async loadGroup(groupName: string): Promise<void> {
        this.currentGroupName = groupName;
        this.panel.title = `Group: ${groupName}`;
        this.panel.webview.html = this.getLoadingHtml();

        try {
            const group = await this.groupCache.fetchGroupDetails(groupName);
            if (!group) {
                this.panel.webview.html = this.getErrorHtml(groupName, 'Group not found');
                return;
            }

            // Fetch parent groups
            this.parentGroups = await this.groupCache.getParentGroups(groupName);

            this.panel.webview.html = this.getContentHtml(group);
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.panel.webview.html = this.getErrorHtml(groupName, errorMessage);
        }
    }

    /**
     * Generate a DQL query for the current group
     */
    private async generateDqlQuery(): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({
            content: buildGroupQuery(this.currentGroupName),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    private assets(): WebviewAssets {
        return webviewAssets(this.panel.webview, this.extensionUri, 'groupDumpPanel');
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
                <div>Loading group...</div>
            </div>
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Generate error HTML
     */
    private getErrorHtml(groupName: string, error: string): string {
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
                <div class="error-title">Failed to load group: ${escapeHtml(groupName)}</div>
                <div>${escapeHtml(error)}</div>
                <button data-action="refresh">Retry</button>
            </div>
            ${assets.script}
        </body>
        </html>`;
    }

    /**
     * Generate content HTML with group details and grouped attributes
     */
    private getContentHtml(group: GroupInfo): string {
        const groups = groupGroupAttributes(group.attributes);

        const groupLabels: Record<AttributeGroup, string> = {
            identity: 'Identity',
            access: 'Access & Settings',
            members: 'Members',
            system: 'System Attributes',
            other: 'Other Attributes'
        };

        const groupOrder: AttributeGroup[] = ['identity', 'access', 'other', 'system'];

        const totalMembers = group.members.length + group.groupMembers.length;

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
                .header-badges {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                .badge {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 10px;
                }
                .badge.private {
                    background: var(--vscode-editorWarning-foreground);
                }
                .badge.dynamic {
                    background: var(--vscode-editorInfo-foreground);
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
                .members-section {
                    margin-bottom: 24px;
                }
                .member-tags {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-bottom: 8px;
                }
                .member-tag {
                    background: var(--vscode-badge-background);
                    color: var(--vscode-badge-foreground);
                    padding: 4px 8px;
                    border-radius: 4px;
                    font-size: 11px;
                    cursor: pointer;
                }
                .member-tag:hover {
                    background: var(--vscode-button-secondaryHoverBackground);
                }
                .member-tag.user {
                    background: var(--vscode-editor-selectionBackground);
                }
                .member-tag.group {
                    background: var(--vscode-editor-inactiveSelectionBackground);
                }
                .subsection-label {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 6px;
                    margin-top: 12px;
                }
                .subsection-label:first-child {
                    margin-top: 0;
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
                .no-members {
                    color: var(--vscode-descriptionForeground);
                    font-style: italic;
                }
            </style>
        </head>
        <body ${webviewData({ groupName: group.groupName })}>
            <div class="header">
                <div class="header-title">
                    <span class="icon">&#128101;</span>
                    ${escapeHtml(group.groupName)}
                </div>
                <div class="header-badges">
                    ${group.isPrivate ? '<span class="badge private">Private</span>' : ''}
                    ${group.isDynamic ? '<span class="badge dynamic">Dynamic</span>' : ''}
                    <span class="badge">${group.groupClass || 'group'}</span>
                </div>
                <div class="header-info">
                    Owner: ${escapeHtml(group.owner || 'N/A')} |
                    Admin: ${escapeHtml(group.groupAdmin || 'N/A')} |
                    Members: ${group.members.length} users, ${group.groupMembers.length} groups |
                    Parent Groups: ${this.parentGroups.length}
                </div>
                <div class="header-actions">
                    <button data-action="refresh">Refresh</button>
                    <button data-action="generateDql" class="primary">Generate DQL</button>
                    <button data-action="copyGroupName">Copy Group Name</button>
                    <button data-action="collapseAll">Collapse All</button>
                    <button data-action="expandAll">Expand All</button>
                </div>
                <div class="filter-bar">
                    <input type="text" id="filter" placeholder="Filter attributes by name or value...">
                </div>
            </div>
            <div class="content">
                <!-- Parent Groups Section -->
                ${this.parentGroups.length > 0 ? `
                <div class="members-section">
                    <div class="group-header" data-action="toggleGroup">
                        <span class="toggle" id="toggle-parents">&#9660;</span>
                        Parent Groups (Member Of)
                        <span class="count">${this.parentGroups.length}</span>
                    </div>
                    <div class="group-content" id="group-parents">
                        <div class="member-tags">
                            ${this.parentGroups.map(g => `<span class="member-tag group" data-action="openGroup" data-value="${escapeHtml(g)}">${escapeHtml(g)}</span>`).join('')}
                        </div>
                    </div>
                </div>
                ` : ''}

                <!-- Members Section -->
                <div class="members-section">
                    <div class="group-header" data-action="toggleGroup">
                        <span class="toggle" id="toggle-members">&#9660;</span>
                        Members
                        <span class="count">${totalMembers}</span>
                    </div>
                    <div class="group-content" id="group-members">
                        ${totalMembers === 0 ? '<div class="no-members">Group has no members</div>' : ''}
                        ${group.members.length > 0 ? `
                            <div class="subsection-label">Users (${group.members.length})</div>
                            <div class="member-tags">
                                ${group.members.map(u => `<span class="member-tag user" data-action="openUser" data-value="${escapeHtml(u)}">${escapeHtml(u)}</span>`).join('')}
                            </div>
                        ` : ''}
                        ${group.groupMembers.length > 0 ? `
                            <div class="subsection-label">Groups (${group.groupMembers.length})</div>
                            <div class="member-tags">
                                ${group.groupMembers.map(g => `<span class="member-tag group" data-action="openGroup" data-value="${escapeHtml(g)}">${escapeHtml(g)}</span>`).join('')}
                            </div>
                        ` : ''}
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
    private renderAttribute(attr: GroupAttribute): string {
        const { text: valueStr, isEmpty: isNull, isObjectId: isObjectIdField } = describeAttributeValue(attr.value);
        const valueClass = isNull ? ' null' : (isObjectIdField ? ' object-id' : '');
        const valueAction = isObjectIdField ? 'dumpObject' : 'copyValue';

        return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-value="${escapeHtml(valueStr)}">
            <div class="attr-name" title="${escapeHtml(attr.name)}" data-action="copyValue" data-value="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
            <div class="attr-value${valueClass}" data-action="${valueAction}" data-value="${escapeHtml(valueStr)}">${isNull ? '(empty)' : escapeHtml(valueStr)}</div>
        </div>`;
    }

    public dispose(): void {
        GroupDumpPanel.allPanels.delete(this);
        if (GroupDumpPanel.currentPanel === this) {
            GroupDumpPanel.currentPanel = undefined;
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
