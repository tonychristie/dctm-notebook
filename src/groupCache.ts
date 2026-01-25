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
    private refreshPromise: Promise<void> | null = null;

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
     * The bridge handles REST vs DQL routing internally.
     * If a refresh is already in progress, waits for it to complete.
     */
    async refresh(): Promise<void> {
        // If refresh already in progress, wait for it
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            throw new Error('No active connection');
        }

        // Create and store the refresh promise
        this.refreshPromise = this.doRefresh(connection.sessionId);

        try {
            await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    /**
     * Internal refresh implementation.
     */
    private async doRefresh(sessionId: string): Promise<void> {
        const bridge = this.connectionManager.getDctmBridge();

        // Clear existing cache
        this.groupMap.clear();
        this.groupNames = [];

        // Bridge handles REST vs DQL routing internally
        const groups = await bridge.getGroups(sessionId);

        for (const group of groups) {
            const groupName = group.groupName;
            const groupKey = groupName.toLowerCase();

            this.groupNames.push(groupName);
            this.groupMap.set(groupKey, {
                groupName: groupName,
                groupAddress: group.groupAddress || '',
                groupSource: group.groupSource || '',
                description: group.description || '',
                groupClass: group.groupClass || '',
                groupAdmin: group.groupAdmin || '',
                owner: group.ownerName || '',
                isPrivate: group.isPrivate || false,
                isDynamic: group.isDynamic || false,
                aliasSetId: '',
                acl: '',
                members: group.usersNames || [],
                groupMembers: group.groupsNames || [],
                attributes: []
            });
        }

        // Sort group names
        this.groupNames.sort();

        this.lastRefresh = new Date();

        // Notify listeners
        for (const callback of this.onRefreshCallbacks) {
            callback();
        }
    }

    /**
     * Fetch detailed group info including all attributes and members.
     * The bridge handles REST vs DQL routing internally.
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
            const bridge = this.connectionManager.getDctmBridge();

            // Bridge handles REST vs DQL routing internally and returns attributes
            const bridgeGroup = await bridge.getGroup(connection.sessionId, groupName);

            // Convert bridge attributes to GroupAttribute format
            const attributes: GroupAttribute[] = bridgeGroup.attributes.map(attr => ({
                name: attr.name,
                value: attr.value,
                dataType: attr.dataType
            }));

            const members = (bridgeGroup.usersNames || []).sort();
            const groupMembers = (bridgeGroup.groupsNames || []).sort();

            // Create or update group info
            if (!group) {
                group = {
                    groupName: bridgeGroup.groupName,
                    groupAddress: '',
                    groupSource: '',
                    description: bridgeGroup.description || '',
                    groupClass: bridgeGroup.groupClass || '',
                    groupAdmin: bridgeGroup.groupAdmin || '',
                    owner: '',
                    isPrivate: bridgeGroup.isPrivate || false,
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
        } catch {
            // Return basic group without attributes on error
            return group;
        }
    }

    /**
     * Get parent groups (groups that contain this group).
     * The bridge handles REST vs DQL routing internally.
     */
    async getParentGroups(groupName: string): Promise<string[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return [];
        }

        try {
            const bridge = this.connectionManager.getDctmBridge();
            const groups = await bridge.getParentGroups(connection.sessionId, groupName);
            return groups.map(g => g.groupName).sort();
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
