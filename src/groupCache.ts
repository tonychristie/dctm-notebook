import { ConnectionManager } from './connectionManager';

/**
 * Group attribute information
 */
export interface GroupAttribute {
    name: string;
    value: unknown;
    dataType: string;
}

/**
 * Group information from the repository
 */
export interface GroupInfo {
    groupName: string;
    groupAddress: string;
    groupSource: string;
    description: string;
    groupClass: string;
    groupAdmin: string;
    owner: string;
    isPrivate: boolean;
    isDynamic: boolean;
    aliasSetId: string;
    acl: string;
    // Members (fetched on demand)
    members: string[];
    groupMembers: string[];
    // Raw attributes for detailed view
    attributes: GroupAttribute[];
}

/**
 * Cache for repository group information
 * Fetches from DFC Bridge and caches locally for performance
 */
export class GroupCache {
    private connectionManager: ConnectionManager;
    private groupMap: Map<string, GroupInfo> = new Map();
    private groupNames: string[] = [];
    private lastRefresh: Date | null = null;
    private refreshing: boolean = false;

    // Event callbacks
    private onRefreshCallbacks: Array<() => void> = [];

    constructor(connectionManager: ConnectionManager) {
        this.connectionManager = connectionManager;
    }

    /**
     * Register callback for when cache is refreshed
     */
    onRefresh(callback: () => void): void {
        this.onRefreshCallbacks.push(callback);
    }

    /**
     * Check if cache has data
     */
    hasData(): boolean {
        return this.groupMap.size > 0;
    }

    /**
     * Get all group names
     */
    getGroupNames(): string[] {
        return this.groupNames;
    }

    /**
     * Get group info by name (case-insensitive)
     */
    getGroup(groupName: string): GroupInfo | undefined {
        return this.groupMap.get(groupName.toLowerCase());
    }

    /**
     * Search groups by name pattern
     */
    searchGroups(pattern: string): string[] {
        const lowerPattern = pattern.toLowerCase();
        return this.groupNames
            .filter(name => name.toLowerCase().includes(lowerPattern))
            .sort();
    }

    /**
     * Refresh cache from the bridge.
     * Uses REST endpoint for REST sessions, DQL for DFC sessions.
     */
    async refresh(): Promise<void> {
        if (this.refreshing) {
            return;
        }

        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            throw new Error('No active connection');
        }

