import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { DfcProfile } from './connectionManager';
import { extractBridgeError } from './errorUtils';

export interface DfcConnectParams {
    // For DFC connections - docbroker and port
    docbroker?: string;
    port?: number;
    // For REST connections - endpoint URL
    endpoint?: string;
    // Common properties
    repository: string;
    username: string;
    password: string;
}

export interface DqlQueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
}

/**
 * Documentum Bridge client - unified interface to Documentum repositories
 *
 * Abstracts the connection type (DFC or REST) and routes requests to the
 * appropriate backend. Callers don't need to know the connection type.
 *
 * For DFC connections, communicates with the Java DFC Bridge microservice.
 * For REST connections, communicates with the REST Bridge service.
 *
 * This allows:
 * - DFC operations from TypeScript without Java bindings
 * - Multiple DFC profiles (different DFC versions per environment)
 * - REST-only connections without DFC
 * - Process isolation between extension and backend
 */
export class DctmBridge {
    private context: vscode.ExtensionContext;
    private dfcClient: AxiosInstance | null = null;
    private restClient: AxiosInstance | null = null;
    private bridgeProcess: unknown = null;

    /**
     * Track which session IDs belong to which connection type.
     * This allows us to route requests to the correct bridge.
     */
    private sessionTypes: Map<string, 'dfc' | 'rest'> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Get the client for a specific connection type.
     * Throws if the client hasn't been initialized via ensureRunning().
     */
    private getClientForType(connectionType: 'dfc' | 'rest'): AxiosInstance {
        const client = connectionType === 'rest' ? this.restClient : this.dfcClient;
        if (!client) {
            const bridgeName = connectionType === 'rest' ? 'REST Bridge' : 'DFC Bridge';
            throw new Error(`${bridgeName} not initialized. Call ensureRunning() first.`);
        }
        return client;
    }

    /**
     * Get the client for a specific session ID.
     * Uses the stored session type to route to the correct bridge.
     */
    private getClientForSession(sessionId: string): AxiosInstance {
        const connectionType = this.sessionTypes.get(sessionId);
        if (!connectionType) {
            // Fall back to DFC client for backwards compatibility
            if (this.dfcClient) {
                return this.dfcClient;
            }
            if (this.restClient) {
                return this.restClient;
            }
            throw new Error('No bridge client initialized. Call ensureRunning() first.');
        }
        return this.getClientForType(connectionType);
    }

    private getConfig() {
        const config = vscode.workspace.getConfiguration('documentum');
        return {
            host: config.get<string>('bridge.host', 'localhost'),
            port: config.get<number>('bridge.port', 9876),
            restPort: config.get<number>('bridge.restPort', 9877)
        };
    }

    /**
     * Get the base URL for a given connection type.
     * Uses bridge.host for the hostname (default: localhost).
     * DFC connections use bridge.port (9876), REST connections use bridge.restPort (9877).
     */
    private getBaseUrlForType(connectionType: 'dfc' | 'rest'): string {
        const config = this.getConfig();
        if (connectionType === 'rest') {
            return `http://${config.host}:${config.restPort}`;
        }
        return `http://${config.host}:${config.port}`;
    }

    /**
     * Ensure the appropriate bridge is running.
     * Routes to the appropriate bridge based on connection type:
     * - DFC connections use bridge.port (default 9876)
     * - REST connections use bridge.restPort (default 9877)
     *
     * Each connection type maintains its own client, so DFC and REST
     * connections can coexist simultaneously.
     *
     * @param profile Optional DFC profile configuration
     * @param connectionType The connection type ('dfc' or 'rest'), defaults to 'dfc'
     */
    async ensureRunning(profile?: DfcProfile, connectionType: 'dfc' | 'rest' = 'dfc'): Promise<void> {
        const config = this.getConfig();
        const baseUrl = this.getBaseUrlForType(connectionType);

        // Check if we already have a client for this connection type
        const existingClient = connectionType === 'rest' ? this.restClient : this.dfcClient;
        if (existingClient) {
            // Client already exists, just verify bridge is running
            try {
                const response = await existingClient.get('/health');
                if (response.status === 200) {
                    return;
                }
            } catch {
                // Bridge not running, will try to start or throw error
            }
        }

        // Create axios client for bridge communication
        const client = axios.create({
            baseURL: baseUrl,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout for DFC operations
        });

        // Add response interceptor to transform errors
        // This extracts meaningful error messages from bridge responses
        client.interceptors.response.use(
            (response) => response,
            (error: AxiosError) => {
                throw extractBridgeError(error);
            }
        );

        // Store client in the appropriate slot
        if (connectionType === 'rest') {
            this.restClient = client;
        } else {
            this.dfcClient = client;
        }

        // Check if bridge is already running
        try {
            const response = await client.get('/health');
            if (response.status === 200) {
                return;
            }
        } catch {
            // Bridge not running, throw error
        }

        const bridgeName = connectionType === 'rest' ? 'REST Bridge' : 'DFC Bridge';
        const port = connectionType === 'rest' ? config.restPort : config.port;
        throw new Error(
            `${bridgeName} not running on port ${port}. ` +
            `Please start the bridge manually.`
        );
    }

