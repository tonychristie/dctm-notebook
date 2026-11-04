import * as vscode from 'vscode';
import { TypeInfo, TypeAttribute } from './typeCache';
import { ConnectionManager } from './connectionManager';
import { escapeHtml } from './htmlUtils';
import { buildTypeQuery } from './dqlQueries';
import { TypeAttributeGroup as AttributeGroup, formatTypeDisplay, groupTypeAttributes } from './attributeGroups';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';

interface TypeDump {
    type: TypeInfo;
    childTypes: string[];
}

const config: DumpPanelConfig = {
    viewType: 'dctmTypeDump',
    entry: 'typeDumpPanel',
    title: 'Type',
    noun: 'type'
};

export class TypeDumpPanel extends DumpPanelBase<string, TypeDump> {
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        typeName: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, typeName,
            panel => new TypeDumpPanel(panel, connectionManager, connectionName, typeName, extensionUri));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        typeName: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, typeName, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'openType':
                await this.load(message.typeName, this.connectionName);
                break;
            case 'generateDql':
                await this.generateDqlQuery();
                break;
        }
    }

    protected async fetch(connection: RepositoryConnection, typeName: string, refresh: boolean): Promise<TypeDump> {
        const type = await connection.typeCache.fetchTypeDetails(typeName, refresh);
        if (!type) {
            throw new Error('Type not found');
        }
        return { type, childTypes: connection.typeCache.getChildTypes(type.name) };
    }

    private async generateDqlQuery(): Promise<void> {
        const connection = this.connectionManager.getOpenConnection(this.connectionName);
        const type = await connection?.typeCache.fetchTypeDetails(this.currentKey);
        if (!type) {
            return;
        }

        const doc = await vscode.workspace.openTextDocument({
            content: buildTypeQuery(type),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    protected pageData({ type }: TypeDump): unknown {
        return { typeName: type.name };
    }

    protected renderContent({ type, childTypes }: TypeDump): string {
        const groups = groupTypeAttributes(type.attributes);

        const groupLabels: Record<AttributeGroup, string> = {
            custom: 'Type-Specific Attributes',
            standard: 'Standard Attributes',
            system: 'System Attributes (r_)',
            application: 'Application Attributes (a_)',
            internal: 'Internal Attributes (i_)'
        };

        const groupOrder: AttributeGroup[] = ['custom', 'standard', 'application', 'system', 'internal'];

        const totalAttrs = type.attributes.length;
        const inheritedAttrs = type.attributes.filter(a => a.isInherited).length;
        const ownAttrs = totalAttrs - inheritedAttrs;

        return `<div class="header">
                <div class="header-title">
                    <span class="codicon codicon-symbol-class"></span>
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
            </div>`;
    }

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
}