        this.refreshing = true;
        try {
            const bridge = this.connectionManager.getDfcBridge();

            // Clear existing cache
            this.groupMap.clear();
            this.groupNames = [];

            if (bridge.isRestSession(connection.sessionId)) {
                // Use REST endpoint for REST sessions
                const groups = await bridge.getGroups(connection.sessionId);

                for (const group of groups) {
                    const groupName = group.groupName;
                    const groupKey = groupName.toLowerCase();

                    this.groupNames.push(groupName);
                    this.groupMap.set(groupKey, {
                        groupName: groupName,
                        groupAddress: '',
                        groupSource: '',
                        description: group.description || '',
                        groupClass: group.groupClass || '',
                        groupAdmin: group.groupAdmin || '',
                        owner: '',
                        isPrivate: group.isPrivate || false,
                        isDynamic: false,
                        aliasSetId: '',
                        acl: '',
                        members: group.usersNames || [],
                        groupMembers: group.groupsNames || [],
                        attributes: []
                    });
                }
            } else {
                // Use DQL for DFC sessions
                const query = `SELECT group_name, group_address, group_source, description,
                    group_class, group_admin, owner_name, is_private, is_dynamic
                    FROM dm_group
                    ORDER BY group_name`;

                const result = await bridge.executeDql(connection.sessionId, query);

                // Build group map
                for (const row of result.rows) {
                    const groupName = row.group_name as string;
                    const groupKey = groupName.toLowerCase();

                    this.groupNames.push(groupName);
                    this.groupMap.set(groupKey, {
                        groupName: groupName,
                        groupAddress: row.group_address as string || '',
                        groupSource: row.group_source as string || '',
                        description: row.description as string || '',
                        groupClass: row.group_class as string || '',
                        groupAdmin: row.group_admin as string || '',
                        owner: row.owner_name as string || '',
                        isPrivate: row.is_private as boolean || false,
                        isDynamic: row.is_dynamic as boolean || false,
                        aliasSetId: '',
                        acl: '',
                        members: [],
                        groupMembers: [],
                        attributes: []
                    });
                }
            }

            // Sort group names
            this.groupNames.sort();

            this.lastRefresh = new Date();

            // Notify listeners
            for (const callback of this.onRefreshCallbacks) {
                callback();
            }
        } finally {
            this.refreshing = false;
        }
    }

    /**
     * Fetch detailed group info including all attributes and members.
     * Uses REST endpoint for REST sessions, DQL for DFC sessions.
     */
    async fetchGroupDetails(groupName: string): Promise<GroupInfo | undefined> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return undefined;
        }

        const groupKey = groupName.toLowerCase();
        let group = this.groupMap.get(groupKey);

        // If we already have detailed attributes, return cached
        if (group && group.attributes.length > 0) {
            return group;
        }

        try {
            const bridge = this.connectionManager.getDfcBridge();

            if (bridge.isRestSession(connection.sessionId)) {
                // Use REST endpoint for REST sessions
                const restGroup = await bridge.getGroup(connection.sessionId, groupName);

                // Build attributes array from what REST provides
                const attributes: GroupAttribute[] = [
                    { name: 'group_name', value: restGroup.groupName, dataType: 'string' },
                    { name: 'description', value: restGroup.description, dataType: 'string' },
                    { name: 'group_class', value: restGroup.groupClass, dataType: 'string' },
                    { name: 'group_admin', value: restGroup.groupAdmin, dataType: 'string' },
                    { name: 'is_private', value: restGroup.isPrivate, dataType: 'boolean' }
                ];
                attributes.sort((a, b) => a.name.localeCompare(b.name));

                const members = (restGroup.usersNames || []).sort();
                const groupMembers = (restGroup.groupsNames || []).sort();

                // Create or update group info
                if (!group) {
                    group = {
                        groupName: restGroup.groupName,
                        groupAddress: '',
                        groupSource: '',
                        description: restGroup.description || '',
                        groupClass: restGroup.groupClass || '',
                        groupAdmin: restGroup.groupAdmin || '',
                        owner: '',
                        isPrivate: restGroup.isPrivate || false,
                        isDynamic: false,
                        aliasSetId: '',
                        acl: '',
                        members: members,
                        groupMembers: groupMembers,
                        attributes: attributes
                    };
                    this.groupMap.set(groupKey, group);
                } else {
                    group.members = members;
                    group.groupMembers = groupMembers;
                    group.attributes = attributes;
                }

                return group;
            } else {
                // Use DQL for DFC sessions
                // Fetch all group attributes
                const query = `SELECT * FROM dm_group WHERE group_name = '${groupName.replace(/'/g, "''")}'`;
                const result = await bridge.executeDql(connection.sessionId, query);

                if (result.rows.length === 0) {
                    return undefined;
                }

                const row = result.rows[0];

                // Build attributes array
                const attributes: GroupAttribute[] = [];
                for (const [key, value] of Object.entries(row)) {
                    // Skip users_names and groups_names as they're handled separately
                    if (key !== 'users_names' && key !== 'groups_names') {
                        attributes.push({
                            name: key,
                            value: value,
                            dataType: typeof value
                        });
                    }
                }

                // Sort attributes by name
                attributes.sort((a, b) => a.name.localeCompare(b.name));

                // Get members (users_names is repeating)
                let members: string[] = [];
                if (row.users_names) {
                    if (Array.isArray(row.users_names)) {
                        members = row.users_names as string[];
                    } else if (typeof row.users_names === 'string') {
                        members = [row.users_names];
                    }
                }

                // Get group members (groups_names is repeating)
                let groupMembers: string[] = [];
                if (row.groups_names) {
                    if (Array.isArray(row.groups_names)) {
                        groupMembers = row.groups_names as string[];
                    } else if (typeof row.groups_names === 'string') {
                        groupMembers = [row.groups_names];
                    }
                }

                // Create or update group info
                if (!group) {
                    group = {
                        groupName: row.group_name as string,
                        groupAddress: row.group_address as string || '',
                        groupSource: row.group_source as string || '',
                        description: row.description as string || '',
                        groupClass: row.group_class as string || '',
                        groupAdmin: row.group_admin as string || '',
                        owner: row.owner_name as string || '',
                        isPrivate: row.is_private as boolean || false,
                        isDynamic: row.is_dynamic as boolean || false,
                        aliasSetId: row.alias_set_id as string || '',
                        acl: row.acl_name as string || '',
                        members: members.sort(),
                        groupMembers: groupMembers.sort(),
                        attributes: attributes
                    };
                    this.groupMap.set(groupKey, group);
                } else {
                    // Update existing group with detailed attributes
                    group.aliasSetId = row.alias_set_id as string || '';
                    group.acl = row.acl_name as string || '';
                    group.members = members.sort();
                    group.groupMembers = groupMembers.sort();
                    group.attributes = attributes;
                }

                return group;
            }
        } catch {
            // Return basic group without attributes on error
            return group;
        }
    }

    /**
     * Get parent groups (groups that contain this group).
     * Uses REST endpoint for REST sessions, DQL for DFC sessions.
     */
    async getParentGroups(groupName: string): Promise<string[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return [];
        }

        try {
            const bridge = this.connectionManager.getDfcBridge();

            if (bridge.isRestSession(connection.sessionId)) {
                // Use REST endpoint for REST sessions
                const groups = await bridge.getParentGroups(connection.sessionId, groupName);
                return groups.map(g => g.groupName).sort();
            } else {
                // Use DQL for DFC sessions
                const query = `SELECT group_name FROM dm_group WHERE any groups_names = '${groupName.replace(/'/g, "''")}'`;
                const result = await bridge.executeDql(connection.sessionId, query);
                return result.rows.map(row => row.group_name as string).sort();
            }
        } catch {
            return [];
        }
    }

    /**
     * Clear the cache
     */
    clear(): void {
        this.groupMap.clear();
        this.groupNames = [];
        this.lastRefresh = null;
    }

    /**
     * Get last refresh time
     */
    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    /**
     * Get cache statistics
     */
    getStats(): { groupCount: number; lastRefresh: Date | null } {
        return {
            groupCount: this.groupMap.size,
            lastRefresh: this.lastRefresh
        };
    }
}
