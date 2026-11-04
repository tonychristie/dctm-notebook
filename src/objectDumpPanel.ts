import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { escapeHtml, isObjectId } from './htmlUtils';
import { NavigationHistory } from './navigationHistory';
import { DctmBridge } from './dctmBridge';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';
import {
    ObjectAttributeEntry,
    ObjectAttributeGroup as AttributeGroup,
    formatAttributeValue,
    groupObjectAttributes,
    toObjectAttributeEntry
} from './attributeGroups';

export interface ObjectDump {
    objectId: string;
    typeName: string;
    objectName: string;
    attributes: ObjectAttributeEntry[];
    standardAttributeNames: ReadonlySet<string> | undefined;
    fetchTime: number;
}

export interface NavigationEntry {
    connectionName: string;
    objectId: string;
    objectName: string;
    typeName: string;
}

const config: DumpPanelConfig = {
    viewType: 'dctmObjectDump',
    entry: 'objectDumpPanel',
    title: 'Object',
    noun: 'object'
};

export class ObjectDumpPanel extends DumpPanelBase<string, ObjectDump> {
    private history = new NavigationHistory<NavigationEntry>();

    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        objectId: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, objectId,
            panel => new ObjectDumpPanel(panel, connectionManager, connectionName, objectId, extensionUri));
    }

    public constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        objectId: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, objectId, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'dumpObject':
                await this.load(message.objectId, this.connectionName);
                break;
            case 'goBack':
                await this.showHistoryEntry(this.history.back());
                break;
            case 'goForward':
                await this.showHistoryEntry(this.history.forward());
                break;
        }
    }

    // Loads as a refresh, so the entry the history already holds is not added again.
    private async showHistoryEntry(entry: NavigationEntry | undefined): Promise<void> {
        if (entry) {
            await this.load(entry.objectId, entry.connectionName, true);
        }
    }

    protected onLatestResponse(dump: ObjectDump, refresh: boolean): void {
        const titleParts = [dump.objectId];
        if (dump.objectName) {
            titleParts.push(dump.objectName);
        }
        titleParts.push(dump.typeName);
        this.panel.title = titleParts.join(' ');

        if (!refresh) {
            this.history.add({
                connectionName: this.connectionName,
                objectId: dump.objectId,
                objectName: dump.objectName,
                typeName: dump.typeName
            });
        }
    }

    protected async fetch(connection: RepositoryConnection, objectId: string): Promise<ObjectDump> {
        const dump = await this.fetchObjectFromBridge(connection.bridge, connection.sessionId, objectId, Date.now());
        dump.standardAttributeNames = await this.fetchStandardAttributeNames(connection, dump.typeName);
        return dump;
    }

    private async fetchStandardAttributeNames(
        connection: RepositoryConnection,
        typeName: string
    ): Promise<ReadonlySet<string> | undefined> {
        const typeCache = connection.typeCache;
        const standardTypeName = typeCache.getNearestStandardType(typeName);
        if (!standardTypeName) {
            return undefined;
        }
        const type = await typeCache.fetchTypeDetails(standardTypeName);
        // fetchTypeDetails returns the type with no attributes when the request fails.
        if (!type || type.attributes.length === 0) {
            return undefined;
        }
        return new Set(type.attributes.map(attr => attr.name));
    }

    // An attribute arrives as { type, value, repeating } or, from dfc-bridge 1.2.0, as a plain value.
    private async fetchObjectFromBridge(
        bridge: DctmBridge,
        sessionId: string,
        objectId: string,
        startTime: number
    ): Promise<ObjectDump> {
        const objectInfo = await bridge.getObject(sessionId, objectId);
        const fetchTime = Date.now() - startTime;

        const attributes = Object.entries(objectInfo.attributes)
            .map(([name, entry]) => toObjectAttributeEntry(name, entry));

        return {
            objectId: objectInfo.objectId,
            typeName: objectInfo.type || 'unknown',
            objectName: objectInfo.name || objectId,
            attributes,
            standardAttributeNames: undefined,
            fetchTime
        };
    }

    protected pageData(dump: ObjectDump): unknown {
        return { objectId: dump.objectId };
    }

    protected renderContent(dump: ObjectDump): string {
        const groups = groupObjectAttributes(dump.attributes, dump.standardAttributeNames);

        const groupLabels: Record<AttributeGroup, string> = {
            custom: 'Custom Attributes',
            standard: 'Standard Attributes',
            system: 'System Attributes (r_)',
            application: 'Application Attributes (a_)',
            internal: 'Internal Attributes (i_)'
        };

        const groupOrder: AttributeGroup[] = ['custom', 'standard', 'application', 'system', 'internal'];

        return `<div class="header">
                <div class="header-title">${escapeHtml(dump.objectName)}</div>
                <div class="header-info">
                    Type: ${escapeHtml(dump.typeName)} |
                    ID: <span class="object-id">${escapeHtml(dump.objectId)}</span> |
                    ${dump.attributes.length} attributes |
                    Loaded in ${dump.fetchTime}ms
                </div>
                <div class="header-actions">
                    <span class="nav-buttons">
                        <button data-action="goBack" ${this.history.canGoBack() ? '' : 'disabled'} title="Go back">&#9664;</button>
                        <button data-action="goForward" ${this.history.canGoForward() ? '' : 'disabled'} title="Go forward">&#9654;</button>
                    </span>
                    <button data-action="refresh">Refresh</button>
                    <button data-action="copyObjectId">Copy Object ID</button>
                    <button data-action="collapseAll">Collapse All</button>
                    <button data-action="expandAll">Expand All</button>
                </div>
                <div class="filter-bar">
                    <input type="text" id="filter" placeholder="Filter attributes...">
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
                            <div class="group-header" data-action="toggleGroup">
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
            <div id="notification" class="copy-notification"></div>`;
    }

    private renderAttribute(attr: ObjectAttributeEntry): string {
        const valueStr = formatAttributeValue(attr.value, attr.isRepeating);
        const valueIsObjId = isObjectId(attr.value);
        const valueClass = attr.value === null ? 'null' : (valueIsObjId ? 'object-id' : '');

        let valueHtml: string;
        if (attr.isRepeating && Array.isArray(attr.value)) {
            valueHtml = `<div class="repeating-values">
                ${(attr.value as unknown[]).map((v, i) => {
                    const itemIsObjId = isObjectId(v);
                    const itemClass = v === null ? 'null' : (itemIsObjId ? 'object-id' : '');
                    const action = itemIsObjId ? 'dumpObject' : 'copyValue';
                    return `<div class="repeating-value">
                        <span class="repeating-index">[${i}]</span>
                        <span class="${itemClass}" data-action="${action}" data-value="${escapeHtml(String(v ?? ''))}">${escapeHtml(String(v ?? 'NULL'))}</span>
                    </div>`;
                }).join('')}
            </div>`;
        } else {
            const action = valueIsObjId ? 'dumpObject' : 'copyValue';
            valueHtml = `<span class="${valueClass}" data-action="${action}" data-value="${escapeHtml(String(attr.value ?? ''))}">${escapeHtml(valueStr)}</span>`;
        }

        return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-value="${escapeHtml(valueStr)}">
            <div class="attr-name" title="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
            <div class="attr-type">${escapeHtml(attr.type)}</div>
            <div class="attr-value">${valueHtml}</div>
        </div>`;
    }
}
