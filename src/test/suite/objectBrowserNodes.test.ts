import * as assert from 'assert';
import {
    createNodeId,
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
                'connection', 'cabinets-container', 'cabinet', 'folder', 'document'
            ];

            types.forEach(type => {
                const id = createNodeId('conn', type, 'id');
                assert.strictEqual(id, `conn::${type}::id`);
            });
        });
    });

});