    /**
     * Connect to a Documentum repository via the bridge.
     * The bridge routes to DFC or REST based on which fields are present:
     * - endpoint field present -> REST connection
     * - docbroker field present -> DFC connection
     *
     * The session ID is tracked along with its connection type so that
     * subsequent requests are routed to the correct bridge.
     */
    async connect(params: DfcConnectParams): Promise<string> {
        // Determine connection type based on params
        const connectionType: 'dfc' | 'rest' = params.endpoint ? 'rest' : 'dfc';
        const client = this.getClientForType(connectionType);

        // Build request body based on connection type
        // Only include fields relevant to the connection type
        const requestBody: Record<string, unknown> = {
            repository: params.repository,
            username: params.username,
            password: params.password
        };

        if (params.endpoint) {
            // REST connection - only include endpoint
            requestBody.endpoint = params.endpoint;
        } else {
            // DFC connection - include docbroker and port
            requestBody.docbroker = params.docbroker || '';
            requestBody.port = params.port || 1489;
        }

        const response = await client.post('/api/v1/connect', requestBody);
        const sessionId = response.data.sessionId;

        // Track session type for routing future requests
        this.sessionTypes.set(sessionId, connectionType);

        return sessionId;
    }

    /**
     * Disconnect a session and clean up tracking
     */
    async disconnect(sessionId: string): Promise<void> {
        try {
            const client = this.getClientForSession(sessionId);
            await client.post('/api/v1/disconnect', { sessionId });
        } catch {
            // Ignore errors if client not available
        } finally {
            // Always clean up the session tracking
            this.sessionTypes.delete(sessionId);
        }
    }

    /**
     * Execute a DQL query
     */
    async executeDql(sessionId: string, query: string): Promise<DqlQueryResult> {
        const client = this.getClientForSession(sessionId);
        const startTime = Date.now();

        const response = await client.post('/api/v1/dql', { sessionId, query });
        const executionTime = Date.now() - startTime;

        // Bridge returns columns as ColumnInfo objects, extract just the names
        const columns = (response.data.columns || []).map(
            (col: { name: string }) => col.name
        );

        return {
            columns,
            rows: response.data.rows || [],
            rowCount: response.data.rowCount || 0,
            executionTime
        };
    }

    /**
     * Get session information
     */
    async getSessionInfo(sessionId: string): Promise<Record<string, unknown>> {
        const client = this.getClientForSession(sessionId);
        const response = await client.get(`/api/v1/session/${sessionId}`);
        return response.data;
    }

    /**
     * Execute an arbitrary DFC API method on an object or type.
     *
     * @param sessionId Active session ID
     * @param typeName Type name for type-level operations (optional)
     * @param method Method name to invoke
     * @param options Object containing objectId, args, and namedArgs
     */
    async executeApi(
        sessionId: string,
        typeName: string,
        method: string,
        options: {
            objectId?: string;
            args?: unknown[];
            namedArgs?: Record<string, unknown>;
        }
    ): Promise<unknown> {
        const client = this.getClientForSession(sessionId);
        const response = await client.post('/api/v1/api', {
            sessionId,
            objectId: options.objectId,
            typeName: typeName || undefined,
            method,
            args: options.args,
            namedArgs: options.namedArgs
        });

        return response.data;
    }

