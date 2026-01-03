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
     * Refresh cache from the bridge
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

            // Fetch user list with basic info
            const query = `SELECT user_name, user_login_name, user_os_name, user_address,
                user_state, user_source, default_folder, default_group, description
                FROM dm_user
                WHERE user_state = 0
                ORDER BY user_name`;

            const result = await bridge.executeDql(connection.sessionId, query);

            // Clear existing cache
            this.userMap.clear();
            this.userNames = [];

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
                    defaultGroup: row.default_group as string || '',
                    description: row.description as string || '',
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
     * Fetch detailed user info including all attributes
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

            // Fetch all user attributes
            const query = `SELECT * FROM dm_user WHERE user_name = '${userName.replace(/'/g, "''")}'`;
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
                    defaultGroup: row.default_group as string || '',
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
        } catch {
            // Return basic user without attributes on error
            return user;
        }
    }

    /**
     * Get groups for a user
     */
    async getUserGroups(userName: string): Promise<string[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return [];
        }

        try {
            const bridge = this.connectionManager.getDfcBridge();
            const query = `SELECT group_name FROM dm_group WHERE any users_names = '${userName.replace(/'/g, "''")}'`;
            const result = await bridge.executeDql(connection.sessionId, query);

            return result.rows.map(row => row.group_name as string).sort();
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
