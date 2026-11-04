import * as assert from 'assert';
import { UserCache } from '../../userCache';
import { DctmBridge } from '../../dctmBridge';
import { UserDetails, UserInfo as BridgeUserInfo } from '../../bridgeTypes';

const listedUser: BridgeUserInfo = {
    objectId: '1100000180000101',
    userName: 'testuser',
    userOsName: 'testuser',
    userAddress: '',
    userState: '0',
    defaultFolder: '/testuser',
    userGroupName: 'docu',
    superUser: false,
    description: 'Test User'
};

const detailedUser: UserDetails = {
    ...listedUser,
    userOsName: 'testuser_os',
    userAddress: 'testuser@example.com',
    userState: '1',
    userLoginName: 'tuser',
    userSource: 'LDAP',
    description: 'Test User (updated)',
    attributes: [{ name: 'user_state', value: 1, dataType: 'integer' }]
};

suite('UserCache Test Suite', () => {
    let getUserCalls: string[];
    let bridgeError: Error | undefined;
    let userCache: UserCache;

    setup(async () => {
        getUserCalls = [];
        bridgeError = undefined;
        const bridge = {
            getUsers: async () => [listedUser],
            getUser: async (sessionId: string, userName: string) => {
                getUserCalls.push(`${sessionId}:${userName}`);
                if (bridgeError) {
                    throw bridgeError;
                }
                return detailedUser;
            },
            getGroupsForUser: async () => {
                if (bridgeError) {
                    throw bridgeError;
                }
                return [{ groupName: 'docu' }, { groupName: 'admingroup' }];
            }
        };
        userCache = new UserCache(bridge as unknown as DctmBridge, 'session-1');
        await userCache.refresh();
    });

    teardown(() => {
        userCache.dispose();
    });

    test('refresh maps each bridge user to a user entry without attributes', () => {
        const user = userCache.get('TESTUSER');

        assert.ok(user);
        assert.strictEqual(user.userState, 0);
        assert.strictEqual(user.userLoginName, '');
        assert.strictEqual(user.defaultGroup, 'docu');
        assert.deepStrictEqual(user.attributes, []);
    });

    suite('fetchUserDetails', () => {
        test('fetches a cached user from the bridge and stores the detailed entry', async () => {
            const user = await userCache.fetchUserDetails('testuser');

            assert.deepStrictEqual(getUserCalls, ['session-1:testuser']);
            assert.strictEqual(user.userState, 1);
            assert.strictEqual(user.userLoginName, 'tuser');
            assert.strictEqual(user.userSource, 'LDAP');
            assert.strictEqual(user.userOsName, 'testuser_os');
            assert.strictEqual(user.userAddress, 'testuser@example.com');
            assert.strictEqual(user.description, 'Test User (updated)');
            assert.deepStrictEqual(user.attributes, detailedUser.attributes);
            assert.strictEqual(userCache.get('testuser'), user);
        });

        test('returns a detailed user without a bridge call unless refresh is set', async () => {
            await userCache.fetchUserDetails('testuser');

            await userCache.fetchUserDetails('testuser');
            assert.strictEqual(getUserCalls.length, 1);

            await userCache.fetchUserDetails('testuser', true);
            assert.strictEqual(getUserCalls.length, 2);
        });

        test('rejects with the bridge error', async () => {
            bridgeError = new Error('401 Unauthorized');

            await assert.rejects(userCache.fetchUserDetails('testuser'), /401 Unauthorized/);
        });
    });

    suite('getUserGroups', () => {
        test('returns the sorted group names', async () => {
            assert.deepStrictEqual(await userCache.getUserGroups('testuser'), ['admingroup', 'docu']);
        });

        test('rejects with the bridge error', async () => {
            bridgeError = new Error('timeout of 30000ms exceeded');

            await assert.rejects(userCache.getUserGroups('testuser'), /timeout/);
        });
    });
});
