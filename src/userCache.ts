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
            this.userMap.clear();
            this.userNames = [];

            if (bridge.isRestSession(connection.sessionId)) {
                // Use REST endpoint for REST sessions
                const users = await bridge.getUsers(connection.sessionId);

                for (const user of users) {
                    const userName = user.userName;
                    const userKey = userName.toLowerCase();

                    this.userNames.push(userName);
                    this.userMap.set(userKey, {
                        userName: userName,
                        userLoginName: '',
                        userOsName: user.userOsName || '',
                        userAddress: user.userAddress || '',
                        userState: parseInt(user.userState, 10) || 0,
                        userSource: '',
                        defaultFolder: user.defaultFolder || '',
                        defaultGroup: user.userGroupName || '',
                        description: '',
                        email: '',
                        homeDocbase: '',
                        clientCapability: 0,
                        aliasSetId: '',
                        acl: '',
                        attributes: []
                    });
                }
            } else {
                // Use DQL for DFC sessions
                // r_is_group = false filters out groups (dm_user table contains both users and groups)
                const query = `SELECT user_name, user_login_name, user_os_name, user_address,
                    user_state, user_source, default_folder, user_group_name, description
                    FROM dm_user
                    WHERE user_state = 0 AND r_is_group = false
                    ORDER BY user_name`;

                const result = await bridge.executeDql(connection.sessionId, query);

                // Build user map
                for (const row of result.rows) {
                    const userName = row.user_name as string;
                    const userKey = userName.toLowerCase();

                    this.userNames.push(userName);
                    this.userMap.set(userKey, {
                        userName: userName,
                        userLoginName: row.user_login_name as string || '',
                        userOsName: row.user_os_name as string || '',
                        userAddress: row.user_address as string || '',
                        userState: row.user_state as number || 0,
                        userSource: row.user_source as string || '',
                        defaultFolder: row.default_folder as string || '',
                        defaultGroup: row.user_group_name as string || '',
                        description: row.description as string || '',
                        email: '',
                        homeDocbase: '',
                        clientCapability: 0,
                        aliasSetId: '',
                        acl: '',
                        attributes: []
                    });
                }
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
     * Uses REST endpoint for REST sessions, DQL for DFC sessions.
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
            const bridge = this.connectionManager.getDfcBridge();

            if (bridge.isRestSession(connection.sessionId)) {
                // Use REST endpoint for REST sessions
                const restUser = await bridge.getUser(connection.sessionId, userName);

                // Build attributes array from what REST provides
                const attributes: UserAttribute[] = [
                    { name: 'user_name', value: restUser.userName, dataType: 'string' },
                    { name: 'user_os_name', value: restUser.userOsName, dataType: 'string' },
                    { name: 'user_address', value: restUser.userAddress, dataType: 'string' },
                    { name: 'user_state', value: restUser.userState, dataType: 'string' },
                    { name: 'default_folder', value: restUser.defaultFolder, dataType: 'string' },
                    { name: 'user_group_name', value: restUser.userGroupName, dataType: 'string' },
                    { name: 'r_is_superuser', value: restUser.superUser, dataType: 'boolean' }
                ];
                attributes.sort((a, b) => a.name.localeCompare(b.name));

                // Create or update user info
                if (!user) {
                    user = {
                        userName: restUser.userName,
                        userLoginName: '',
                        userOsName: restUser.userOsName || '',
                        userAddress: restUser.userAddress || '',
                        userState: parseInt(restUser.userState, 10) || 0,
                        userSource: '',
                        defaultFolder: restUser.defaultFolder || '',
                        defaultGroup: restUser.userGroupName || '',
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
            } else {
                // Use DQL for DFC sessions
                // Fetch all user attributes (r_is_group = false ensures we only get users, not groups)
                const query = `SELECT * FROM dm_user WHERE user_name = '${userName.replace(/'/g, "''")}' AND r_is_group = false`;
                const result = await bridge.executeDql(connection.sessionId, query);

                if (result.rows.length === 0) {
                    return undefined;
                }

                const row = result.rows[0];

                // Build attributes array
                const attributes: UserAttribute[] = [];
                for (const [key, value] of Object.entries(row)) {
                    attributes.push({
                        name: key,
                        value: value,
                        dataType: typeof value
                    });
                }

                // Sort attributes by name
                attributes.sort((a, b) => a.name.localeCompare(b.name));

                // Create or update user info
                if (!user) {
                    user = {
                        userName: row.user_name as string,
                        userLoginName: row.user_login_name as string || '',
                        userOsName: row.user_os_name as string || '',
                        userAddress: row.user_address as string || '',
                        userState: row.user_state as number || 0,
                        userSource: row.user_source as string || '',
                        defaultFolder: row.default_folder as string || '',
                        defaultGroup: row.user_group_name as string || '',
                        description: row.description as string || '',
                        email: row.user_email as string || '',
                        homeDocbase: row.home_docbase as string || '',
                        clientCapability: row.client_capability as number || 0,
                        aliasSetId: row.alias_set_id as string || '',
                        acl: row.acl_name as string || '',
                        attributes: attributes
                    };
                    this.userMap.set(userKey, user);
                } else {
                    // Update existing user with detailed attributes
                    user.email = row.user_email as string || '';
                    user.homeDocbase = row.home_docbase as string || '';
                    user.clientCapability = row.client_capability as number || 0;
                    user.aliasSetId = row.alias_set_id as string || '';
                    user.acl = row.acl_name as string || '';
                    user.attributes = attributes;
                }

                return user;
            }
        } catch {
            // Return basic user without attributes on error
            return user;
        }
    }

    /**
     * Get groups for a user.
     * Uses REST endpoint for REST sessions, DQL for DFC sessions.
     */
    async getUserGroups(userName: string): Promise<string[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return [];
        }

        try {
            const bridge = this.connectionManager.getDfcBridge();

            if (bridge.isRestSession(connection.sessionId)) {
                // Use REST endpoint for REST sessions
                const groups = await bridge.getGroupsForUser(connection.sessionId, userName);
                return groups.map(g => g.groupName).sort();
            } else {
                // Use DQL for DFC sessions
                const query = `SELECT group_name FROM dm_group WHERE any users_names = '${userName.replace(/'/g, "''")}'`;
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
