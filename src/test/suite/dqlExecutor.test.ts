import * as assert from 'assert';
import { DqlExecutor } from '../../dqlExecutor';
import { RepositoryConnection } from '../../repositoryConnection';

function harness() {
    const queries: string[] = [];
    const bridge = {
        executeDql: async (_sessionId: string, query: string) => {
            queries.push(query);
            return { columns: ['object_name'], rows: [{ object_name: 'Temp' }], rowCount: 1, executionTime: 4 };
        }
    };
    const connection = { sessionId: 'session-1', bridge } as unknown as RepositoryConnection;
    return { executor: new DqlExecutor(), connection, queries };
}

suite('DqlExecutor Test Suite', () => {
    test('sends the query without a line comment', async () => {
        const { executor, connection, queries } = harness();

        await executor.execute('-- List all cabinets\nselect object_name from dm_cabinet', connection);

        assert.deepStrictEqual(queries, ['select object_name from dm_cabinet']);
    });

    test('sends the query without a block comment', async () => {
        const { executor, connection, queries } = harness();

        await executor.execute('/* cabinets */ select object_name from dm_cabinet', connection);

        assert.deepStrictEqual(queries, ['select object_name from dm_cabinet']);
    });

    test('keeps a comment marker inside a string literal', async () => {
        const { executor, connection, queries } = harness();

        await executor.execute("select object_name from dm_document where object_name = 'a -- b'", connection);

        assert.deepStrictEqual(queries, ["select object_name from dm_document where object_name = 'a -- b'"]);
    });

    test('returns the query as the user typed it', async () => {
        const { executor, connection } = harness();

        const result = await executor.execute('-- List all cabinets\nselect object_name from dm_cabinet\n', connection);

        assert.strictEqual(result.query, '-- List all cabinets\nselect object_name from dm_cabinet');
    });

    test('rejects text that holds only comments and does not call the bridge', async () => {
        const { executor, connection, queries } = harness();

        await assert.rejects(
            executor.execute('-- nothing here\n/* or here */', connection),
            { message: 'No DQL query to execute' }
        );
        assert.deepStrictEqual(queries, []);
    });
});
