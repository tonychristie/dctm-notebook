import { RepositoryConnection } from './repositoryConnection';
import { stripComments } from './notebook/commandParsing';

export interface DqlResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
    query: string;
}

// The bridge rejects DQL comments with DM_QUERY_E_SYNTAX.
export function dqlStatement(query: string): string {
    return stripComments(query, true);
}

export class DqlExecutor {
    async execute(query: string, connection: RepositoryConnection): Promise<DqlResult> {
        const statement = dqlStatement(query);
        if (!statement) {
            throw new Error('No DQL query to execute');
        }

        const result = await connection.bridge.executeDql(connection.sessionId, statement);

        return {
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime,
            query: query.trim()
        };
    }
}
