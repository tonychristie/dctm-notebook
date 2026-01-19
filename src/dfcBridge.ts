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
 * DFC Bridge client - communicates with the Java DFC Bridge microservice
 *
 * The DFC Bridge is a separate Java/Spring Boot application that wraps DFC
 * and exposes a REST API for the VS Code extension to call.
 *
 * This allows:
 * - DFC operations from TypeScript without Java bindings
 * - Multiple DFC profiles (different DFC versions per environment)
 * - Process isolation between extension and DFC
 */
export class DfcBridge {
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
            port: config.get<number>('bridge.port', 9876),
            restPort: config.get<number>('bridge.restPort', 9877)
        };
    }

    /**
     * Get the base URL for a given connection type.
     * DFC connections use bridge.port (9876), REST connections use bridge.restPort (9877).
     */
    private getBaseUrlForType(connectionType: 'dfc' | 'rest'): string {
        const config = this.getConfig();
        if (connectionType === 'rest') {
            return `http://localhost:${config.restPort}`;
        }
        return `http://localhost:${config.port}`;
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
