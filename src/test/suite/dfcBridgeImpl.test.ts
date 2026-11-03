import * as assert from 'assert';
import { DfcBridgeImpl } from '../../dfcBridgeImpl';
import { FakeAxiosClient, RecordedCall } from './fakeAxiosClient';

suite('DfcBridgeImpl Test Suite', () => {
    function createImpl(rows: Record<string, unknown>[] = []) {
        const client = new FakeAxiosClient(() => ({ columns: [], rows, rowCount: rows.length }));
        return { client, impl: new DfcBridgeImpl(client.asAxios()) };
    }

    function dqlQueries(client: FakeAxiosClient): string[] {
        return client.callsTo('post', '/api/v1/dql').map((c: RecordedCall) => (c.body as { query: string }).query);
    }

    suite('row mapping', () => {
        test('maps rows to cabinets', async () => {
            const { impl } = createImpl([{ r_object_id: '0c00000180000101', object_name: 'Temp' }]);

            const cabinets = await impl.getCabinets('s1');

            assert.deepStrictEqual(cabinets, [
                { objectId: '0c00000180000101', type: 'dm_cabinet', name: 'Temp', attributes: {} }
            ]);
        });

        test('maps rows to users', async () => {
            const { impl } = createImpl([{
                r_object_id: '1100000180000101',
                user_name: 'jsmith',
                user_login_name: 'jsmith',
                user_os_name: 'jsmith',
                user_address: 'jsmith@example.com',
                user_state: 0,
                user_source: 'inline password',
                default_folder: '/jsmith',
                user_group_name: 'docu',
                description: 'Test user'
            }]);

            const users = await impl.getUsers('s1');

            assert.deepStrictEqual(users, [{
                objectId: '1100000180000101',
                userName: 'jsmith',
                userOsName: 'jsmith',
                userAddress: 'jsmith@example.com',
                userState: '0',
                defaultFolder: '/jsmith',
                userGroupName: 'docu',
                superUser: false,
                userLoginName: 'jsmith',
                userSource: 'inline password',
                description: 'Test user'
            }]);
        });

        test('maps a row to user details', async () => {
            const { impl } = createImpl([{
                r_object_id: '1100000180000101',
                user_name: 'jsmith',
                user_login_name: 'jsmith_login',
                user_os_name: 'jsmith',
                user_address: 'jsmith@example.com',
                user_state: 1,
                user_source: 'LDAP',
                default_folder: '/jsmith',
                user_group_name: 'docu',
                description: 'Test user',
                r_is_superuser: false
            }]);

            const user = await impl.getUser('s1', 'jsmith');

            assert.strictEqual(user.userLoginName, 'jsmith_login');
            assert.strictEqual(user.userSource, 'LDAP');
            assert.strictEqual(user.description, 'Test user');
            assert.strictEqual(user.userState, '1');
        });

        test('maps rows to groups', async () => {
            const { impl } = createImpl([{ r_object_id: '1200000180000101', group_name: 'admins' }]);

            const groups = await impl.getGroupsForUser('s1', 'jsmith');

            assert.deepStrictEqual(groups, [{
                objectId: '1200000180000101',
                groupName: 'admins',
                description: '',
                groupClass: '',
                groupAdmin: '',
                isPrivate: false,
                usersNames: [],
                groupsNames: []
            }]);
        });
    });

    suite('getFolderContents', () => {
        test('rejects without a folder path', async () => {
            const { impl } = createImpl();

            await assert.rejects(impl.getFolderContents('s1', '0b00000180000101'));
        });

        test('doubles single quotes in the folder path', async () => {
            const { client, impl } = createImpl();

            await impl.getFolderContents('s1', '0b00000180000101', "/Temp/O'Brien");

            const queries = dqlQueries(client);
            assert.strictEqual(queries.length, 2);
            queries.forEach(q => assert.ok(q.includes("folder('/Temp/O''Brien')"), q));
        });
    });

    suite('name escaping', () => {
        test('doubles single quotes in the user name', async () => {
            const { client, impl } = createImpl([{ r_object_id: '1100000180000101', user_name: "O'Brien" }]);

            await impl.getUser('s1', "O'Brien");

            assert.ok(dqlQueries(client)[0].includes("user_name = 'O''Brien'"));
        });

        test('doubles single quotes in the user name for group membership', async () => {
            const { client, impl } = createImpl();

            await impl.getGroupsForUser('s1', "O'Brien");

            assert.ok(dqlQueries(client)[0].includes("users_names = 'O''Brien'"));
        });

        test('doubles single quotes in the group name', async () => {
            const { client, impl } = createImpl();

            await impl.getParentGroups('s1', "O'Brien's group");

            assert.ok(dqlQueries(client)[0].includes("groups_names = 'O''Brien''s group'"));
        });
    });
});
