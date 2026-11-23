import * as assert from 'assert';
import { ObjectInfo } from '../../bridgeTypes';
import { RepositoryConnection } from '../../repositoryConnection';
import { CabinetsMessage, CabinetsTab, cabinetNodes, folderContentNodes } from '../../workspace/cabinetsTab';

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
});
