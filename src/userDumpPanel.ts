import * as vscode from 'vscode';
import { UserInfo, UserAttribute } from './userCache';
import { ConnectionManager } from './connectionManager';
import { escapeHtml } from './htmlUtils';
import { buildUserQuery } from './dqlQueries';
import { UserAttributeGroup as AttributeGroup, describeAttributeValue, groupUserAttributes } from './attributeGroups';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';

interface UserDump {
    user: UserInfo;
    groups: string[];
}

const config: DumpPanelConfig = {
    viewType: 'dctmUserDump',
    entry: 'userDumpPanel',
    title: 'User',
    noun: 'user'
};

export class UserDumpPanel extends DumpPanelBase<string, UserDump> {
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        userName: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, userName,
            panel => new UserDumpPanel(panel, connectionManager, connectionName, userName, extensionUri));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        userName: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, userName, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'generateDql':
                await this.generateDqlQuery();
                break;
            case 'openGroup':
                await vscode.commands.executeCommand('dctm.openGroupByName', message.groupName, this.connectionName);
                break;
            case 'dumpObject':
                await vscode.commands.executeCommand('dctm.dumpObject', message.objectId, this.connectionName);
                break;
        }
    }

    protected async fetch(connection: RepositoryConnection, userName: string, refresh: boolean): Promise<UserDump> {
        const user = await connection.userCache.fetchUserDetails(userName, refresh);
        if (!user) {
            throw new Error('User not found');
        }
        const groups = await connection.userCache.getUserGroups(userName);
        return { user, groups };
    }

    private async generateDqlQuery(): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({
            content: buildUserQuery(this.currentKey),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    protected pageData({ user }: UserDump): unknown {
        return { userName: user.userName };
    }

    protected renderContent({ user, groups: userGroups }: UserDump): string {
        const groups = groupUserAttributes(user.attributes);

        const groupLabels: Record<AttributeGroup, string> = {
            identity: 'Identity',
            access: 'Access & Permissions',
            preferences: 'Preferences',
            system: 'System Attributes',
            other: 'Other Attributes'
        };

        const groupOrder: AttributeGroup[] = ['identity', 'access', 'preferences', 'other', 'system'];

        return `<div class="header">
                <div class="header-title">
                    <span class="codicon codicon-person"></span>
                    ${escapeHtml(user.userName)}
                </div>
                <div class="header-info">
                    Login: ${escapeHtml(user.userLoginName || 'N/A')} |
                    State: ${user.userState === 0 ? 'Active' : 'Inactive'} |
                    Source: ${escapeHtml(user.userSource || 'N/A')} |
                    Groups: ${userGroups.length}
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
                        <span class="count">${userGroups.length}</span>
                    </div>
                    <div class="group-content" id="group-memberof">
                        ${userGroups.length > 0
                            ? `<div class="group-tags">${userGroups.map(g => `<span class="group-tag" data-action="openGroup" data-value="${escapeHtml(g)}">${escapeHtml(g)}</span>`).join('')}</div>`
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
            </div>`;
    }

    private renderAttribute(attr: UserAttribute): string {
        const { text: valueStr, isEmpty: isNull, isObjectId: isObjectIdField } = describeAttributeValue(attr.value);
        const valueClass = isNull ? ' null' : (isObjectIdField ? ' object-id' : '');
        const valueAction = isObjectIdField ? 'dumpObject' : 'copyValue';

        return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-value="${escapeHtml(valueStr)}">
            <div class="attr-name" title="${escapeHtml(attr.name)}" data-action="copyValue" data-value="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
            <div class="attr-value${valueClass}" data-action="${valueAction}" data-value="${escapeHtml(valueStr)}">${isNull ? '(empty)' : escapeHtml(valueStr)}</div>
        </div>`;
    }
}
