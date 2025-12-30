import { ConnectionManager } from './connectionManager';

export interface DqlResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
    query: string;
    connectionType: 'dfc' | 'rest';
}

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

        if (connection.type === 'dfc') {
            return this.executeDfc(query);
        } else {
            return this.executeRest(query);
        }
    }

    private async executeDfc(query: string): Promise<DqlResult> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || connection.type !== 'dfc' || !connection.sessionId) {
            throw new Error('No active DFC session');
        }

        const bridge = this.connectionManager.getDfcBridge();
        const result = await bridge.executeDql(connection.sessionId, query);

        return {
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime,
            query: query.trim(),
            connectionType: 'dfc'
        };
    }

    private async executeRest(query: string): Promise<DqlResult> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || connection.type !== 'rest' || !connection.client) {
            throw new Error('No active REST connection');
        }

        const startTime = Date.now();

        try {
            // Documentum REST API DQL endpoint
            const response = await connection.client.get(
                `/repositories/${connection.config.repository}/dql`,
                {
                    params: {
                        dql: query,
                        'items-per-page': 100  // Configurable later
                    }
                }
            );

            const executionTime = Date.now() - startTime;

            // Parse Documentum REST response
            const entries = response.data.entries || [];

            // Extract column names from first row
            const columns: string[] = [];
            const rows: Record<string, unknown>[] = [];

            if (entries.length > 0) {
                const firstEntry = entries[0].content?.properties || entries[0];
                columns.push(...Object.keys(firstEntry));

                for (const entry of entries) {
                    const props = entry.content?.properties || entry;
                    rows.push(props);
                }
            }

            return {
                columns,
                rows,
                rowCount: rows.length,
                executionTime,
                query: query.trim(),
                connectionType: 'rest'
            };

        } catch (error) {
            if (error instanceof Error) {
                const axiosError = error as { response?: { data?: { message?: string } } };
                const message = axiosError.response?.data?.message || error.message;
                throw new Error(`DQL execution failed: ${message}`);
            }
            throw error;
        }
    }
}
