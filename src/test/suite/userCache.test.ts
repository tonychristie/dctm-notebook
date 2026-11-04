import * as assert from 'assert';
import { UserCache, UserInfo } from '../../userCache';
import { DctmBridge } from '../../dctmBridge';

const unusedBridge = {} as DctmBridge;

suite('UserCache Test Suite', () => {
    let userCache: UserCache;

    setup(() => {
        userCache = new UserCache(unusedBridge, 'session-1');
    });

    suite('Initial State', () => {
        test('hasData returns false initially', () => {
            assert.strictEqual(userCache.hasData(), false);
        });

        test('getUserNames returns empty array initially', () => {
            const names = userCache.getUserNames();
            assert.strictEqual(names.length, 0);
        });

        test('getLastRefresh returns null initially', () => {
            assert.strictEqual(userCache.getLastRefresh(), null);
        });

        test('getStats returns zero count initially', () => {
            const stats = userCache.getStats();
            assert.strictEqual(stats.userCount, 0);
            assert.strictEqual(stats.lastRefresh, null);
        });
    });

    suite('User Operations (without data)', () => {
        test('getUser returns undefined for unknown user', () => {
            const user = userCache.getUser('dmadmin');
            assert.strictEqual(user, undefined);
        });

        test('searchUsers returns empty array', () => {
            const results = userCache.searchUsers('admin');
            assert.strictEqual(results.length, 0);
        });
    });

    suite('clear', () => {
        test('clear resets all data', () => {
            userCache.clear();
            assert.strictEqual(userCache.hasData(), false);
            assert.strictEqual(userCache.getLastRefresh(), null);
        });
    });

    suite('onRefresh callback', () => {
        test('callback is registered without error', () => {
            let called = false;
            userCache.onRefresh(() => {
                called = true;
            });
            assert.strictEqual(called, false);
        });

        test('multiple callbacks can be registered', () => {
            let count = 0;
            userCache.onRefresh(() => count++);
            userCache.onRefresh(() => count++);
            userCache.onRefresh(() => count++);
            assert.strictEqual(count, 0);
        });
    });
});

// Test suite with mocked data
suite('UserCache with Mock Data', () => {
    class TestableUserCache extends UserCache {
        public addMockUser(name: string, info: UserInfo): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).userMap.set(name.toLowerCase(), info);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).userNames.push(name);
        }

        public setLastRefresh(date: Date): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).lastRefresh = date;
        }
    }

    let userCache: TestableUserCache;

    setup(() => {
        userCache = new TestableUserCache(unusedBridge, 'session-1');

        // Add mock users
        userCache.addMockUser('dmadmin', {
            userName: 'dmadmin',
            userLoginName: 'dmadmin',
            userOsName: 'dmadmin',
            userAddress: '',
            userState: 0,
            userSource: '',
            defaultFolder: '/System',
            defaultGroup: 'docu',
            description: 'Administrator',
            attributes: []
        });

        userCache.addMockUser('testuser', {
            userName: 'testuser',
            userLoginName: 'testuser',
            userOsName: 'testuser',
            userAddress: '',
            userState: 0,
            userSource: 'inline password',
            defaultFolder: '/Temp',
            defaultGroup: 'dm_world',
            description: 'Test User',
            attributes: []
        });

        userCache.addMockUser('power_user', {
            userName: 'power_user',
            userLoginName: 'puser',
            userOsName: 'puser',
            userAddress: '',
            userState: 0,
            userSource: 'ldap',
            defaultFolder: '/Users/power_user',
            defaultGroup: 'power_users',
            description: 'Power User',
            attributes: []
        });

        userCache.setLastRefresh(new Date());
    });

    suite('hasData', () => {
        test('returns true when data is loaded', () => {
            assert.strictEqual(userCache.hasData(), true);
        });
    });

    suite('getUserNames', () => {
        test('returns all user names', () => {
            const names = userCache.getUserNames();
            assert.strictEqual(names.length, 3);
            assert.ok(names.includes('dmadmin'));
            assert.ok(names.includes('testuser'));
            assert.ok(names.includes('power_user'));
        });
    });

    suite('getUser', () => {
        test('returns user info for known user', () => {
            const user = userCache.getUser('dmadmin');
            assert.ok(user);
            assert.strictEqual(user.userName, 'dmadmin');
            assert.strictEqual(user.description, 'Administrator');
        });

        test('is case-insensitive', () => {
            const user1 = userCache.getUser('DMADMIN');
            const user2 = userCache.getUser('dmadmin');
            assert.deepStrictEqual(user1, user2);
        });

        test('returns undefined for unknown user', () => {
            const user = userCache.getUser('unknown_user');
            assert.strictEqual(user, undefined);
        });
    });

    suite('searchUsers', () => {
        test('finds users by pattern', () => {
            const results = userCache.searchUsers('user');
            assert.strictEqual(results.length, 2);
            assert.ok(results.includes('testuser'));
            assert.ok(results.includes('power_user'));
        });

        test('finds users with partial match', () => {
            const results = userCache.searchUsers('admin');
            assert.strictEqual(results.length, 1);
            assert.ok(results.includes('dmadmin'));
        });

        test('is case-insensitive', () => {
            const results1 = userCache.searchUsers('ADMIN');
            const results2 = userCache.searchUsers('admin');
            assert.deepStrictEqual(results1, results2);
        });

        test('returns sorted results', () => {
            const results = userCache.searchUsers('user');
            const sorted = [...results].sort();
            assert.deepStrictEqual(results, sorted);
        });

        test('returns empty for no matches', () => {
            const results = userCache.searchUsers('xyz123');
            assert.strictEqual(results.length, 0);
        });
    });

    suite('getStats', () => {
        test('returns correct user count', () => {
            const stats = userCache.getStats();
            assert.strictEqual(stats.userCount, 3);
        });

        test('returns last refresh date', () => {
            const stats = userCache.getStats();
            assert.ok(stats.lastRefresh instanceof Date);
        });
    });

    suite('clear', () => {
        test('removes all data', () => {
            userCache.clear();
            assert.strictEqual(userCache.hasData(), false);
            assert.strictEqual(userCache.getUserNames().length, 0);
            assert.strictEqual(userCache.getLastRefresh(), null);
        });
    });
});