    /**
     * Execute a dmAPI command via session.apiGet(), apiExec(), or apiSet()
     *
     * These are server-level API calls distinct from DFC object method invocations.
     *
     * @param sessionId Active session ID
     * @param apiType Type of API call: 'get', 'exec', or 'set'
     * @param command The dmAPI command string (e.g., "getservermap,session")
     * @returns The API response with result and execution time
     */
    async executeDmApi(
        sessionId: string,
        apiType: 'get' | 'exec' | 'set',
        command: string
    ): Promise<{
        result: unknown;
        resultType: string;
        executionTimeMs: number;
    }> {
        const client = this.getClientForSession(sessionId);
        const response = await client.post('/api/v1/dmapi', { sessionId, apiType, command });
        return response.data;
    }

    /**
     * Get list of all types in the repository
     */
    async getTypes(sessionId: string): Promise<unknown> {
        const client = this.getClientForSession(sessionId);
        const response = await client.get('/api/v1/types', { params: { sessionId } });
        return response.data;
    }

    /**
     * Get detailed type information including attributes
     */
    async getTypeDetails(sessionId: string, typeName: string): Promise<unknown> {
        const client = this.getClientForSession(sessionId);
        const response = await client.get(`/api/v1/types/${typeName}`, { params: { sessionId } });
        return response.data;
    }

    /**
     * Checkout (lock) an object for editing
     */
    async checkout(sessionId: string, objectId: string): Promise<unknown> {
        const client = this.getClientForSession(sessionId);
        const response = await client.put(`/api/v1/objects/${objectId}/lock`, null, { params: { sessionId } });
        return response.data;
    }

    /**
     * Cancel checkout (unlock) an object
     */
    async cancelCheckout(sessionId: string, objectId: string): Promise<void> {
        const client = this.getClientForSession(sessionId);
        await client.delete(`/api/v1/objects/${objectId}/lock`, { params: { sessionId } });
    }

    /**
     * Checkin an object, creating a new version
     */
    async checkin(sessionId: string, objectId: string, versionLabel: string = 'CURRENT'): Promise<unknown> {
        const client = this.getClientForSession(sessionId);
        const response = await client.post(`/api/v1/objects/${objectId}/versions`, null, { params: { sessionId, versionLabel } });
        return response.data;
    }

    /**
     * Get an object by ID via the REST /objects endpoint.
     * Returns object info with all attributes.
     *
     * @param sessionId Active session ID
     * @param objectId The r_object_id to fetch
     * @returns Object info with objectId, type, name, and attributes map
     */
    async getObject(sessionId: string, objectId: string): Promise<{
        objectId: string;
        type: string;
        name: string;
        attributes: Record<string, unknown>;
    }> {
        const client = this.getClientForSession(sessionId);
        const response = await client.get(`/api/v1/objects/${objectId}`, { params: { sessionId } });
        return response.data;
    }

    /**
     * Check if a session is using REST connection (vs DFC).
     * Useful for feature detection - some features like dmAPI are DFC-only.
     *
     * @param sessionId The session ID to check
     * @returns true if the session is using REST connection, false for DFC
     */
    isRestSession(sessionId: string): boolean {
        return this.sessionTypes.get(sessionId) === 'rest';
    }

    // ========================================
    // Unified API methods
    // These methods route to REST or DQL internally based on session type.
    // Callers don't need to know about the underlying connection type.
    // ========================================

    /**
     * Standard object info returned by unified methods
     */
    // Defined inline in return types for clarity

