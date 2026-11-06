import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { DfcProfile } from './connectionManager';
import { extractBridgeError } from './errorUtils';
import {
    ObjectInfo,
    UserInfo,
    UserDetails,
    GroupInfo,
    GroupDetails,
    TypeSummary,
    TypeInfo
} from './bridgeTypes';
import { DfcBridgeImpl } from './dfcBridgeImpl';
import { RestBridgeImpl } from './restBridgeImpl';
import { ApiOptions, BridgeImplBase, ConnectionType, DmApiResult, DqlResult } from './bridgeImplBase';

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

export interface DqlQueryResult extends DqlResult {
    executionTime: number;
}

interface BridgeClientEntry {
    client: AxiosInstance;
    baseUrl: string;
}

// Re-export types for consumers
export type { ObjectInfo, UserInfo, UserDetails, GroupInfo, GroupDetails, TypeSummary, TypeInfo };

export type BridgeClientFactory = (baseUrl: string) => AxiosInstance;

export function createBridgeClient(baseUrl: string): AxiosInstance {
    const client = axios.create({
        baseURL: baseUrl,
        headers: {
            'Content-Type': 'application/json'
        },
        timeout: 30000 // Default for browser and cache calls; DQL, dmAPI and API method calls set their own
    });

    client.interceptors.response.use(
        (response) => response,
        (error: AxiosError) => {
            throw extractBridgeError(error);
        }
    );

    return client;
}

/**
 * Documentum Bridge client - unified interface to Documentum repositories
 *
 * Abstracts the connection type (DFC or REST) using polymorphism.
 * At connect time, the appropriate implementation is created and stored
 * for the session. Subsequent calls use that implementation directly -
 * no if/else branching on connection type.
 *
 * Architecture:
 * - DfcBridgeImpl: Pure DFC/DQL implementation
 * - RestBridgeImpl: Pure REST implementation
 * - DctmBridge: Factory + routing layer that delegates to implementations
 *
 * This allows:
 * - DFC operations from TypeScript without Java bindings
 * - Multiple DFC profiles (different DFC versions per environment)
 * - REST-only connections without DFC
 * - Process isolation between extension and backend
 * - Adding new connection types by implementing IUnifiedBridge
 */
export class DctmBridge {
    private clients: Map<ConnectionType, BridgeClientEntry> = new Map();

    private sessionImpls: Map<string, BridgeImplBase> = new Map();

    constructor(private createClient: BridgeClientFactory = createBridgeClient) {}

    private getClientForType(connectionType: ConnectionType): AxiosInstance {
        const entry = this.clients.get(connectionType);
        if (!entry) {
            const bridgeName = connectionType === 'rest' ? 'REST Bridge' : 'DFC Bridge';
            throw new Error(`${bridgeName} not initialized. Call ensureRunning() first.`);
        }
        return entry.client;
    }

    private getImplForSession(sessionId: string): BridgeImplBase {
        const impl = this.sessionImpls.get(sessionId);
        if (!impl) {
            throw new Error(`No implementation found for session ${sessionId}. Was connect() called?`);
        }
        return impl;
    }

    private getConfig() {
        const config = vscode.workspace.getConfiguration('documentum');
        return {
            host: config.get<string>('bridge.host', 'localhost'),
            port: config.get<number>('bridge.port', 9876),
            restPort: config.get<number>('bridge.restPort', 9877),
            queryTimeout: config.get<number>('bridge.queryTimeout', 300)
        };
    }

    // Read on each call so a settings change applies without reconnecting. 0 means no timeout in axios too.
    private getQueryTimeoutMs(): number {
        return this.getConfig().queryTimeout * 1000;
    }

