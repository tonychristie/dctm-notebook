import * as assert from 'assert';
import { handleResultsMessage, ResultsExporter, ResultsWorkspaces } from '../../resultsPanel';
import type { DumpTarget } from '../../workspace/dumpTab';

class FakeWorkspaces implements ResultsWorkspaces {
    readonly dumps: Array<{ connectionName: string; target: DumpTarget }> = [];

    async showDump(connectionName: string, target: DumpTarget): Promise<void> {
        this.dumps.push({ connectionName, target });
    }
}

class FakeExporter implements ResultsExporter {
    readonly calls: Array<{ format: string; columns: string[]; rows: Record<string, unknown>[] }> = [];

    async exportToExcel(columns: string[], rows: Record<string, unknown>[]): Promise<void> {
        this.calls.push({ format: 'excel', columns, rows });
    }

    async exportToJson(columns: string[], rows: Record<string, unknown>[]): Promise<void> {
        this.calls.push({ format: 'json', columns, rows });
    }
}

suite('ResultsPanel Test Suite', () => {
    test('a dumpObject message opens the Dump tab of the connection the query ran on', async () => {
        const workspaces = new FakeWorkspaces();

        await handleResultsMessage({ command: 'dumpObject', objectId: '0900000000000001' }, 'conn2', workspaces);

        assert.deepStrictEqual(workspaces.dumps, [
            { connectionName: 'conn2', target: { kind: 'object', objectId: '0900000000000001' } }
        ]);
    });

    test('an exportData message calls the exporter for its format with the rows it was given', async () => {
        const exporter = new FakeExporter();
        const columns = ['object_name'];
        const rows = [{ object_name: 'b' }, { object_name: 'a' }];

        await handleResultsMessage(
            { command: 'exportData', data: { format: 'excel', columns, rows } }, 'conn1', new FakeWorkspaces(), exporter);
        await handleResultsMessage(
            { command: 'exportData', data: { format: 'json', columns, rows } }, 'conn1', new FakeWorkspaces(), exporter);

        assert.deepStrictEqual(exporter.calls, [
            { format: 'excel', columns, rows },
            { format: 'json', columns, rows }
        ]);
    });
});
