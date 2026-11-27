export function quoteDqlString(value: string): string {
    return `'${value.replace(/'/g, "''")}'`;
}

export function buildUserQuery(userName: string): string {
    return `SELECT user_name, user_login_name, user_os_name, user_address,
    default_folder, user_group_name, description, user_state
FROM dm_user
WHERE user_name = ${quoteDqlString(userName)}`;
}

export function buildGroupQuery(groupName: string): string {
    return `SELECT group_name, group_address, group_class, owner_name,
    description, users_names, groups_names, is_private, is_dynamic
FROM dm_group
WHERE group_name = ${quoteDqlString(groupName)}`;
}

export function buildTypeQuery(type: { name: string; attributes: { name: string; isInherited: boolean }[] }): string {
    const attrs = type.attributes
        .filter(a => !a.isInherited)
        .slice(0, 5)
        .map(a => a.name);

    if (attrs.length === 0) {
        attrs.push('r_object_id', 'object_name');
    }

    return `SELECT ${attrs.join(', ')}\nFROM ${type.name}\nWHERE 1=1`;
}
