import * as assert from 'assert';
import { ObjectInfo } from '../../bridgeTypes';
import { RepositoryConnection } from '../../repositoryConnection';
import {
    CabinetsMessage,
    CabinetsTab,
    cabinetNodes,
    compareFolderContentNodes,
    createChildNodeId,
    folderContentNodes,
    isFolderObjectId
} from '../../workspace/cabinetsTab';

function info(objectId: string, name: string, attributes: Record<string, unknown> = {}): ObjectInfo {
    return { objectId, name, type: objectId.startsWith('0b') ? 'dm_folder' : 'dm_document', attributes };
}

const cabinet = { id: 'conn1::cabinet::0c00000180000100', objectId: '0c00000180000100', path: '/Temp' };

suite('CabinetsTab Test Suite', () => {
    test('folder contents come back folders first, then documents, each by name', () => {
        const nodes = folderContentNodes('conn1', cabinet, [
            info('0900000180000002', 'beta.txt'),
            info('0b00000180000002', 'Zeta'),
            info('0900000180000001', 'alpha.txt'),
            info('0b00000180000001', 'Alpha')
        ]);

        assert.deepStrictEqual(nodes.map(node => node.label), ['Alpha', 'Zeta', 'alpha.txt', 'beta.txt']);
        assert.deepStrictEqual(nodes.map(node => node.type), ['folder', 'folder', 'document', 'document']);
    });

    test('an object linked into two folders gets a different node id under each', () => {
        const [folderA, folderB] = folderContentNodes('conn1', cabinet, [
            info('0b0000018000000a', 'A'),
            info('0b0000018000000b', 'B')
        ]);
        const document = info('0900000180000101', 'linked.txt');

        const [underA] = folderContentNodes('conn1', { id: folderA.id, objectId: folderA.objectId, path: folderA.path! }, [document]);
        const [underB] = folderContentNodes('conn1', { id: folderB.id, objectId: folderB.objectId, path: folderB.path! }, [document]);

        assert.notStrictEqual(underA.id, underB.id);
        assert.strictEqual(underA.context.nodeId, underA.id);
    });

    test('folders carry their path and documents their format', () => {
        const [folder, document] = folderContentNodes('conn1', cabinet, [
            info('0b00000180000001', 'Reports'),
            info('0900000180000001', 'report.pdf', { a_content_type: 'pdf' })
        ]);

        assert.strictEqual(folder.path, '/Temp/Reports');
        assert.strictEqual(folder.expandable, true);
        assert.strictEqual(document.icon, 'file-pdf');
        assert.strictEqual(document.description, 'pdf');
        assert.strictEqual(document.expandable, false);
        assert.deepStrictEqual(document.context, {
            webviewSection: 'document',
            connectionName: 'conn1',
            objectId: '0900000180000001',
            nodeId: document.id
        });
    });

    test('cabinets keep the bridge order and get a path from their name', () => {
        const nodes = cabinetNodes('conn1', [info('0c00000180000002', 'Temp'), info('0c00000180000001', 'System')]);

        assert.deepStrictEqual(nodes.map(node => node.path), ['/Temp', '/System']);
        assert.strictEqual(nodes[0].context.webviewSection, 'cabinet');
    });

    test('a failed load reports the error for its request', async () => {
        const posted: CabinetsMessage[] = [];
        const connection = {
            sessionId: 'session',
            bridge: { getCabinets: async () => { throw new Error('bridge unavailable'); } }
        } as unknown as RepositoryConnection;
        const tab = new CabinetsTab('conn1', { getOpenConnection: () => connection }, m => posted.push(m), async () => undefined);

        await tab.handleMessage({ command: 'loadCabinets', requestId: 7 });

        assert.deepStrictEqual(posted, [{ type: 'cabinetsResult', requestId: 7, error: 'bridge unavailable' }]);
    });

    suite('createChildNodeId', () => {
        test('gives the same object different ids under different parents', () => {
            const underA = createChildNodeId(createChildNodeId(cabinet.id, '0b0000018000000a'), '0900000180000101');
            const underB = createChildNodeId(createChildNodeId(cabinet.id, '0b0000018000000b'), '0900000180000101');

            assert.notStrictEqual(underA, underB);
        });

        test('gives a child of a linked folder different ids in each place the folder is linked', () => {
            const linkedUnderA = createChildNodeId(createChildNodeId(cabinet.id, '0b0000018000000a'), '0b0000018000000x');
            const linkedUnderB = createChildNodeId(createChildNodeId(cabinet.id, '0b0000018000000b'), '0b0000018000000x');

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

    suite('compareFolderContentNodes', () => {
        const folder = (name: string) => ({ name, type: 'folder' as const });
        const document = (name: string) => ({ name, type: 'document' as const });

        test('sorts a folder before a document whose name comes earlier', () => {
            assert.ok(compareFolderContentNodes(folder('Budget'), document('Annual report')) < 0);
            assert.ok(compareFolderContentNodes(document('Annual report'), folder('Budget')) > 0);
        });

        test('sorts two folders by name', () => {
            assert.ok(compareFolderContentNodes(folder('Archive'), folder('Budget')) < 0);
            assert.ok(compareFolderContentNodes(folder('Budget'), folder('Archive')) > 0);
        });

        test('sorts two documents by name', () => {
            assert.ok(compareFolderContentNodes(document('Annual report'), document('Summary')) < 0);
            assert.ok(compareFolderContentNodes(document('Summary'), document('Annual report')) > 0);
        });

        test('sorts a mixed list to folders by name, then documents by name', () => {
            const storageOrder = [folder('Reports'), document('Summary'), folder('Budget'), document('Annual report')];

            const sorted = storageOrder.sort(compareFolderContentNodes).map(n => n.name);

            assert.deepStrictEqual(sorted, ['Budget', 'Reports', 'Annual report', 'Summary']);
        });
    });
});
