import { RepositoryConnection } from './repositoryConnection';

export interface DqlResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
    query: string;
}

export class DqlExecutor {
    async execute(query: string, connection: RepositoryConnection): Promise<DqlResult> {
        const result = await connection.bridge.executeDql(connection.sessionId, query);

        return {
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime,
            query: query.trim()
        };
    }
}
