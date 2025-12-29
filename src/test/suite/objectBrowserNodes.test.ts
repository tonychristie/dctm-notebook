import * as assert from 'assert';
import {
    createNodeId,
    escapeDqlString,
    NodeType
} from '../../objectBrowserNodes';

suite('ObjectBrowserNodes Test Suite', () => {

    suite('createNodeId', () => {
        test('creates correct ID format', () => {
            const id = createNodeId('DevConnection', 'folder', 'abc123');
            assert.strictEqual(id, 'DevConnection::folder::abc123');
        });

        test('handles special characters in connection name', () => {
            const id = createNodeId('Dev-Connection_01', 'document', 'xyz789');
            assert.strictEqual(id, 'Dev-Connection_01::document::xyz789');
        });

        test('handles different node types', () => {
            const types: NodeType[] = [
                'connection', 'cabinets-container', 'types-container',
                'users-container', 'groups-container', 'cabinet',
                'folder', 'document', 'type', 'user', 'group'
            ];

            types.forEach(type => {
                const id = createNodeId('conn', type, 'id');
                assert.strictEqual(id, `conn::${type}::id`);
            });
        });
    });

    suite('escapeDqlString', () => {
        test('returns empty string unchanged', () => {
            assert.strictEqual(escapeDqlString(''), '');
        });

        test('returns null/undefined unchanged', () => {
            assert.strictEqual(escapeDqlString(null as unknown as string), null);
            assert.strictEqual(escapeDqlString(undefined as unknown as string), undefined);
        });

        test('returns string without quotes unchanged', () => {
            assert.strictEqual(escapeDqlString('normal string'), 'normal string');
        });

        test('escapes single quote', () => {
            assert.strictEqual(escapeDqlString("test's value"), "test''s value");
        });

        test('escapes multiple single quotes', () => {
            assert.strictEqual(escapeDqlString("it's a 'test'"), "it''s a ''test''");
        });

        test('escapes single quote only', () => {
            assert.strictEqual(escapeDqlString("'"), "''");
        });

        test('handles folder path with quotes', () => {
            assert.strictEqual(
                escapeDqlString("/Cabinet/John's Folder"),
                "/Cabinet/John''s Folder"
            );
        });

        test('handles SQL injection attempt', () => {
            const malicious = "'; DROP TABLE dm_document; --";
            const escaped = escapeDqlString(malicious);
            assert.strictEqual(escaped, "'''; DROP TABLE dm_document; --");
        });

        test('handles consecutive quotes', () => {
            assert.strictEqual(escapeDqlString("test'''value"), "test''''''value");
        });

        test('handles unicode characters', () => {
            assert.strictEqual(escapeDqlString("test'value"), "test''value");
        });
    });

});