suite('UserCache fetchUserDetails', () => {
    const bridgeUser = {
        objectId: '1100000180000101',
        userName: 'testuser',
        userOsName: 'testuser_os',
        userAddress: 'testuser@example.com',
        userState: '1',
        defaultFolder: '/testuser',
        userGroupName: 'docu',
        superUser: false,
        userLoginName: 'tuser',
        userSource: 'LDAP',
        description: 'Test User (updated)',
        attributes: [{ name: 'user_state', value: 1, dataType: 'integer' }]
    };

    let bridgeCalls: number;
    let sessionIds: string[];
    let userCache: UserCache;

    setup(() => {
        bridgeCalls = 0;
        sessionIds = [];
        const bridge = {
            getUser: async (sessionId: string) => {
                bridgeCalls++;
                sessionIds.push(sessionId);
                return bridgeUser;
            }
        };
        userCache = new UserCache(bridge as unknown as DctmBridge, 'session-1');

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (userCache as any).userMap.set('testuser', {
            userName: 'testuser',
            userLoginName: 'testuser',
            userOsName: 'testuser',
            userAddress: '',
            userState: 0,
            userSource: '',
            defaultFolder: '/testuser',
            defaultGroup: 'docu',
            description: 'Test User',
            attributes: [{ name: 'user_state', value: 0, dataType: 'integer' }]
        });
    });

    test('refresh fetches a cached user from the bridge and rebuilds it', async () => {
        const user = await userCache.fetchUserDetails('testuser', true);

        assert.deepStrictEqual(sessionIds, ['session-1']);
        assert.ok(user);
        assert.strictEqual(user.userState, 1);
        assert.strictEqual(user.userLoginName, 'tuser');
        assert.strictEqual(user.userSource, 'LDAP');
        assert.strictEqual(user.userOsName, 'testuser_os');
        assert.strictEqual(user.userAddress, 'testuser@example.com');
        assert.strictEqual(user.description, 'Test User (updated)');
        assert.deepStrictEqual(user.attributes, bridgeUser.attributes);
        assert.strictEqual(userCache.getUser('testuser'), user);
    });

    test('without refresh a cached user is returned without calling the bridge', async () => {
        const user = await userCache.fetchUserDetails('testuser');

        assert.strictEqual(bridgeCalls, 0);
        assert.ok(user);
        assert.strictEqual(user.userState, 0);
    });
});