    /**
     * Get the base URL for a given connection type.
     * Uses bridge.host for the hostname (default: localhost).
     * DFC connections use bridge.port (9876), REST connections use bridge.restPort (9877).
     */
    private getBaseUrlForType(connectionType: ConnectionType): string {
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
    async ensureRunning(profile?: DfcProfile, connectionType: ConnectionType = 'dfc'): Promise<void> {
        const config = this.getConfig();
        const baseUrl = this.getBaseUrlForType(connectionType);

        const existing = this.clients.get(connectionType);
        if (existing && existing.baseUrl === baseUrl) {
            try {
                const response = await existing.client.get('/health');
                if (response.status === 200) {
                    return;
                }
            } catch {
                // Bridge not running, will try to start or throw error
            }
        }

        const client = this.createClient(baseUrl);
        this.clients.set(connectionType, { client, baseUrl });

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
     * Creates the appropriate polymorphic implementation for the session.
     * Subsequent unified API calls use this implementation directly.
     */
    async connect(params: DfcConnectParams): Promise<string> {
        // Determine connection type based on params
        const connectionType: ConnectionType = params.endpoint ? 'rest' : 'dfc';
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

        const impl = connectionType === 'rest'
            ? new RestBridgeImpl(client)
            : new DfcBridgeImpl(client);
        this.sessionImpls.set(sessionId, impl);

        return sessionId;
    }

    /**
     * Disconnect a session and clean up tracking
     */
    async disconnect(sessionId: string): Promise<void> {
        try {
            await this.sessionImpls.get(sessionId)?.disconnect(sessionId);
        } catch {
            // The session is dropped locally even when the bridge no longer knows it
        } finally {
            this.sessionImpls.delete(sessionId);
        }
    }

    /**
     * Execute a DQL query
     */
    async executeDql(sessionId: string, query: string): Promise<DqlQueryResult> {
        const impl = this.getImplForSession(sessionId);
        const startTime = Date.now();
        const result = await impl.executeDql(sessionId, query, this.getQueryTimeoutMs());
        return { ...result, executionTime: Date.now() - startTime };
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
        options: ApiOptions
    ): Promise<unknown> {
        return this.getImplForSession(sessionId).executeApi(sessionId, typeName, method, options, this.getQueryTimeoutMs());
    }

    /**
     * Execute a dmAPI command via session.apiGet(), apiExec(), or apiSet()
     *
     * These are server-level API calls distinct from DFC object method invocations.
     *
     * @param sessionId Active session ID
     * @param apiType Type of API call: 'get', 'exec', or 'set'
     * @param command The dmAPI command string (e.g., "getservermap,session,MyRepo")
     * @param value The value for a set call, sent unchanged
     * @returns The API response with result and execution time
     */
    async executeDmApi(
        sessionId: string,
        apiType: 'get' | 'exec' | 'set',
        command: string,
        value?: string
    ): Promise<DmApiResult> {
        return this.getImplForSession(sessionId).executeDmApi(sessionId, apiType, command, value, this.getQueryTimeoutMs());
    }

    /**
     * Get list of all types in the repository.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getTypes(sessionId: string): Promise<TypeSummary[]> {
        return this.getImplForSession(sessionId).getTypes(sessionId);
    }

    /**
     * Get detailed type information including attributes.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getTypeDetails(sessionId: string, typeName: string): Promise<TypeInfo> {
        return this.getImplForSession(sessionId).getTypeDetails(sessionId, typeName);
    }

    /**
     * Checkout (lock) an object for editing.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async checkout(sessionId: string, objectId: string): Promise<ObjectInfo> {
        return this.getImplForSession(sessionId).checkout(sessionId, objectId);
    }

    /**
     * Cancel checkout (unlock) an object.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async cancelCheckout(sessionId: string, objectId: string): Promise<void> {
        return this.getImplForSession(sessionId).cancelCheckout(sessionId, objectId);
    }

    /**
     * Checkin an object, creating a new version.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async checkin(sessionId: string, objectId: string, versionLabel: string = 'CURRENT'): Promise<ObjectInfo> {
        return this.getImplForSession(sessionId).checkin(sessionId, objectId, versionLabel);
    }

    /**
     * Get an object by ID.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     *
     * @param sessionId Active session ID
     * @param objectId The r_object_id to fetch
     * @returns Object info with objectId, type, name, and attributes map
     */
    async getObject(sessionId: string, objectId: string): Promise<ObjectInfo> {
        return this.getImplForSession(sessionId).getObject(sessionId, objectId);
    }

    /**
     * Check if a session is using REST connection (vs DFC).
     * Useful for feature detection - some features like dmAPI are DFC-only.
     *
     * @param sessionId The session ID to check
     * @returns true if the session is using REST connection, false for DFC
     */
    isRestSession(sessionId: string): boolean {
        return this.sessionImpls.get(sessionId)?.connectionType === 'rest';
    }

    // ========================================
    // Unified API methods - delegate to polymorphic implementations
    // ========================================

    /**
     * Get cabinets from the repository.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getCabinets(sessionId: string): Promise<ObjectInfo[]> {
        return this.getImplForSession(sessionId).getCabinets(sessionId);
    }

    /**
     * Get folder contents (subfolders and documents).
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     *
     * @param sessionId Active session ID
     * @param folderId The folder object ID
     * @param folderPath The folder path (required for DFC sessions)
     */
    async getFolderContents(sessionId: string, folderId: string, folderPath?: string): Promise<ObjectInfo[]> {
        return this.getImplForSession(sessionId).getFolderContents(sessionId, folderId, folderPath);
    }

    /**
     * Get users from the repository.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getUsers(sessionId: string): Promise<UserInfo[]> {
        return this.getImplForSession(sessionId).getUsers(sessionId);
    }

    /**
     * Get a single user by username.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getUser(sessionId: string, userName: string): Promise<UserDetails> {
        return this.getImplForSession(sessionId).getUser(sessionId, userName);
    }

    /**
     * Get groups from the repository.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getGroups(sessionId: string): Promise<GroupInfo[]> {
        return this.getImplForSession(sessionId).getGroups(sessionId);
    }

    /**
     * Get a single group by name.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getGroup(sessionId: string, groupName: string): Promise<GroupDetails> {
        return this.getImplForSession(sessionId).getGroup(sessionId, groupName);
    }

    /**
     * Get groups that contain a user.
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getGroupsForUser(sessionId: string, userName: string): Promise<GroupInfo[]> {
        return this.getImplForSession(sessionId).getGroupsForUser(sessionId, userName);
    }

    /**
     * Get parent groups (groups that contain this group).
     * Delegates to the appropriate implementation (DFC or REST) for this session.
     */
    async getParentGroups(sessionId: string, groupName: string): Promise<GroupInfo[]> {
        return this.getImplForSession(sessionId).getParentGroups(sessionId, groupName);
    }

    /**
     * Stop the bridges if we started them
     */
    async stop(): Promise<void> {
        this.clients.clear();
        this.sessionImpls.clear();
    }
}
