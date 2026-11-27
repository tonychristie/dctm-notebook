import { GroupAttributeGroup as AttributeGroup, describeAttributeValue, groupGroupAttributes } from '../attributeGroups';
import { GroupAttribute, GroupInfo } from '../groupCache';
import { escapeHtml } from '../htmlUtils';
import { RepositoryConnection } from '../repositoryConnection';

export interface GroupDump {
    group: GroupInfo;
    parentGroups: string[];
}

export async function fetchGroupDump(connection: RepositoryConnection, groupName: string, refresh: boolean): Promise<GroupDump> {
    const group = await connection.groupCache.fetchGroupDetails(groupName, refresh);
    const parentGroups = await connection.groupCache.getParentGroups(groupName);
    return { group, parentGroups };
}

const groupLabels: Record<AttributeGroup, string> = {
    identity: 'Identity',
    access: 'Access & Settings',
    members: 'Members',
    system: 'System Attributes',
    other: 'Other Attributes'
};

const groupOrder: AttributeGroup[] = ['identity', 'access', 'other', 'system'];

function memberTag(kind: 'user' | 'group', name: string): string {
    const action = kind === 'user' ? 'openUser' : 'openGroup';
    return `<span class="member-tag ${kind}" data-action="${action}" data-value="${escapeHtml(name)}">${escapeHtml(name)}</span>`;
}

export function renderGroupDump({ group, parentGroups }: GroupDump): string {
    const groups = groupGroupAttributes(group.attributes);
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
                <button data-action="copyName" data-value="${escapeHtml(group.groupName)}">Copy Group Name</button>
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
                    <span class="toggle">&#9660;</span>
                    Parent Groups (Member Of)
                    <span class="count">${parentGroups.length}</span>
                </div>
                <div class="group-content">
                    <div class="member-tags">
                        ${parentGroups.map(g => memberTag('group', g)).join('')}
                    </div>
                </div>
            </div>
            ` : ''}

            <div class="members-section">
                <div class="group-header" data-action="toggleGroup">
                    <span class="toggle">&#9660;</span>
                    Members
                    <span class="count">${totalMembers}</span>
                </div>
                <div class="group-content">
                    ${totalMembers === 0 ? '<div class="no-members">Group has no members</div>' : ''}
                    ${group.members.length > 0 ? `
                        <div class="subsection-label">Users (${group.members.length})</div>
                        <div class="member-tags">
                            ${group.members.map(u => memberTag('user', u)).join('')}
                        </div>
                    ` : ''}
                    ${group.groupMembers.length > 0 ? `
                        <div class="subsection-label">Groups (${group.groupMembers.length})</div>
                        <div class="member-tags">
                            ${group.groupMembers.map(g => memberTag('group', g)).join('')}
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
        </div>`;
}

function renderAttribute(attr: GroupAttribute): string {
    const { text: valueStr, isEmpty: isNull, isObjectId: isObjectIdField } = describeAttributeValue(attr.value);
    const valueClass = isNull ? ' null' : (isObjectIdField ? ' object-id' : '');
    const valueAction = isObjectIdField ? 'dumpObject' : 'copyValue';

    return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-value="${escapeHtml(valueStr)}">
        <div class="attr-name" title="${escapeHtml(attr.name)}" data-action="copyValue" data-value="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
        <div class="attr-value${valueClass}" data-action="${valueAction}" data-value="${escapeHtml(valueStr)}">${isNull ? '(empty)' : escapeHtml(valueStr)}</div>
    </div>`;
}
