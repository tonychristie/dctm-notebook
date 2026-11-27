import * as assert from 'assert';
import { extractConnectionName, extractObjectId } from '../../workspace/objectCommands';

suite('Object Commands Test Suite', () => {
    suite('extractObjectId', () => {
        test('returns objectId from a workspace webview context', () => {
            assert.strictEqual(
                extractObjectId({ webviewSection: 'document', connectionName: 'conn1', objectId: '0900000180001234' }),
                '0900000180001234'
            );
        });

        test('returns undefined for anything else', () => {
            assert.strictEqual(extractObjectId(undefined), undefined);
            assert.strictEqual(extractObjectId(null), undefined);
            assert.strictEqual(extractObjectId(42), undefined);
            assert.strictEqual(extractObjectId({ objectId: 42 }), undefined);
        });
    });

    suite('extractConnectionName', () => {
        test('returns connectionName from a workspace webview context', () => {
            assert.strictEqual(
                extractConnectionName({ webviewSection: 'folder', connectionName: 'conn1', objectId: '0b00000180001234' }),
                'conn1'
            );
        });

        test('returns undefined for anything else', () => {
            assert.strictEqual(extractConnectionName('conn1'), undefined);
            assert.strictEqual(extractConnectionName(undefined), undefined);
            assert.strictEqual(extractConnectionName({ webviewSection: 'folder' }), undefined);
        });
    });
});
