import * as assert from 'assert';
import {
    createNodeId,
    createChildNodeId,
    isFolderObjectId,
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

    suite('createChildNodeId', () => {
        const cabinetId = createNodeId('conn', 'cabinet', '0c00000180000100');

        test('gives the same object different ids under different parents', () => {
            const underA = createChildNodeId(createChildNodeId(cabinetId, '0b0000018000000a'), '0900000180000101');
            const underB = createChildNodeId(createChildNodeId(cabinetId, '0b0000018000000b'), '0900000180000101');

            assert.notStrictEqual(underA, underB);
        });

        test('gives a child of a linked folder different ids in each place the folder is linked', () => {
            const linkedUnderA = createChildNodeId(createChildNodeId(cabinetId, '0b0000018000000a'), '0b0000018000000x');
            const linkedUnderB = createChildNodeId(createChildNodeId(cabinetId, '0b0000018000000b'), '0b0000018000000x');

            assert.notStrictEqual(
                createChildNodeId(linkedUnderA, '0900000180000101'),
                createChildNodeId(linkedUnderB, '0900000180000101')
            );
        });
    });

    suite('isFolderObjectId', () => {
        test('returns true for a folder id', () => {
            assert.strictEqual(isFolderObjectId('0b00000180000101'), true);
        });

        test('returns true for a cabinet id', () => {
            assert.strictEqual(isFolderObjectId('0c00000180000101'), true);
        });

        test('returns false for a document id', () => {
            assert.strictEqual(isFolderObjectId('0900000180000101'), false);
        });
    });

});
