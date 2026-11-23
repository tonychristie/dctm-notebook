import { UserAttributeGroup as AttributeGroup, describeAttributeValue, groupUserAttributes } from '../attributeGroups';
import { escapeHtml } from '../htmlUtils';
import { RepositoryConnection } from '../repositoryConnection';
import { UserAttribute, UserInfo } from '../userCache';

export interface UserDump {
    user: UserInfo;
    groups: string[];
}

export async function fetchUserDump(connection: RepositoryConnection, userName: string, refresh: boolean): Promise<UserDump> {
    const user = await connection.userCache.fetchUserDetails(userName, refresh);
    const groups = await connection.userCache.getUserGroups(userName);
    return { user, groups };
}

const groupLabels: Record<AttributeGroup, string> = {
    identity: 'Identity',
    access: 'Access & Permissions',
    preferences: 'Preferences',
    system: 'System Attributes',
    other: 'Other Attributes'
};

const groupOrder: AttributeGroup[] = ['identity', 'access', 'preferences', 'other', 'system'];

export function renderUserDump({ user, groups: userGroups }: UserDump): string {
    const groups = groupUserAttributes(user.attributes);

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
                <button data-action="copyName" data-value="${escapeHtml(user.userName)}">Copy User Name</button>
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
                    <span class="toggle">&#9660;</span>
                    Group Membership
                    <span class="count">${userGroups.length}</span>
                </div>
                <div class="group-content">
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

function renderAttribute(attr: UserAttribute): string {
    const { text: valueStr, isEmpty: isNull, isObjectId: isObjectIdField } = describeAttributeValue(attr.value);
    const valueClass = isNull ? ' null' : (isObjectIdField ? ' object-id' : '');
    const valueAction = isObjectIdField ? 'dumpObject' : 'copyValue';

    return `<div class="attribute" data-name="${escapeHtml(attr.name)}" data-value="${escapeHtml(valueStr)}">
        <div class="attr-name" title="${escapeHtml(attr.name)}" data-action="copyValue" data-value="${escapeHtml(attr.name)}">${escapeHtml(attr.name)}</div>
        <div class="attr-value${valueClass}" data-action="${valueAction}" data-value="${escapeHtml(valueStr)}">${isNull ? '(empty)' : escapeHtml(valueStr)}</div>
    </div>`;
}
