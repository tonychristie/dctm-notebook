import * as assert from 'assert';
import { toGroupDetails, GroupInfo } from '../../bridgeTypes';
import { DfcBridgeImpl } from '../../dfcBridgeImpl';
import { RestBridgeImpl } from '../../restBridgeImpl';
import { FakeAxiosClient } from './fakeAxiosClient';

suite('BridgeImplBase Test Suite', () => {
    suite('toGroupDetails', () => {
        test('lists the group attributes sorted by name', () => {
            const group: GroupInfo = {
                objectId: '1200000180000101',
                groupName: 'my_group',
                description: 'Test group',
                groupClass: 'group',
                groupAdmin: 'admins',
                isPrivate: false,
                usersNames: ['jsmith'],
                groupsNames: [],
                ownerName: 'dmadmin',
                groupAddress: 'group@example.com',
                groupSource: 'LDAP',
                isDynamic: true
            };

            const details = toGroupDetails(group);

            assert.deepStrictEqual(details.attributes, [
                { name: 'description', value: 'Test group', dataType: 'string' },
                { name: 'group_address', value: 'group@example.com', dataType: 'string' },
                { name: 'group_admin', value: 'admins', dataType: 'string' },
                { name: 'group_class', value: 'group', dataType: 'string' },
                { name: 'group_name', value: 'my_group', dataType: 'string' },
                { name: 'group_source', value: 'LDAP', dataType: 'string' },
                { name: 'is_dynamic', value: true, dataType: 'boolean' },
                { name: 'is_private', value: false, dataType: 'boolean' },
                { name: 'owner_name', value: 'dmadmin', dataType: 'string' }
            ]);
            assert.deepStrictEqual(details.usersNames, ['jsmith']);
        });
    });

    suite('shared calls', () => {
        test('connection type follows the subclass', () => {
            const client = new FakeAxiosClient().asAxios();

            assert.strictEqual(new DfcBridgeImpl(client).connectionType, 'dfc');
            assert.strictEqual(new RestBridgeImpl(client).connectionType, 'rest');
        });

        test('executeDql maps column names and sends the given timeout', async () => {
            const client = new FakeAxiosClient(() => ({
                columns: [{ name: 'r_object_id' }, { name: 'object_name' }],
                rows: [{ r_object_id: '0900000180000101', object_name: 'Doc' }],
                rowCount: 1
            }));

            const result = await new RestBridgeImpl(client.asAxios()).executeDql('s1', 'SELECT 1', 5000);

            assert.deepStrictEqual(result.columns, ['r_object_id', 'object_name']);
            assert.strictEqual(result.rowCount, 1);
            assert.strictEqual(client.callsTo('post', '/api/v1/dql')[0].timeout, 5000);
        });

        test('executeDql requests the next page until hasMore is false and returns every row', async () => {
            const pages: Record<number, unknown> = {
                0: { columns: [{ name: 'user_name' }], rows: [{ user_name: 'a' }, { user_name: 'b' }], hasMore: true },
                2: { columns: [{ name: 'user_name' }], rows: [{ user_name: 'c' }], hasMore: false }
            };
            const client = new FakeAxiosClient(call => pages[(call.body as { startRow: number }).startRow]);

            const result = await new DfcBridgeImpl(client.asAxios()).executeDql('s1', 'SELECT user_name FROM dm_user', 5000);

            assert.deepStrictEqual(result.rows, [{ user_name: 'a' }, { user_name: 'b' }, { user_name: 'c' }]);
            assert.strictEqual(result.rowCount, 3);
            assert.deepStrictEqual(result.columns, ['user_name']);
            const calls = client.callsTo('post', '/api/v1/dql');
            assert.deepStrictEqual(calls.map(c => (c.body as { startRow: number }).startRow), [0, 2]);
            assert.ok(calls.every(c => (c.body as { maxRows: number }).maxRows > 100));
            assert.ok(calls.every(c => c.timeout === 5000));
        });

        test('executeDql without a timeout leaves the client default', async () => {
            const client = new FakeAxiosClient(() => ({}));

            await new RestBridgeImpl(client.asAxios()).executeDql('s1', 'SELECT 1');

            assert.strictEqual(client.callsTo('post', '/api/v1/dql')[0].timeout, undefined);
        });

        test('getGroup builds the attribute list from the response', async () => {
            const client = new FakeAxiosClient(() => ({ groupName: 'my_group', ownerName: 'dmadmin' }));

            const group = await new DfcBridgeImpl(client.asAxios()).getGroup('s1', 'my_group');

            const byName = new Map(group.attributes.map(a => [a.name, a]));
            assert.deepStrictEqual(byName.get('owner_name'), { name: 'owner_name', value: 'dmadmin', dataType: 'string' });
        });
    });
});
