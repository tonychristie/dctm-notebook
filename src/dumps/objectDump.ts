import { escapeHtml, isObjectIdLink } from '../htmlUtils';
import { RepositoryConnection } from '../repositoryConnection';
import {
    ObjectAttributeEntry,
    ObjectAttributeGroup as AttributeGroup,
    formatAttributeValue,
    groupObjectAttributes,
    toObjectAttributeEntry
} from '../attributeGroups';

export interface ObjectDump {
    objectId: string;
    typeName: string;
    objectName: string;
    attributes: ObjectAttributeEntry[];
    standardAttributeNames: ReadonlySet<string> | undefined;
    fetchTime: number;
}

export async function fetchObjectDump(connection: RepositoryConnection, objectId: string): Promise<ObjectDump> {
    const startTime = Date.now();
    const dump = await fetchObjectFromBridge(connection, objectId, startTime);
    dump.standardAttributeNames = await fetchStandardAttributeNames(connection, dump.typeName);
    return dump;
}

async function fetchStandardAttributeNames(
    connection: RepositoryConnection,
    typeName: string
): Promise<ReadonlySet<string> | undefined> {
    const typeCache = connection.typeCache;
    const standardTypeName = typeCache.getNearestStandardType(typeName);
    if (!standardTypeName) {
        return undefined;
    }
    let type;
    try {
        type = await typeCache.fetchTypeDetails(standardTypeName);
    } catch {
        return undefined;
    }
    if (!type || type.attributes.length === 0) {
        return undefined;
    }
    return new Set(type.attributes.map(attr => attr.name));
}

// An attribute arrives as { type, value, repeating } or, from dfc-bridge 1.2.0, as a plain value.
async function fetchObjectFromBridge(
    connection: RepositoryConnection,
    objectId: string,
    startTime: number
): Promise<ObjectDump> {
    const objectInfo = await connection.bridge.getObject(connection.sessionId, objectId);
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

const groupLabels: Record<AttributeGroup, string> = {
    custom: 'Custom Attributes',
    standard: 'Standard Attributes',
    system: 'System Attributes (r_)',
    application: 'Application Attributes (a_)',
    internal: 'Internal Attributes (i_)'
};

const groupOrder: AttributeGroup[] = ['custom', 'standard', 'application', 'system', 'internal'];

export function renderObjectDump(dump: ObjectDump, leadingActions = ''): string {
    const groups = groupObjectAttributes(dump.attributes, dump.standardAttributeNames);

    return `<div class="header">
            <div class="header-title">${escapeHtml(dump.objectName)}</div>
            <div class="header-info">
                Type: ${escapeHtml(dump.typeName)} |
                ID: <span class="object-id">${escapeHtml(dump.objectId)}</span> |
                ${dump.attributes.length} attributes |
                Loaded in ${dump.fetchTime}ms
            </div>
            <div class="header-actions">
                ${leadingActions}
                <button data-action="refresh">Refresh</button>
                <button data-action="copyObjectId" data-value="${escapeHtml(dump.objectId)}">Copy Object ID</button>
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
                        <div class="group-content">
                            ${attrs.map(renderAttribute).join('')}
                        </div>
                    </div>
                `;
            }).join('')}
        </div>
        <div class="copy-notification"></div>`;
}

function renderAttribute(attr: ObjectAttributeEntry): string {
    const valueStr = formatAttributeValue(attr.value, attr.isRepeating);
    const valueIsObjId = isObjectIdLink(attr.value);
    const valueClass = attr.value === null ? 'null' : (valueIsObjId ? 'object-id' : '');

    let valueHtml: string;
    if (attr.isRepeating && Array.isArray(attr.value)) {
        valueHtml = `<div class="repeating-values">
            ${(attr.value as unknown[]).map((v, i) => {
                const itemIsObjId = isObjectIdLink(v);
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

export function loadingFragment(noun: string): string {
    return `<div class="loader">
            <div class="spinner"></div>
            <div>Loading ${noun}...</div>
        </div>`;
}

export function errorFragment(noun: string, key: string, error: string): string {
    return `<div class="error-page">
            <div class="error">
                <div class="error-title">Failed to load ${noun}: ${escapeHtml(key)}</div>
                <div>${escapeHtml(error)}</div>
                <button data-action="refresh">Retry</button>
            </div>
        </div>`;
}