    /**
     * Get cabinets from the repository.
     * Routes to REST endpoint or DQL internally based on session type.
     */
    async getCabinets(sessionId: string): Promise<Array<{
        objectId: string;
        type: string;
        name: string;
        attributes: Record<string, unknown>;
    }>> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const response = await client.get('/api/v1/cabinets', { params: { sessionId } });
            return response.data;
        } else {
            const query = "SELECT r_object_id, object_name FROM dm_cabinet ORDER BY object_name";
            const result = await this.executeDql(sessionId, query);
            return result.rows.map(row => ({
                objectId: row.r_object_id as string,
                type: 'dm_cabinet',
                name: row.object_name as string,
                attributes: {}
            }));
        }
    }

    /**
     * Get folder contents (subfolders and documents).
     * Routes to REST endpoint or DQL internally based on session type.
     *
     * @param sessionId Active session ID
     * @param folderId The folder object ID
     * @param folderPath The folder path (required for DQL queries)
     */
    async getFolderContents(sessionId: string, folderId: string, folderPath?: string): Promise<Array<{
        objectId: string;
        type: string;
        name: string;
        attributes: Record<string, unknown>;
    }>> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const response = await client.get(`/api/v1/objects/${folderId}/contents`, { params: { sessionId } });
            return response.data;
        } else {
            if (!folderPath) {
                throw new Error('folderPath is required for DFC sessions');
            }

            const items: Array<{
                objectId: string;
                type: string;
                name: string;
                attributes: Record<string, unknown>;
            }> = [];

            // Escape path for DQL
            const escapedPath = folderPath.replace(/'/g, "''");

            // Get subfolders
            const folderQuery = `SELECT r_object_id, object_name FROM dm_folder WHERE folder('${escapedPath}') ORDER BY object_name`;
            const folderResults = await this.executeDql(sessionId, folderQuery);

            for (const row of folderResults.rows) {
                items.push({
                    objectId: row.r_object_id as string,
                    type: 'dm_folder',
                    name: row.object_name as string,
                    attributes: {}
                });
            }

            // Get documents (non-folder sysobjects)
            const docQuery = `SELECT r_object_id, object_name, r_object_type, a_content_type FROM dm_sysobject WHERE folder('${escapedPath}') AND r_object_type != 'dm_folder' ORDER BY object_name`;
            const docResults = await this.executeDql(sessionId, docQuery);

            for (const row of docResults.rows) {
                items.push({
                    objectId: row.r_object_id as string,
                    type: row.r_object_type as string,
                    name: row.object_name as string,
                    attributes: { a_content_type: row.a_content_type }
                });
            }

            return items;
        }
    }

    /**
     * Get users from the repository.
     * Routes to REST endpoint or DQL internally based on session type.
     */
    async getUsers(sessionId: string, _pattern?: string): Promise<Array<{
        objectId: string;
        userName: string;
        userOsName: string;
        userAddress: string;
        userState: string;
        defaultFolder: string;
        userGroupName: string;
        superUser: boolean;
        userLoginName?: string;
        userSource?: string;
        description?: string;
    }>> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const params: Record<string, string> = { sessionId };
            if (_pattern) {
                params.pattern = _pattern;
            }
            const response = await client.get('/api/v1/users', { params });
            return response.data;
        } else {
            // r_is_group = false filters out groups (dm_user table contains both users and groups)
            const query = `SELECT r_object_id, user_name, user_login_name, user_os_name, user_address,
                user_state, user_source, default_folder, user_group_name, description
                FROM dm_user
                WHERE user_state = 0 AND r_is_group = false
                ORDER BY user_name`;

            const result = await this.executeDql(sessionId, query);

            return result.rows.map(row => ({
                objectId: row.r_object_id as string,
                userName: row.user_name as string,
                userOsName: row.user_os_name as string || '',
                userAddress: row.user_address as string || '',
                userState: String(row.user_state || 0),
                defaultFolder: row.default_folder as string || '',
                userGroupName: row.user_group_name as string || '',
                superUser: false,
                userLoginName: row.user_login_name as string || '',
                userSource: row.user_source as string || '',
                description: row.description as string || ''
            }));
        }
    }

    /**
     * Get a single user by username.
     * Routes to REST endpoint or DQL internally based on session type.
     */
    async getUser(sessionId: string, userName: string): Promise<{
        objectId: string;
        userName: string;
        userOsName: string;
        userAddress: string;
        userState: string;
        defaultFolder: string;
        userGroupName: string;
        superUser: boolean;
        attributes: Array<{ name: string; value: unknown; dataType: string }>;
    }> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const response = await client.get(`/api/v1/users/${encodeURIComponent(userName)}`, { params: { sessionId } });
            const restUser = response.data;

            // Build attributes array from REST response
            const attributes = [
                { name: 'user_name', value: restUser.userName, dataType: 'string' },
                { name: 'user_os_name', value: restUser.userOsName, dataType: 'string' },
                { name: 'user_address', value: restUser.userAddress, dataType: 'string' },
                { name: 'user_state', value: restUser.userState, dataType: 'string' },
                { name: 'default_folder', value: restUser.defaultFolder, dataType: 'string' },
                { name: 'user_group_name', value: restUser.userGroupName, dataType: 'string' },
                { name: 'r_is_superuser', value: restUser.superUser, dataType: 'boolean' }
            ].sort((a, b) => a.name.localeCompare(b.name));

            return { ...restUser, attributes };
        } else {
            // Fetch all user attributes
            const query = `SELECT * FROM dm_user WHERE user_name = '${userName.replace(/'/g, "''")}' AND r_is_group = false`;
            const result = await this.executeDql(sessionId, query);

            if (result.rows.length === 0) {
                throw new Error(`User not found: ${userName}`);
            }

            const row = result.rows[0];

            // Build attributes array
            const attributes: Array<{ name: string; value: unknown; dataType: string }> = [];
            for (const [key, value] of Object.entries(row)) {
                attributes.push({ name: key, value, dataType: typeof value });
            }
            attributes.sort((a, b) => a.name.localeCompare(b.name));

            return {
                objectId: row.r_object_id as string,
                userName: row.user_name as string,
                userOsName: row.user_os_name as string || '',
                userAddress: row.user_address as string || '',
                userState: String(row.user_state || 0),
                defaultFolder: row.default_folder as string || '',
                userGroupName: row.user_group_name as string || '',
                superUser: row.r_is_superuser as boolean || false,
                attributes
            };
        }
    }

    /**
     * Get groups from the repository.
     * Routes to REST endpoint or DQL internally based on session type.
     */
    async getGroups(sessionId: string, _pattern?: string): Promise<Array<{
        objectId: string;
        groupName: string;
        description: string;
        groupClass: string;
        groupAdmin: string;
        isPrivate: boolean;
        usersNames: string[];
        groupsNames: string[];
        groupAddress?: string;
        groupSource?: string;
        ownerName?: string;
        isDynamic?: boolean;
    }>> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const params: Record<string, string> = { sessionId };
            if (_pattern) {
                params.pattern = _pattern;
            }
            const response = await client.get('/api/v1/groups', { params });
            return response.data;
        } else {
            const query = `SELECT r_object_id, group_name, group_address, group_source, description,
                group_class, group_admin, owner_name, is_private, is_dynamic
                FROM dm_group
                ORDER BY group_name`;

            const result = await this.executeDql(sessionId, query);

            return result.rows.map(row => ({
                objectId: row.r_object_id as string,
                groupName: row.group_name as string,
                description: row.description as string || '',
                groupClass: row.group_class as string || '',
                groupAdmin: row.group_admin as string || '',
                isPrivate: row.is_private as boolean || false,
                usersNames: [],
                groupsNames: [],
                groupAddress: row.group_address as string || '',
                groupSource: row.group_source as string || '',
                ownerName: row.owner_name as string || '',
                isDynamic: row.is_dynamic as boolean || false
            }));
        }
    }

    /**
     * Get a single group by name.
     * Routes to REST endpoint or DQL internally based on session type.
     */
    async getGroup(sessionId: string, groupName: string): Promise<{
        objectId: string;
        groupName: string;
        description: string;
        groupClass: string;
        groupAdmin: string;
        isPrivate: boolean;
        usersNames: string[];
        groupsNames: string[];
        attributes: Array<{ name: string; value: unknown; dataType: string }>;
    }> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const response = await client.get(`/api/v1/groups/${encodeURIComponent(groupName)}`, { params: { sessionId } });
            const restGroup = response.data;

            // Build attributes array from REST response
            const attributes = [
                { name: 'group_name', value: restGroup.groupName, dataType: 'string' },
                { name: 'description', value: restGroup.description, dataType: 'string' },
                { name: 'group_class', value: restGroup.groupClass, dataType: 'string' },
                { name: 'group_admin', value: restGroup.groupAdmin, dataType: 'string' },
                { name: 'is_private', value: restGroup.isPrivate, dataType: 'boolean' }
            ].sort((a, b) => a.name.localeCompare(b.name));

            return { ...restGroup, attributes };
        } else {
            // Fetch all group attributes
            const query = `SELECT * FROM dm_group WHERE group_name = '${groupName.replace(/'/g, "''")}'`;
            const result = await this.executeDql(sessionId, query);

            if (result.rows.length === 0) {
                throw new Error(`Group not found: ${groupName}`);
            }

            const row = result.rows[0];

            // Build attributes array
            const attributes: Array<{ name: string; value: unknown; dataType: string }> = [];
            for (const [key, value] of Object.entries(row)) {
                if (key !== 'users_names' && key !== 'groups_names') {
                    attributes.push({ name: key, value, dataType: typeof value });
                }
            }
            attributes.sort((a, b) => a.name.localeCompare(b.name));

            // Get members (users_names is repeating)
            let usersNames: string[] = [];
            if (row.users_names) {
                if (Array.isArray(row.users_names)) {
                    usersNames = row.users_names as string[];
                } else if (typeof row.users_names === 'string') {
                    usersNames = [row.users_names];
                }
            }

            // Get group members (groups_names is repeating)
            let groupsNames: string[] = [];
            if (row.groups_names) {
                if (Array.isArray(row.groups_names)) {
                    groupsNames = row.groups_names as string[];
                } else if (typeof row.groups_names === 'string') {
                    groupsNames = [row.groups_names];
                }
            }

            return {
                objectId: row.r_object_id as string,
                groupName: row.group_name as string,
                description: row.description as string || '',
                groupClass: row.group_class as string || '',
                groupAdmin: row.group_admin as string || '',
                isPrivate: row.is_private as boolean || false,
                usersNames: usersNames.sort(),
                groupsNames: groupsNames.sort(),
                attributes
            };
        }
    }

    /**
     * Get groups that contain a user.
     * Routes to REST endpoint or DQL internally based on session type.
     */
    async getGroupsForUser(sessionId: string, userName: string): Promise<Array<{
        objectId: string;
        groupName: string;
        description: string;
        groupClass: string;
        groupAdmin: string;
        isPrivate: boolean;
        usersNames: string[];
        groupsNames: string[];
    }>> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const response = await client.get(`/api/v1/users/${encodeURIComponent(userName)}/groups`, { params: { sessionId } });
            return response.data;
        } else {
            const query = `SELECT r_object_id, group_name FROM dm_group WHERE any users_names = '${userName.replace(/'/g, "''")}'`;
            const result = await this.executeDql(sessionId, query);

            return result.rows.map(row => ({
                objectId: row.r_object_id as string,
                groupName: row.group_name as string,
                description: '',
                groupClass: '',
                groupAdmin: '',
                isPrivate: false,
                usersNames: [],
                groupsNames: []
            }));
        }
    }

    /**
     * Get parent groups that contain a group.
     * Routes to REST endpoint or DQL internally based on session type.
     */
    async getParentGroups(sessionId: string, groupName: string): Promise<Array<{
        objectId: string;
        groupName: string;
        description: string;
        groupClass: string;
        groupAdmin: string;
        isPrivate: boolean;
        usersNames: string[];
        groupsNames: string[];
    }>> {
        const client = this.getClientForSession(sessionId);

        if (this.isRestSession(sessionId)) {
            const response = await client.get(`/api/v1/groups/${encodeURIComponent(groupName)}/parents`, { params: { sessionId } });
            return response.data;
        } else {
            const query = `SELECT r_object_id, group_name FROM dm_group WHERE any groups_names = '${groupName.replace(/'/g, "''")}'`;
            const result = await this.executeDql(sessionId, query);

            return result.rows.map(row => ({
                objectId: row.r_object_id as string,
                groupName: row.group_name as string,
                description: '',
                groupClass: '',
                groupAdmin: '',
                isPrivate: false,
                usersNames: [],
                groupsNames: []
            }));
        }
    }

    /**
     * Stop the bridges if we started them
     */
    async stop(): Promise<void> {
        if (this.bridgeProcess) {
            this.bridgeProcess = null;
        }
        this.dfcClient = null;
        this.restClient = null;
        this.sessionTypes.clear();
    }
}
