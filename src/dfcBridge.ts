import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import { DfcProfile } from './connectionManager';

export interface DfcConnectParams {
    docbroker: string;
    port: number;
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
    private client: AxiosInstance | null = null;
    private bridgeProcess: unknown = null; // TODO: ChildProcess when auto-start implemented
    private baseUrl: string = '';

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private getConfig() {
        const config = vscode.workspace.getConfiguration('documentum');
        return {
            port: config.get<number>('bridge.port', 9876),
            autoStart: config.get<boolean>('bridge.autoStart', true)
        };
    }

    /**
     * Ensure the DFC Bridge is running
     */
    async ensureRunning(profile?: DfcProfile): Promise<void> {
        const config = this.getConfig();
        this.baseUrl = `http://localhost:${config.port}`;

        // Create axios client for bridge communication
        this.client = axios.create({
            baseURL: this.baseUrl,
            headers: {
                'Content-Type': 'application/json'
            },
            timeout: 30000 // 30 second timeout for DFC operations
        });

        // Check if bridge is already running
        try {
            const response = await this.client.get('/health');
            if (response.status === 200) {
                console.log('DFC Bridge already running');
                return;
            }
        } catch {
            // Bridge not running
        }

        // Auto-start bridge if configured
        if (config.autoStart) {
            await this.startBridge(profile);
        } else {
            throw new Error(
                `DFC Bridge not running on port ${config.port}. ` +
                `Start it manually or enable documentum.bridge.autoStart`
            );
        }
    }

    /**
     * Start the DFC Bridge process
     * TODO: Implement auto-start of Java process
     */
    private async startBridge(profile?: DfcProfile): Promise<void> {
        // For now, require manual start
        // In future: spawn Java process with profile's DFC JARs on classpath
        throw new Error(
            'DFC Bridge auto-start not yet implemented. ' +
            'Please start the DFC Bridge manually: ' +
            'java -jar dfc-bridge.jar --server.port=' + this.getConfig().port
        );
    }

    /**
     * Connect to a Documentum repository via DFC
     */
    async connect(params: DfcConnectParams): Promise<string> {
        if (!this.client) {
            throw new Error('DFC Bridge not initialized. Call ensureRunning() first.');
        }

        const response = await this.client.post('/connect', {
            docbroker: params.docbroker,
            port: params.port,
            repository: params.repository,
            username: params.username,
            password: params.password
        });

        if (response.status !== 200) {
            throw new Error(response.data?.message || 'Connection failed');
        }

        return response.data.sessionId;
    }

    /**
     * Disconnect a DFC session
     */
    async disconnect(sessionId: string): Promise<void> {
        if (!this.client) {
            return;
        }

        await this.client.post('/disconnect', { sessionId });
    }

    /**
     * Execute a DQL query
     */
    async executeDql(sessionId: string, query: string): Promise<DqlQueryResult> {
        if (!this.client) {
            throw new Error('DFC Bridge not initialized');
        }

        const startTime = Date.now();

        const response = await this.client.post('/dql', {
            sessionId,
            query
        });

        const executionTime = Date.now() - startTime;

        if (response.status !== 200) {
            throw new Error(response.data?.message || 'DQL execution failed');
        }

        return {
            columns: response.data.columns || [],
            rows: response.data.rows || [],
            rowCount: response.data.rowCount || 0,
            executionTime
        };
    }

    /**
     * Get session information
     */
    async getSessionInfo(sessionId: string): Promise<Record<string, unknown>> {
        if (!this.client) {
            throw new Error('DFC Bridge not initialized');
        }

        const response = await this.client.get(`/session/${sessionId}`);
        return response.data;
    }

    /**
     * Execute an arbitrary DFC API method
     * TODO: Define proper interface for API calls
     */
    async executeApi(
        sessionId: string,
        objectType: string,
        method: string,
        params: Record<string, unknown>
    ): Promise<unknown> {
        if (!this.client) {
            throw new Error('DFC Bridge not initialized');
        }

        const response = await this.client.post('/api', {
            sessionId,
            objectType,
            method,
            params
        });

        return response.data;
    }

    /**
     * Stop the DFC Bridge if we started it
     */
    async stop(): Promise<void> {
        if (this.bridgeProcess) {
            // TODO: Kill the process
            this.bridgeProcess = null;
        }
        this.client = null;
    }
}
