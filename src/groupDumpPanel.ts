import * as vscode from 'vscode';
import { GroupInfo, GroupAttribute } from './groupCache';
import { ConnectionManager } from './connectionManager';
import { escapeHtml } from './htmlUtils';
import { buildGroupQuery } from './dqlQueries';
import { GroupAttributeGroup as AttributeGroup, describeAttributeValue, groupGroupAttributes } from './attributeGroups';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';

interface GroupDump {
    group: GroupInfo;
    parentGroups: string[];
}

const config: DumpPanelConfig = {
    viewType: 'dctmGroupDump',
    entry: 'groupDumpPanel',
    title: 'Group',
    noun: 'group'
};

export class GroupDumpPanel extends DumpPanelBase<string, GroupDump> {
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        groupName: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, groupName,
            panel => new GroupDumpPanel(panel, connectionManager, connectionName, groupName, extensionUri));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        groupName: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, groupName, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'generateDql':
                await this.generateDqlQuery();
                break;
            case 'openGroup':
                await GroupDumpPanel.createOrShow(
                    this.extensionUri,
                    this.connectionManager,
                    this.connectionName,
                    message.groupName
                );
                break;
            case 'openUser':
                await vscode.commands.executeCommand('dctm.openUserByName', message.userName, this.connectionName);
                break;
            case 'dumpObject':
                await vscode.commands.executeCommand('dctm.dumpObject', message.objectId, this.connectionName);
                break;
        }
    }

    protected async fetch(connection: RepositoryConnection, groupName: string, refresh: boolean): Promise<GroupDump> {
        const group = await connection.groupCache.fetchGroupDetails(groupName, refresh);
        const parentGroups = await connection.groupCache.getParentGroups(groupName);
        return { group, parentGroups };
    }

    private async generateDqlQuery(): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({
            content: buildGroupQuery(this.currentKey),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    protected pageData({ group }: GroupDump): unknown {
        return { groupName: group.groupName };
    }

    protected renderContent({ group, parentGroups }: GroupDump): string {
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

        return `<div class="header">
                <div class="header-title">
                    <span class="codicon codicon-organization"></span>
                    ${escapeHtml(group.groupName)}
                </div>
                <div class="header-badges">
                    ${group.isPrivate ? '<span class="badge private">Private</span>' : ''}
                    ${group.isDynamic ? '<span class="badge dynamic">Dynamic</span>' : ''}
                    <span class="badge">${escapeHtml(group.groupClass || 'group')}</span>
                </div>
                <div class="header-info">
                    Owner: ${escapeHtml(group.owner || 'N/A')} |
                    Admin: ${escapeHtml(group.groupAdmin || 'N/A')} |
                    Members: ${group.members.length} users, ${group.groupMembers.length} groups |
                    Parent Groups: ${parentGroups.length}
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
                ${parentGroups.length > 0 ? `
                <div class="members-section">
                    <div class="group-header" data-action="toggleGroup">
                        <span class="toggle" id="toggle-parents">&#9660;</span>
                        Parent Groups (Member Of)
                        <span class="count">${parentGroups.length}</span>
                    </div>
                    <div class="group-content" id="group-parents">
                        <div class="member-tags">
                            ${parentGroups.map(g => `<span class="member-tag group" data-action="openGroup" data-value="${escapeHtml(g)}">${escapeHtml(g)}</span>`).join('')}
                        </div>
                    </div>
                </div>
                ` : ''}

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
            </div>`;
    }

    private renderAttribute(attr: GroupAttribute): string {
        const { text: valueStr, isEmpty: isNull, isObjectId: isObjectIdField } = describeAttributeValue(attr.value);
        const valueClass = isNull ? ' null' : (isObjectIdField ? ' object-id' : '');
        const valueAction = isObjectIdField ? 'dumpObject' : 'copyValue';

        return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-value="${escapeHtml(valueStr)}">
            <div class="attr-name" title="${escapeHtml(attr.name)}" data-action="copyValue" data-value="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
            <div class="attr-value${valueClass}" data-action="${valueAction}" data-value="${escapeHtml(valueStr)}">${isNull ? '(empty)' : escapeHtml(valueStr)}</div>
        </div>`;
    }
}
