import { BridgeAttributeValue } from './bridgeTypes';
import { isObjectId } from './htmlUtils';

export type TypeAttributeGroup = 'custom' | 'standard' | 'system' | 'application' | 'internal';
export type ObjectAttributeGroup = TypeAttributeGroup;
export type UserAttributeGroup = 'identity' | 'access' | 'preferences' | 'system' | 'other';
export type GroupAttributeGroup = 'identity' | 'access' | 'members' | 'system' | 'other';

interface NamedAttribute {
    name: string;
}

const USER_IDENTITY = ['user_name', 'user_login_name', 'user_os_name', 'user_address', 'user_db_name',
    'user_source', 'user_ldap_dn', 'user_global_unique_id'];
const USER_ACCESS = ['acl_domain', 'acl_name', 'owner_name', 'owner_permit', 'user_privileges',
    'user_xprivileges', 'client_capability', 'alias_set_id'];
const USER_PREFERENCES = ['default_folder', 'default_group', 'home_docbase', 'user_web_page',
    'user_delegation', 'user_email'];

const GROUP_IDENTITY = ['group_name', 'group_address', 'group_source', 'description',
    'group_class', 'group_admin', 'owner_name', 'group_global_unique_id'];
const GROUP_ACCESS = ['acl_domain', 'acl_name', 'alias_set_id', 'is_private',
    'is_protected', 'is_dynamic', 'globally_managed'];
const GROUP_MEMBERS = ['users_names', 'groups_names'];

function groupAttributes<G extends string, T extends NamedAttribute>(
    attributes: T[],
    groupNames: readonly G[],
    categorize: (attr: T) => G | null
): Record<G, T[]> {
    const groups = {} as Record<G, T[]>;
    for (const name of groupNames) {
        groups[name] = [];
    }
    for (const attr of attributes) {
        const group = categorize(attr);
        if (group !== null) {
            groups[group].push(attr);
        }
    }
    for (const name of groupNames) {
        groups[name].sort((a, b) => a.name.localeCompare(b.name));
    }
    return groups;
}

export function categorizeObjectAttribute(name: string): ObjectAttributeGroup {
    if (name.startsWith('r_')) {
        return 'system';
    }
    if (name.startsWith('i_')) {
        return 'internal';
    }
    if (name.startsWith('a_')) {
        return 'application';
    }
    return 'standard';
}

export function groupObjectAttributes<T extends NamedAttribute>(
    attributes: T[],
    standardAttributeNames: ReadonlySet<string> | undefined
): Record<ObjectAttributeGroup, T[]> {
    return groupAttributes(
        attributes,
        ['custom', 'standard', 'system', 'application', 'internal'],
        attr => {
            const group = categorizeObjectAttribute(attr.name);
            return group === 'standard' && standardAttributeNames && !standardAttributeNames.has(attr.name)
                ? 'custom'
                : group;
        }
    );
}

export function categorizeTypeAttribute(attr: { name: string; isInherited: boolean }): TypeAttributeGroup {
    return attr.isInherited ? categorizeObjectAttribute(attr.name) : 'custom';
}

export function groupTypeAttributes<T extends { name: string; isInherited: boolean }>(
    attributes: T[]
): Record<TypeAttributeGroup, T[]> {
    return groupAttributes(
        attributes,
        ['custom', 'standard', 'system', 'application', 'internal'],
        categorizeTypeAttribute
    );
}

export function categorizeUserAttribute(name: string): UserAttributeGroup {
    if (USER_IDENTITY.includes(name)) {
        return 'identity';
    }
    if (USER_ACCESS.includes(name)) {
        return 'access';
    }
    if (USER_PREFERENCES.includes(name)) {
        return 'preferences';
    }
    if (name.startsWith('r_') || name.startsWith('i_')) {
        return 'system';
    }
    return 'other';
}

export function groupUserAttributes<T extends NamedAttribute>(attributes: T[]): Record<UserAttributeGroup, T[]> {
    return groupAttributes(
        attributes,
        ['identity', 'access', 'preferences', 'system', 'other'],
        attr => categorizeUserAttribute(attr.name)
    );
}

export function categorizeGroupAttribute(name: string): GroupAttributeGroup {
    if (GROUP_IDENTITY.includes(name)) {
        return 'identity';
    }
    if (GROUP_ACCESS.includes(name)) {
        return 'access';
    }
    if (GROUP_MEMBERS.includes(name)) {
        return 'members';
    }
    if (name.startsWith('r_') || name.startsWith('i_')) {
        return 'system';
    }
    return 'other';
}

// Members are shown in their own section, so the members group is always empty.
export function groupGroupAttributes<T extends NamedAttribute>(attributes: T[]): Record<GroupAttributeGroup, T[]> {
    return groupAttributes(
        attributes,
        ['identity', 'access', 'members', 'system', 'other'],
        attr => {
            const group = categorizeGroupAttribute(attr.name);
            return group === 'members' ? null : group;
        }
    );
}

export interface ObjectAttributeEntry {
    name: string;
    type: string;
    value: unknown;
    isRepeating: boolean;
}

function isTypedEntry(entry: unknown): entry is BridgeAttributeValue {
    return typeof entry === 'object' && entry !== null && !Array.isArray(entry)
        && typeof (entry as { type?: unknown }).type === 'string';
}

export function toObjectAttributeEntry(name: string, entry: unknown): ObjectAttributeEntry {
    if (isTypedEntry(entry)) {
        return { name, type: entry.type, value: entry.value, isRepeating: entry.repeating };
    }
    return { name, type: '', value: entry, isRepeating: Array.isArray(entry) };
}

export function formatAttributeValue(value: unknown, isRepeating: boolean): string {
    if (value === null || value === undefined) {
        return 'NULL';
    }
    if (isRepeating && Array.isArray(value)) {
        return value.map(v => v === null ? 'NULL' : String(v)).join(', ');
    }
    return String(value);
}

export interface AttributeValueDisplay {
    text: string;
    isEmpty: boolean;
    isObjectId: boolean;
}

export function describeAttributeValue(value: unknown): AttributeValueDisplay {
    const text = value === null || value === undefined ? 'null' : String(value);
    const isEmpty = value === null || value === undefined || text === '';
    return { text, isEmpty, isObjectId: !isEmpty && isObjectId(text) };
}

export function formatTypeDisplay(attr: { dataType: string; length: number }): string {
    return attr.length > 0 ? `${attr.dataType}(${attr.length})` : attr.dataType;
}
