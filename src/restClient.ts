import * as vscode from 'vscode';
import axios, { AxiosInstance, AxiosError } from 'axios';
import { DqlQueryResult } from './dfcBridge';

export interface RestConnectParams {
    endpoint: string;
    repository: string;
    username: string;
    password: string;
}

export interface RestRepositoryInfo {
    id: number;
    name: string;
    description: string;
    servers: Array<{
        name: string;
        host: string;
        version: string;
        docbroker: string;
    }>;
}

/**
 * REST API client for Documentum REST Services
 *
 * Provides the same interface as DfcBridge but communicates directly
 * with Documentum REST Services instead of going through the DFC Bridge.
 *
 * Key differences from DFC:
 * - Uses Basic Auth (credentials sent with each request)
 * - No session ID concept - stateless HTTP requests
 * - Some features not available (dmAPI commands)
 */
export class RestClient {
    private context: vscode.ExtensionContext;
    private client: AxiosInstance | null = null;
    private endpoint: string = '';
    private repository: string = '';
    private repositoryInfo: RestRepositoryInfo | null = null;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * Connect to a Documentum repository via REST
     *
     * Unlike DFC which returns a session ID, REST uses stateless Basic Auth.
     * We validate credentials by fetching repository info.
     *
     * @returns A pseudo "session ID" for interface compatibility (actually connection identifier)
     */
    async connect(params: RestConnectParams): Promise<string> {
        this.endpoint = params.endpoint.replace(/\/$/, ''); // Remove trailing slash
        this.repository = params.repository;

        // Create axios client with Basic Auth
        this.client = axios.create({
            baseURL: this.endpoint,
            auth: {
                username: params.username,
                password: params.password
            },
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            },
            timeout: 30000
        });

        // Validate connection by fetching repository info
        try {
            const response = await this.client.get(`/repositories/${this.repository}`);
            this.repositoryInfo = response.data;

            // Return a pseudo session ID for interface compatibility
            // Format: rest:<repository>:<timestamp>
            return `rest:${this.repository}:${Date.now()}`;
        } catch (error) {
            this.client = null;
            this.repositoryInfo = null;

            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                if (axiosError.response?.status === 401) {
                    throw new Error('Authentication failed. Check your credentials.');
                } else if (axiosError.response?.status === 404) {
                    throw new Error(`Repository "${this.repository}" not found.`);
                } else if (axiosError.code === 'ECONNREFUSED') {
                    throw new Error(`Cannot connect to REST endpoint: ${this.endpoint}`);
                }
                throw new Error(`REST connection failed: ${axiosError.message}`);
            }
            throw error;
        }
    }

    /**
     * Disconnect from the repository
     *
     * For REST, this just clears the client - there's no server-side session to close.
     */
    async disconnect(_sessionId: string): Promise<void> {
        this.client = null;
        this.repositoryInfo = null;
        this.endpoint = '';
        this.repository = '';
    }

    /**
     * Check if client is connected
     */
    isConnected(): boolean {
        return this.client !== null && this.repositoryInfo !== null;
    }

    /**
     * Get the axios client for making REST calls
     * Used by ConnectionManager to expose client for direct REST operations
     */
    getClient(): AxiosInstance | null {
        return this.client;
    }

    /**
     * Get repository information
     */
    getRepositoryInfo(): RestRepositoryInfo | null {
        return this.repositoryInfo;
    }

    /**
     * Get the repository name
     */
    getRepository(): string {
        return this.repository;
    }

    /**
     * Execute a DQL query via REST
     *
     * REST endpoint: GET /repositories/{repo}?dql={query}
     *
     * Note: This is a stub - full implementation in #21
     */
    async executeDql(_sessionId: string, query: string): Promise<DqlQueryResult> {
        if (!this.client) {
            throw new Error('REST client not connected');
        }

        const startTime = Date.now();

        try {
            const response = await this.client.get(`/repositories/${this.repository}`, {
                params: { dql: query }
            });

            const executionTime = Date.now() - startTime;

            // Transform REST response to match DfcBridge format
            // Full implementation in #21
            const entries = response.data.entries || [];
            const columns: string[] = [];
            const rows: Record<string, unknown>[] = [];

            if (entries.length > 0) {
                // Extract columns from first entry's properties
                const firstEntry = entries[0];
                if (firstEntry.content?.properties) {
                    Object.keys(firstEntry.content.properties).forEach(key => {
                        columns.push(key);
                    });
                }

                // Transform entries to rows
                entries.forEach((entry: { content?: { properties?: Record<string, unknown> } }) => {
                    if (entry.content?.properties) {
                        rows.push(entry.content.properties);
                    }
                });
            }

            return {
                columns,
                rows,
                rowCount: rows.length,
                executionTime
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError<{ message?: string }>;
                throw new Error(
                    axiosError.response?.data?.message ||
                    `DQL execution failed: ${axiosError.message}`
                );
            }
            throw error;
        }
    }

    /**
     * Get list of all types in the repository
     *
     * REST endpoint: GET /repositories/{repo}/types
     *
     * Note: This is a stub - full implementation in #23
     */
    async getTypes(_sessionId: string): Promise<unknown> {
        if (!this.client) {
            throw new Error('REST client not connected');
        }

        const response = await this.client.get(`/repositories/${this.repository}/types`);
        return response.data;
    }

    /**
     * Get detailed type information including attributes
     *
     * REST endpoint: GET /repositories/{repo}/types/{typeName}
     *
     * Note: This is a stub - full implementation in #23
     */
    async getTypeDetails(_sessionId: string, typeName: string): Promise<unknown> {
        if (!this.client) {
            throw new Error('REST client not connected');
        }

        const response = await this.client.get(
            `/repositories/${this.repository}/types/${typeName}`
        );
        return response.data;
    }

    /**
     * Execute dmAPI command - NOT SUPPORTED via REST
     *
     * dmAPI commands (apiGet, apiExec, apiSet) require DFC and have no REST equivalent.
     * This method always throws an error with a helpful message.
     */
    async executeDmApi(
        _sessionId: string,
        _apiType: 'get' | 'exec' | 'set',
        _command: string
    ): Promise<never> {
        throw new Error(
            'dmAPI commands require a DFC connection. ' +
            'Switch to a DFC connection or use DQL instead.'
        );
    }

    /**
     * Execute an arbitrary API method - NOT SUPPORTED via REST
     *
     * This is the DFC-specific method invocation which has no REST equivalent.
     */
    async executeApi(
        _sessionId: string,
        _objectType: string,
        _method: string,
        _params: Record<string, unknown>
    ): Promise<never> {
        throw new Error(
            'Direct API method execution requires a DFC connection. ' +
            'Use REST-specific endpoints or switch to a DFC connection.'
        );
    }

    /**
     * Get session information
     *
     * For REST, returns current user info instead of session info
     */
    async getSessionInfo(_sessionId: string): Promise<Record<string, unknown>> {
        if (!this.client) {
            throw new Error('REST client not connected');
        }

        const response = await this.client.get(
            `/repositories/${this.repository}/currentuser`
        );
        return response.data;
    }
}
