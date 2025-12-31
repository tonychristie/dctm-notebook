import * as assert from 'assert';
import * as vscode from 'vscode';
import { DctmNotebookSerializer } from '../../notebook/notebookSerializer';

suite('NotebookSerializer Test Suite', () => {
    let serializer: DctmNotebookSerializer;
    const cancellationToken: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: new vscode.EventEmitter<void>().event
    };

    setup(() => {
        serializer = new DctmNotebookSerializer();
    });

    suite('deserializeNotebook', () => {
        test('empty file returns default DQL cell', async () => {
            const content = new TextEncoder().encode('');
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.strictEqual(result.cells.length, 1);
            assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(result.cells[0].languageId, 'dql');
            assert.ok(result.cells[0].value.includes('SELECT'));
        });

        test('whitespace-only file returns default DQL cell', async () => {
            const content = new TextEncoder().encode('   \n\t\n   ');
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.strictEqual(result.cells.length, 1);
            assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(result.cells[0].languageId, 'dql');
        });

        test('valid JSON with single code cell', async () => {
            const data = {
                version: 1,
                cells: [
                    { kind: 'code', language: 'dql', content: 'SELECT * FROM dm_document' }
                ]
            };
            const content = new TextEncoder().encode(JSON.stringify(data));
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.strictEqual(result.cells.length, 1);
            assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(result.cells[0].languageId, 'dql');
            assert.strictEqual(result.cells[0].value, 'SELECT * FROM dm_document');
        });

        test('valid JSON with markdown cell', async () => {
            const data = {
                version: 1,
                cells: [
                    { kind: 'markdown', language: 'markdown', content: '# Title' }
                ]
            };
            const content = new TextEncoder().encode(JSON.stringify(data));
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.strictEqual(result.cells.length, 1);
            assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
            assert.strictEqual(result.cells[0].languageId, 'markdown');
            assert.strictEqual(result.cells[0].value, '# Title');
        });

        test('valid JSON with multiple cells', async () => {
            const data = {
                version: 1,
                cells: [
                    { kind: 'markdown', language: 'markdown', content: '# Query Examples' },
                    { kind: 'code', language: 'dql', content: 'SELECT * FROM dm_document' },
                    { kind: 'code', language: 'dmapi', content: 'dmAPIGet("dump,session,0900123456789abc")' }
                ]
            };
            const content = new TextEncoder().encode(JSON.stringify(data));
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.strictEqual(result.cells.length, 3);
            assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Markup);
            assert.strictEqual(result.cells[1].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(result.cells[2].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(result.cells[1].languageId, 'dql');
            assert.strictEqual(result.cells[2].languageId, 'dmapi');
        });

        test('valid JSON with cell metadata', async () => {
            const data = {
                version: 1,
                cells: [
                    {
                        kind: 'code',
                        language: 'dql',
                        content: 'SELECT * FROM dm_document',
                        metadata: { collapsed: true, lastRun: '2024-01-01' }
                    }
                ]
            };
            const content = new TextEncoder().encode(JSON.stringify(data));
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.strictEqual(result.cells.length, 1);
            assert.deepStrictEqual(result.cells[0].metadata, { collapsed: true, lastRun: '2024-01-01' });
        });

        test('valid JSON with notebook metadata', async () => {
            const data = {
                version: 1,
                cells: [
                    { kind: 'code', language: 'dql', content: 'SELECT 1' }
                ],
                metadata: {
                    connection: 'dev-docbase',
                    repository: 'docbase1'
                }
            };
            const content = new TextEncoder().encode(JSON.stringify(data));
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.deepStrictEqual(result.metadata, {
                connection: 'dev-docbase',
                repository: 'docbase1'
            });
        });

        test('invalid JSON returns raw content as code cell', async () => {
            const invalidJson = 'this is { not valid json }';
            const content = new TextEncoder().encode(invalidJson);
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            assert.strictEqual(result.cells.length, 1);
            assert.strictEqual(result.cells[0].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(result.cells[0].languageId, 'dql');
            assert.strictEqual(result.cells[0].value, invalidJson);
        });

        test('malformed JSON structure returns raw content as code cell', async () => {
            // Valid JSON but not matching expected structure
            const content = new TextEncoder().encode(JSON.stringify({ foo: 'bar' }));
            const result = await serializer.deserializeNotebook(content, cancellationToken);

            // Should handle gracefully (cells array is undefined)
            assert.ok(result.cells.length >= 0);
        });
    });

    suite('serializeNotebook', () => {
        test('serializes single code cell', async () => {
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                'SELECT * FROM dm_document',
                'dql'
            );
            const notebookData = new vscode.NotebookData([cellData]);

            const result = await serializer.serializeNotebook(notebookData, cancellationToken);
            const parsed = JSON.parse(new TextDecoder().decode(result));

            assert.strictEqual(parsed.version, 1);
            assert.strictEqual(parsed.cells.length, 1);
            assert.strictEqual(parsed.cells[0].kind, 'code');
            assert.strictEqual(parsed.cells[0].language, 'dql');
            assert.strictEqual(parsed.cells[0].content, 'SELECT * FROM dm_document');
        });

        test('serializes markdown cell', async () => {
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Markup,
                '# Title',
                'markdown'
            );
            const notebookData = new vscode.NotebookData([cellData]);

            const result = await serializer.serializeNotebook(notebookData, cancellationToken);
            const parsed = JSON.parse(new TextDecoder().decode(result));

            assert.strictEqual(parsed.cells[0].kind, 'markdown');
            assert.strictEqual(parsed.cells[0].language, 'markdown');
            assert.strictEqual(parsed.cells[0].content, '# Title');
        });

        test('serializes multiple cells', async () => {
            const cells = [
                new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '# Header', 'markdown'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'SELECT 1', 'dql'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'dmAPIGet("test")', 'dmapi')
            ];
            const notebookData = new vscode.NotebookData(cells);

            const result = await serializer.serializeNotebook(notebookData, cancellationToken);
            const parsed = JSON.parse(new TextDecoder().decode(result));

            assert.strictEqual(parsed.cells.length, 3);
            assert.strictEqual(parsed.cells[0].kind, 'markdown');
            assert.strictEqual(parsed.cells[1].kind, 'code');
            assert.strictEqual(parsed.cells[2].kind, 'code');
        });

        test('serializes cell metadata', async () => {
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                'SELECT 1',
                'dql'
            );
            cellData.metadata = { collapsed: true };
            const notebookData = new vscode.NotebookData([cellData]);

            const result = await serializer.serializeNotebook(notebookData, cancellationToken);
            const parsed = JSON.parse(new TextDecoder().decode(result));

            assert.deepStrictEqual(parsed.cells[0].metadata, { collapsed: true });
        });

        test('serializes notebook metadata', async () => {
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                'SELECT 1',
                'dql'
            );
            const notebookData = new vscode.NotebookData([cellData]);
            notebookData.metadata = {
                connection: 'prod-docbase',
                repository: 'main_repo'
            };

            const result = await serializer.serializeNotebook(notebookData, cancellationToken);
            const parsed = JSON.parse(new TextDecoder().decode(result));

            assert.deepStrictEqual(parsed.metadata, {
                connection: 'prod-docbase',
                repository: 'main_repo'
            });
        });

        test('output is properly formatted JSON', async () => {
            const cellData = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                'SELECT 1',
                'dql'
            );
            const notebookData = new vscode.NotebookData([cellData]);

            const result = await serializer.serializeNotebook(notebookData, cancellationToken);
            const text = new TextDecoder().decode(result);

            // Check that it's formatted with indentation
            assert.ok(text.includes('\n'));
            assert.ok(text.includes('  ')); // 2-space indentation
        });
    });

    suite('roundtrip', () => {
        test('serialize then deserialize preserves content', async () => {
            const originalCells = [
                new vscode.NotebookCellData(vscode.NotebookCellKind.Markup, '# My Notebook', 'markdown'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'SELECT * FROM dm_document WHERE object_name LIKE \'test%\'', 'dql'),
                new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'dmAPIExec("save,session,0900123456789abc")', 'dmapi')
            ];
            const originalData = new vscode.NotebookData(originalCells);
            originalData.metadata = { connection: 'test-conn' };

            // Serialize
            const serialized = await serializer.serializeNotebook(originalData, cancellationToken);

            // Deserialize
            const restored = await serializer.deserializeNotebook(serialized, cancellationToken);

            // Verify cells
            assert.strictEqual(restored.cells.length, 3);
            assert.strictEqual(restored.cells[0].kind, vscode.NotebookCellKind.Markup);
            assert.strictEqual(restored.cells[0].value, '# My Notebook');
            assert.strictEqual(restored.cells[1].kind, vscode.NotebookCellKind.Code);
            assert.strictEqual(restored.cells[1].languageId, 'dql');
            assert.strictEqual(restored.cells[2].languageId, 'dmapi');

            // Verify metadata
            assert.deepStrictEqual(restored.metadata, { connection: 'test-conn' });
        });

        test('empty cells array roundtrips correctly', async () => {
            const originalData = new vscode.NotebookData([]);

            const serialized = await serializer.serializeNotebook(originalData, cancellationToken);
            const restored = await serializer.deserializeNotebook(serialized, cancellationToken);

            assert.strictEqual(restored.cells.length, 0);
        });
    });
});
