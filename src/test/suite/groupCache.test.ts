import * as assert from 'assert';
import { GroupCache, GroupInfo } from '../../groupCache';

// Mock ConnectionManager for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConnectionManager: any = {
    getActiveConnection: () => null,
    getDctmBridge: () => null,
    onConnectionChange: () => {}
};

suite('GroupCache Test Suite', () => {
    let groupCache: GroupCache;

    setup(() => {
        groupCache = new GroupCache(mockConnectionManager);
    });

    suite('Initial State', () => {
        test('hasData returns false initially', () => {
            assert.strictEqual(groupCache.hasData(), false);
        });

        test('getGroupNames returns empty array initially', () => {
            const names = groupCache.getGroupNames();
            assert.strictEqual(names.length, 0);
        });

        test('getLastRefresh returns null initially', () => {
            assert.strictEqual(groupCache.getLastRefresh(), null);
        });

        test('getStats returns zero count initially', () => {
            const stats = groupCache.getStats();
            assert.strictEqual(stats.groupCount, 0);
            assert.strictEqual(stats.lastRefresh, null);
        });
    });

    suite('Group Operations (without data)', () => {
        test('getGroup returns undefined for unknown group', () => {
            const group = groupCache.getGroup('docu');
            assert.strictEqual(group, undefined);
        });

        test('searchGroups returns empty array', () => {
            const results = groupCache.searchGroups('admin');
            assert.strictEqual(results.length, 0);
        });
    });

    suite('clear', () => {
        test('clear resets all data', () => {
            groupCache.clear();
            assert.strictEqual(groupCache.hasData(), false);
            assert.strictEqual(groupCache.getLastRefresh(), null);
        });
    });

    suite('onRefresh callback', () => {
        test('callback is registered without error', () => {
            let called = false;
            groupCache.onRefresh(() => {
                called = true;
            });
            assert.strictEqual(called, false);
        });

        test('multiple callbacks can be registered', () => {
            let count = 0;
            groupCache.onRefresh(() => count++);
            groupCache.onRefresh(() => count++);
            groupCache.onRefresh(() => count++);
            assert.strictEqual(count, 0);
        });
    });

    suite('refresh error handling', () => {
        test('refresh throws error without connection', async () => {
            try {
                await groupCache.refresh();
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok((error as Error).message.includes('No active connection'));
            }
        });
    });

    suite('fetchGroupDetails error handling', () => {
        test('fetchGroupDetails returns undefined without connection', async () => {
            const result = await groupCache.fetchGroupDetails('docu');
            assert.strictEqual(result, undefined);
        });
    });

    suite('getParentGroups error handling', () => {
        test('getParentGroups returns empty array without connection', async () => {
            const result = await groupCache.getParentGroups('docu');
            assert.strictEqual(result.length, 0);
        });
    });
});

