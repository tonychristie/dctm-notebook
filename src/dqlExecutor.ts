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

    async execute(query: string): Promise<DqlResult> {
        const connection = this.connectionManager.getActiveConnection();

        if (!connection) {
            throw new Error('Not connected to Documentum. Use "Documentum: Connect" first.');
        }

        if (!connection.sessionId) {
            throw new Error('No active session');
        }

        const bridge = this.connectionManager.getDfcBridge();
        const result = await bridge.executeDql(connection.sessionId, query);

        return {
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime,
            query: query.trim()
        };
    }
}
