import { ConnectionManager } from './connectionManager';

export interface DqlResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
    query: string;
}

/**
 * Executes DQL queries via the DFC Bridge.
 * The bridge handles backend type (DFC or REST) internally.
 */
export class DqlExecutor {
    private connectionManager: ConnectionManager;

    constructor(connectionManager: ConnectionManager) {
        this.connectionManager = connectionManager;
    }

    /**
     * Execute a DQL query using the global active connection.
     */
    async execute(query: string): Promise<DqlResult> {
        const connection = this.connectionManager.getActiveConnection();

        if (!connection) {
            throw new Error('Not connected to Documentum. Use "Documentum: Connect" first.');
        }

        return this.executeWithSession(query, connection.sessionId);
    }

    /**
     * Execute a DQL query using a specific session ID.
     * Used for notebook-bound connections where each notebook has its own session.
     *
     * @param query The DQL query to execute
     * @param sessionId The session ID to use for execution
     */
    async executeWithSession(query: string, sessionId: string): Promise<DqlResult> {
        if (!sessionId) {
            throw new Error('No active session');
        }

        const bridge = this.connectionManager.getDctmBridge();
        const result = await bridge.executeDql(sessionId, query);

        return {
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime,
            query: query.trim()
        };
    }
}