// Test suite with mocked data
suite('GroupCache with Mock Data', () => {
    class TestableGroupCache extends GroupCache {
        public addMockGroup(name: string, info: GroupInfo): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).groupMap.set(name.toLowerCase(), info);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).groupNames.push(name);
        }

        public setLastRefresh(date: Date): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).lastRefresh = date;
        }
    }

    let groupCache: TestableGroupCache;

    setup(() => {
        groupCache = new TestableGroupCache(mockConnectionManager);

        // Add mock groups
        groupCache.addMockGroup('docu', {
            groupName: 'docu',
            groupAddress: '',
            groupSource: '',
            description: 'Documentum Users',
            groupClass: 'group',
            groupAdmin: 'dm_dbo',
            owner: 'dm_dbo',
            isPrivate: false,
            isDynamic: false,
            aliasSetId: '',
            acl: 'dm_45000000000001',
            members: ['dmadmin', 'testuser'],
            groupMembers: ['power_users'],
            attributes: []
        });

        groupCache.addMockGroup('dm_world', {
            groupName: 'dm_world',
            groupAddress: '',
            groupSource: '',
            description: 'World Group',
            groupClass: 'group',
            groupAdmin: 'dm_dbo',
            owner: 'dm_dbo',
            isPrivate: false,
            isDynamic: false,
            aliasSetId: '',
            acl: 'dm_45000000000002',
            members: [],
            groupMembers: [],
            attributes: []
        });

        groupCache.addMockGroup('power_users', {
            groupName: 'power_users',
            groupAddress: '',
            groupSource: '',
            description: 'Power Users Group',
            groupClass: 'group',
            groupAdmin: 'dm_dbo',
            owner: 'dmadmin',
            isPrivate: true,
            isDynamic: false,
            aliasSetId: '',
            acl: 'dm_45000000000003',
            members: ['power_user'],
            groupMembers: [],
            attributes: []
        });

        groupCache.addMockGroup('dynamic_group', {
            groupName: 'dynamic_group',
            groupAddress: '',
            groupSource: '',
            description: 'Dynamic Group',
            groupClass: 'group',
            groupAdmin: 'dm_dbo',
            owner: 'dmadmin',
            isPrivate: false,
            isDynamic: true,
            aliasSetId: '',
            acl: 'dm_45000000000004',
            members: [],
            groupMembers: [],
            attributes: []
        });

        groupCache.setLastRefresh(new Date());
    });

    suite('hasData', () => {
        test('returns true when data is loaded', () => {
            assert.strictEqual(groupCache.hasData(), true);
        });
    });

    suite('getGroupNames', () => {
        test('returns all group names', () => {
            const names = groupCache.getGroupNames();
            assert.strictEqual(names.length, 4);
            assert.ok(names.includes('docu'));
            assert.ok(names.includes('dm_world'));
            assert.ok(names.includes('power_users'));
            assert.ok(names.includes('dynamic_group'));
        });
    });

    suite('getGroup', () => {
        test('returns group info for known group', () => {
            const group = groupCache.getGroup('docu');
            assert.ok(group);
            assert.strictEqual(group.groupName, 'docu');
            assert.strictEqual(group.description, 'Documentum Users');
        });

        test('is case-insensitive', () => {
            const group1 = groupCache.getGroup('DOCU');
            const group2 = groupCache.getGroup('docu');
            assert.deepStrictEqual(group1, group2);
        });

        test('returns undefined for unknown group', () => {
            const group = groupCache.getGroup('unknown_group');
            assert.strictEqual(group, undefined);
        });

        test('returns group with members', () => {
            const group = groupCache.getGroup('docu');
            assert.ok(group);
            assert.strictEqual(group.members.length, 2);
            assert.ok(group.members.includes('dmadmin'));
            assert.ok(group.members.includes('testuser'));
        });

        test('returns group with nested groups', () => {
            const group = groupCache.getGroup('docu');
            assert.ok(group);
            assert.strictEqual(group.groupMembers.length, 1);
            assert.ok(group.groupMembers.includes('power_users'));
        });

        test('returns private group flag', () => {
            const privateGroup = groupCache.getGroup('power_users');
            const publicGroup = groupCache.getGroup('dm_world');
            assert.ok(privateGroup);
            assert.ok(publicGroup);
            assert.strictEqual(privateGroup.isPrivate, true);
            assert.strictEqual(publicGroup.isPrivate, false);
        });

        test('returns dynamic group flag', () => {
            const dynamicGroup = groupCache.getGroup('dynamic_group');
            const staticGroup = groupCache.getGroup('docu');
            assert.ok(dynamicGroup);
            assert.ok(staticGroup);
            assert.strictEqual(dynamicGroup.isDynamic, true);
            assert.strictEqual(staticGroup.isDynamic, false);
        });
    });

    suite('searchGroups', () => {
        test('finds groups by pattern', () => {
            const results = groupCache.searchGroups('dm_');
            assert.strictEqual(results.length, 1);
            assert.ok(results.includes('dm_world'));
        });

        test('finds groups with partial match', () => {
            const results = groupCache.searchGroups('group');
            assert.strictEqual(results.length, 1);
            assert.ok(results.includes('dynamic_group'));
        });

        test('is case-insensitive', () => {
            const results1 = groupCache.searchGroups('DOCU');
            const results2 = groupCache.searchGroups('docu');
            assert.deepStrictEqual(results1, results2);
        });

        test('returns sorted results', () => {
            const results = groupCache.searchGroups('');
            const sorted = [...results].sort();
            assert.deepStrictEqual(results, sorted);
        });

        test('returns empty for no matches', () => {
            const results = groupCache.searchGroups('xyz123');
            assert.strictEqual(results.length, 0);
        });
    });

    suite('getStats', () => {
        test('returns correct group count', () => {
            const stats = groupCache.getStats();
            assert.strictEqual(stats.groupCount, 4);
        });

        test('returns last refresh date', () => {
            const stats = groupCache.getStats();
            assert.ok(stats.lastRefresh instanceof Date);
        });
    });

    suite('clear', () => {
        test('removes all data', () => {
            groupCache.clear();
            assert.strictEqual(groupCache.hasData(), false);
            assert.strictEqual(groupCache.getGroupNames().length, 0);
            assert.strictEqual(groupCache.getLastRefresh(), null);
        });
    });
});

