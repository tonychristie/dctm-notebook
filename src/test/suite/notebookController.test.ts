import * as assert from 'assert';
import { errorOutput } from '../../notebook/notebookController';

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
});
