import { ConnectionManager } from './connectionManager';

/**
 * User attribute information
 */
export interface UserAttribute {
    name: string;
    value: unknown;
    dataType: string;
}

/**
 * User information from the repository
 */
export interface UserInfo {
    userName: string;
    userLoginName: string;
    userOsName: string;
    userAddress: string;
    userState: number;
    userSource: string;
    defaultFolder: string;
    defaultGroup: string;
    description: string;
    email: string;
    homeDocbase: string;
    clientCapability: number;
    aliasSetId: string;
    acl: string;
    // Raw attributes for detailed view
    attributes: UserAttribute[];
}

/**
 * Cache for repository user information
 * Fetches from DFC Bridge and caches locally for performance
 */
export class UserCache {
    private connectionManager: ConnectionManager;
    private userMap: Map<string, UserInfo> = new Map();
    private userNames: string[] = [];
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
        return this.userMap.size > 0;
    }

    /**
     * Get all user names
     */
    getUserNames(): string[] {
        return this.userNames;
    }

    /**
     * Get user info by name (case-insensitive)
     */
    getUser(userName: string): UserInfo | undefined {
        return this.userMap.get(userName.toLowerCase());
    }

    /**
     * Search users by name pattern
     */
    searchUsers(pattern: string): string[] {
        const lowerPattern = pattern.toLowerCase();
        return this.userNames
            .filter(name => name.toLowerCase().includes(lowerPattern))
            .sort();
    }

    /**
     * Refresh cache from the bridge.
     * The bridge handles REST vs DQL routing internally.
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
            const bridge = this.connectionManager.getDctmBridge();

            // Clear existing cache
            this.userMap.clear();
            this.userNames = [];

            // Bridge handles REST vs DQL routing internally
            const users = await bridge.getUsers(connection.sessionId);

            for (const user of users) {
                const userName = user.userName;
                const userKey = userName.toLowerCase();

                this.userNames.push(userName);
                this.userMap.set(userKey, {
                    userName: userName,
                    userLoginName: user.userLoginName || '',
                    userOsName: user.userOsName || '',
                    userAddress: user.userAddress || '',
                    userState: parseInt(user.userState, 10) || 0,
                    userSource: user.userSource || '',
                    defaultFolder: user.defaultFolder || '',
                    defaultGroup: user.userGroupName || '',
                    description: user.description || '',
                    email: '',
                    homeDocbase: '',
                    clientCapability: 0,
                    aliasSetId: '',
                    acl: '',
                    attributes: []
                });
            }

            // Sort user names
            this.userNames.sort();

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
     * Fetch detailed user info including all attributes.
     * The bridge handles REST vs DQL routing internally.
     */
    async fetchUserDetails(userName: string): Promise<UserInfo | undefined> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return undefined;
        }

        const userKey = userName.toLowerCase();
        let user = this.userMap.get(userKey);

        // If we already have detailed attributes, return cached
        if (user && user.attributes.length > 0) {
            return user;
        }

        try {
            const bridge = this.connectionManager.getDctmBridge();

            // Bridge handles REST vs DQL routing internally and returns attributes
            const bridgeUser = await bridge.getUser(connection.sessionId, userName);

            // Convert bridge attributes to UserAttribute format
            const attributes: UserAttribute[] = bridgeUser.attributes.map(attr => ({
                name: attr.name,
                value: attr.value,
                dataType: attr.dataType
            }));

            // Create or update user info
            if (!user) {
                user = {
                    userName: bridgeUser.userName,
                    userLoginName: '',
                    userOsName: bridgeUser.userOsName || '',
                    userAddress: bridgeUser.userAddress || '',
                    userState: parseInt(bridgeUser.userState, 10) || 0,
                    userSource: '',
                    defaultFolder: bridgeUser.defaultFolder || '',
                    defaultGroup: bridgeUser.userGroupName || '',
                    description: '',
                    email: '',
                    homeDocbase: '',
                    clientCapability: 0,
                    aliasSetId: '',
                    acl: '',
                    attributes: attributes
                };
                this.userMap.set(userKey, user);
            } else {
                user.attributes = attributes;
            }

            return user;
        } catch {
            // Return basic user without attributes on error
            return user;
        }
    }

    /**
     * Get groups for a user.
     * The bridge handles REST vs DQL routing internally.
     */
    async getUserGroups(userName: string): Promise<string[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return [];
        }

        try {
            const bridge = this.connectionManager.getDctmBridge();
            const groups = await bridge.getGroupsForUser(connection.sessionId, userName);
            return groups.map(g => g.groupName).sort();
        } catch {
            return [];
        }
    }

    /**
     * Clear the cache
     */
    clear(): void {
        this.userMap.clear();
        this.userNames = [];
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
    getStats(): { userCount: number; lastRefresh: Date | null } {
        return {
            userCount: this.userMap.size,
            lastRefresh: this.lastRefresh
        };
    }
}