suite('GroupCache fetchGroupDetails', () => {
    const bridgeGroup = {
        objectId: '1200000180000101',
        groupName: 'docu',
        description: 'Documentum Users (updated)',
        groupClass: 'qa_refresh',
        groupAdmin: 'dmadmin',
        isPrivate: true,
        usersNames: ['zuser', 'auser'],
        groupsNames: ['power_users'],
        groupAddress: 'docu@example.com',
        groupSource: 'LDAP',
        ownerName: 'dmadmin',
        isDynamic: true,
        attributes: [{ name: 'group_class', value: 'qa_refresh', dataType: 'string' }]
    };

    let bridgeCalls: number;
    let groupCache: GroupCache;

    setup(() => {
        bridgeCalls = 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const connectionManager: any = {
            getActiveConnection: () => ({ sessionId: 'session-1' }),
            getDctmBridge: () => ({
                getGroup: async () => {
                    bridgeCalls++;
                    return bridgeGroup;
                }
            }),
            onConnectionChange: () => {}
        };
        groupCache = new GroupCache(connectionManager);
    });

    function cacheGroupWithAttributes(): void {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (groupCache as any).groupMap.set('docu', {
            groupName: 'docu',
            groupAddress: '',
            groupSource: '',
            description: 'Documentum Users',
            groupClass: 'group',
            groupAdmin: 'dm_dbo',
            owner: 'dm_dbo',
            isPrivate: false,
            isDynamic: false,
            aliasSetId: '',
            acl: '',
            members: ['dmadmin'],
            groupMembers: [],
            attributes: [{ name: 'group_class', value: 'group', dataType: 'string' }]
        });
    }

    test('refresh fetches a cached group from the bridge and rebuilds it', async () => {
        cacheGroupWithAttributes();

        const group = await groupCache.fetchGroupDetails('docu', true);

        assert.strictEqual(bridgeCalls, 1);
        assert.ok(group);
        assert.strictEqual(group.groupClass, 'qa_refresh');
        assert.strictEqual(group.description, 'Documentum Users (updated)');
        assert.strictEqual(group.groupAdmin, 'dmadmin');
        assert.strictEqual(group.owner, 'dmadmin');
        assert.strictEqual(group.isPrivate, true);
        assert.strictEqual(group.isDynamic, true);
        assert.strictEqual(group.groupAddress, 'docu@example.com');
        assert.strictEqual(group.groupSource, 'LDAP');
        assert.deepStrictEqual(group.members, ['auser', 'zuser']);
        assert.deepStrictEqual(group.groupMembers, ['power_users']);
        assert.deepStrictEqual(group.attributes, bridgeGroup.attributes);
        assert.strictEqual(groupCache.getGroup('docu'), group);
    });

    test('without refresh a cached group is returned without calling the bridge', async () => {
        cacheGroupWithAttributes();

        const group = await groupCache.fetchGroupDetails('docu');

        assert.strictEqual(bridgeCalls, 0);
        assert.ok(group);
        assert.strictEqual(group.groupClass, 'group');
    });

    test('a group not in the cache is built from the bridge response', async () => {
        const group = await groupCache.fetchGroupDetails('docu');

        assert.strictEqual(bridgeCalls, 1);
        assert.ok(group);
        assert.strictEqual(group.isDynamic, true);
        assert.strictEqual(group.owner, 'dmadmin');
        assert.strictEqual(group.groupAddress, 'docu@example.com');
        assert.strictEqual(group.groupSource, 'LDAP');
    });
});
