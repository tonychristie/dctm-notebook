import * as assert from 'assert';
import * as vscode from 'vscode';
import { ApiExecutor } from '../../apiExecutor';
import { DqlExecutor } from '../../dqlExecutor';
import { CellExecution, NotebookCellRunner, errorOutput } from '../../notebook/notebookController';
import { RepositoryConnection } from '../../repositoryConnection';

class FakeExecution implements CellExecution {
    outputs: vscode.NotebookCellOutput[] | undefined;
    success: boolean | undefined;

    async replaceOutput(out: vscode.NotebookCellOutput | readonly vscode.NotebookCellOutput[]): Promise<void> {
        this.outputs = Array.isArray(out) ? [...out] : [out as vscode.NotebookCellOutput];
    }

    end(success: boolean | undefined): void {
        this.success = success;
    }
}

interface FakeBridgeOptions {
    dqlError?: string;
    rest?: boolean;
}

function harness(options: FakeBridgeOptions = {}) {
    const calls: string[] = [];
    const bridge = {
        executeDql: async (_sessionId: string, query: string) => {
            calls.push(`dql:${query}`);
            if (options.dqlError) {
                throw new Error(options.dqlError);
            }
            return { columns: ['object_name'], rows: [{ object_name: 'Temp' }], rowCount: 1, executionTime: 4 };
        },
        executeApi: async (_sessionId: string, _typeName: string, method: string, params: { args?: unknown[] }) => {
            calls.push(`api:${method}(${(params.args ?? []).join(',')})`);
            return { result: 'ok', resultType: 'boolean', executionTimeMs: 2 };
        },
        executeDmApi: async (_sessionId: string, apiType: string, command: string) => {
            calls.push(`dmapi:${apiType}:${command}`);
            return { result: 's0', resultType: 'string', executionTimeMs: 1 };
        },
        isRestSession: () => options.rest === true
    };
    const connection = { name: 'A', sessionId: 'session-1', bridge } as unknown as RepositoryConnection;
    const runner = new NotebookCellRunner(new DqlExecutor(), new ApiExecutor());
    return { runner, connection, calls };
}

function cellDocument(languageId: string, text: string) {
    return { languageId, getText: () => text };
}

function outputMimes(execution: FakeExecution): string[] {
    return (execution.outputs ?? []).flatMap(output => output.items.map(item => item.mime));
}

function errorMessageOf(execution: FakeExecution): string {
    const item = execution.outputs![0].items[0];
    return JSON.parse(new TextDecoder().decode(item.data)).message;
}

suite('NotebookController Test Suite', () => {
    suite('errorOutput', () => {
        const message = '[DQL_ERROR] DQL execution failed: syntax error';

        test('has one notebook error item', () => {
            const output = errorOutput(message);

            assert.strictEqual(output.items.length, 1);
            assert.strictEqual(output.items[0].mime, 'application/vnd.code.notebook.error');
        });

        test('item carries the message with an empty name and no stack', () => {
            const output = errorOutput(message);
            const data = JSON.parse(new TextDecoder().decode(output.items[0].data));

            assert.strictEqual(data.message, message);
            assert.strictEqual(data.name, '');
            assert.strictEqual('stack' in data, false);
        });
    });

    suite('NotebookCellRunner', () => {
        test('a DQL cell that returns rows ends with success and the result output', async () => {
            const { runner, connection, calls } = harness();
            const execution = new FakeExecution();

            await runner.run(execution, cellDocument('dql', '-- cabinets\nselect object_name from dm_cabinet'), {}, connection);

            assert.strictEqual(execution.success, true);
            assert.deepStrictEqual(outputMimes(execution), ['application/x-dctm-result', 'text/plain']);
            assert.deepStrictEqual(calls, ['dql:select object_name from dm_cabinet']);
        });

        test('a DQL cell whose metadata asks for JSON ends with the JSON output', async () => {
            const { runner, connection } = harness();
            const execution = new FakeExecution();

            await runner.run(execution, cellDocument('dql', 'select object_name from dm_cabinet'), { outputFormat: 'json' }, connection);

            assert.strictEqual(execution.success, true);
            assert.deepStrictEqual(outputMimes(execution), ['application/json', 'text/plain']);
        });

        test('a DQL cell with only comments ends with success, no output and no bridge call', async () => {
            const { runner, connection, calls } = harness();
            const execution = new FakeExecution();

            await runner.run(execution, cellDocument('dql', '-- nothing here\n/* or here */'), {}, connection);

            assert.strictEqual(execution.success, true);
            assert.deepStrictEqual(execution.outputs, []);
            assert.deepStrictEqual(calls, []);
        });

        test('a DQL error ends with failure and an error output', async () => {
            const { runner, connection } = harness({ dqlError: 'DM_QUERY_E_SYNTAX' });
            const execution = new FakeExecution();

            await runner.run(execution, cellDocument('dql', 'select from'), {}, connection);

            assert.strictEqual(execution.success, false);
            assert.strictEqual(errorMessageOf(execution), 'DM_QUERY_E_SYNTAX');
        });

        test('an API cell ends with success and its result output', async () => {
            const { runner, connection, calls } = harness();
            const execution = new FakeExecution();

            await runner.run(execution, cellDocument('dmapi', 'getString object_name'), {}, connection);

            assert.strictEqual(execution.success, true);
            assert.deepStrictEqual(outputMimes(execution), ['application/x-dctm-result', 'text/plain']);
            assert.deepStrictEqual(calls, ['api:getString(object_name)']);
        });

        test('a dmAPI cell ends with success and its result output', async () => {
            const { runner, connection, calls } = harness();
            const execution = new FakeExecution();

            await runner.run(execution, cellDocument('dmapi', '-- session\ndmAPIGet("getsessionid,c")'), {}, connection);

            assert.strictEqual(execution.success, true);
            assert.deepStrictEqual(outputMimes(execution), ['application/x-dctm-result', 'text/plain']);
            assert.deepStrictEqual(calls, ['dmapi:get:getsessionid,c']);
        });

        test('a dmAPI cell on a REST session ends with failure', async () => {
            const { runner, connection, calls } = harness({ rest: true });
            const execution = new FakeExecution();

            await runner.run(execution, cellDocument('dmapi', 'dmAPIGet("getsessionid,c")'), {}, connection);

            assert.strictEqual(execution.success, false);
            assert.match(errorMessageOf(execution), /not available with REST connections/);
            assert.deepStrictEqual(calls, []);
        });
    });
});
