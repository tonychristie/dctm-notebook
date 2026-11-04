import * as assert from 'assert';
import { GroupCache } from '../../groupCache';
import { DctmBridge } from '../../dctmBridge';
import { GroupDetails, GroupInfo as BridgeGroupInfo } from '../../bridgeTypes';

const listedGroup: BridgeGroupInfo = {
    objectId: '1200000180000101',
    groupName: 'docu',
    description: 'Documentum Users',
    groupClass: 'group',
    groupAdmin: 'dm_dbo',
    isPrivate: false,
    usersNames: ['dmadmin'],
    groupsNames: []
};

const detailedGroup: GroupDetails = {
    ...listedGroup,
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

suite('GroupCache Test Suite', () => {
    let getGroupCalls: string[];
    let bridgeError: Error | undefined;
    let groupCache: GroupCache;

    setup(async () => {
        getGroupCalls = [];
        bridgeError = undefined;
        const bridge = {
            getGroups: async () => [listedGroup],
            getGroup: async (sessionId: string, groupName: string) => {
                getGroupCalls.push(`${sessionId}:${groupName}`);
                if (bridgeError) {
                    throw bridgeError;
                }
                return detailedGroup;
            },
            getParentGroups: async () => {
                if (bridgeError) {
                    throw bridgeError;
                }
                return [{ groupName: 'dm_world' }, { groupName: 'admingroup' }];
            }
        };
        groupCache = new GroupCache(bridge as unknown as DctmBridge, 'session-1');
        await groupCache.refresh();
    });

    teardown(() => {
        groupCache.dispose();
    });

    test('refresh maps each bridge group to a group entry without attributes', () => {
        const group = groupCache.get('DOCU');

        assert.ok(group);
        assert.strictEqual(group.owner, '');
        assert.strictEqual(group.isDynamic, false);
        assert.deepStrictEqual(group.members, ['dmadmin']);
        assert.deepStrictEqual(group.attributes, []);
    });

    suite('fetchGroupDetails', () => {
        test('fetches a cached group from the bridge and stores the detailed entry', async () => {
            const group = await groupCache.fetchGroupDetails('docu');

            assert.deepStrictEqual(getGroupCalls, ['session-1:docu']);
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
            assert.deepStrictEqual(group.attributes, detailedGroup.attributes);
            assert.strictEqual(groupCache.get('docu'), group);
        });

        test('returns a detailed group without a bridge call unless refresh is set', async () => {
            await groupCache.fetchGroupDetails('docu');

            await groupCache.fetchGroupDetails('docu');
            assert.strictEqual(getGroupCalls.length, 1);

            await groupCache.fetchGroupDetails('docu', true);
            assert.strictEqual(getGroupCalls.length, 2);
        });

        test('rejects with the bridge error', async () => {
            bridgeError = new Error('401 Unauthorized');

            await assert.rejects(groupCache.fetchGroupDetails('docu'), /401 Unauthorized/);
        });
    });

    suite('getParentGroups', () => {
        test('returns the sorted group names', async () => {
            assert.deepStrictEqual(await groupCache.getParentGroups('docu'), ['admingroup', 'dm_world']);
        });

        test('rejects with the bridge error', async () => {
            bridgeError = new Error('timeout of 30000ms exceeded');

            await assert.rejects(groupCache.getParentGroups('docu'), /timeout/);
        });
    });
});
