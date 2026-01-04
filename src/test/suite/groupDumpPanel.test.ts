import * as assert from 'assert';

/**
 * Tests for GroupDumpPanel helper functions
 *
 * Note: Full integration tests require a running VS Code instance and mock group cache.
 * These unit tests focus on the pure logic functions that can be tested in isolation.
 */
suite('GroupDumpPanel Test Suite', () => {

    suite('Attribute categorization', () => {
        type AttributeGroup = 'identity' | 'access' | 'members' | 'system' | 'other';

        function categorizeAttribute(name: string): AttributeGroup {
            // Identity-related
            if (['group_name', 'group_address', 'group_source', 'description',
                 'group_class', 'group_admin', 'owner_name', 'group_global_unique_id'].includes(name)) {
                return 'identity';
            }
            // Access-related
            if (['acl_domain', 'acl_name', 'alias_set_id', 'is_private',
                 'is_protected', 'is_dynamic', 'globally_managed'].includes(name)) {
                return 'access';
            }
            // Members (handled separately but categorized here)
            if (['users_names', 'groups_names'].includes(name)) {
                return 'members';
            }
            // System attributes (r_, i_)
            if (name.startsWith('r_') || name.startsWith('i_')) {
                return 'system';
            }
            return 'other';
        }

        test('categorizes identity attributes', () => {
            assert.strictEqual(categorizeAttribute('group_name'), 'identity');
            assert.strictEqual(categorizeAttribute('group_address'), 'identity');
            assert.strictEqual(categorizeAttribute('group_source'), 'identity');
            assert.strictEqual(categorizeAttribute('description'), 'identity');
            assert.strictEqual(categorizeAttribute('group_class'), 'identity');
            assert.strictEqual(categorizeAttribute('group_admin'), 'identity');
            assert.strictEqual(categorizeAttribute('owner_name'), 'identity');
            assert.strictEqual(categorizeAttribute('group_global_unique_id'), 'identity');
        });

        test('categorizes access attributes', () => {
            assert.strictEqual(categorizeAttribute('acl_domain'), 'access');
            assert.strictEqual(categorizeAttribute('acl_name'), 'access');
            assert.strictEqual(categorizeAttribute('alias_set_id'), 'access');
            assert.strictEqual(categorizeAttribute('is_private'), 'access');
            assert.strictEqual(categorizeAttribute('is_protected'), 'access');
            assert.strictEqual(categorizeAttribute('is_dynamic'), 'access');
            assert.strictEqual(categorizeAttribute('globally_managed'), 'access');
        });

        test('categorizes members attributes', () => {
            assert.strictEqual(categorizeAttribute('users_names'), 'members');
            assert.strictEqual(categorizeAttribute('groups_names'), 'members');
        });

        test('categorizes system attributes', () => {
            assert.strictEqual(categorizeAttribute('r_object_id'), 'system');
            assert.strictEqual(categorizeAttribute('r_modify_date'), 'system');
            assert.strictEqual(categorizeAttribute('i_vstamp'), 'system');
            assert.strictEqual(categorizeAttribute('i_is_replica'), 'system');
        });

        test('categorizes unknown attributes as other', () => {
            assert.strictEqual(categorizeAttribute('custom_attr'), 'other');
            assert.strictEqual(categorizeAttribute('some_field'), 'other');
        });
    });

    suite('Attribute filtering', () => {
        interface GroupAttribute {
            name: string;
            value: string | number | boolean | null;
        }

        function filterAttributes(
            attributes: GroupAttribute[],
            filter: string
        ): GroupAttribute[] {
            if (!filter) {
                return attributes;
            }

            const lowerFilter = filter.toLowerCase();
            return attributes.filter(a =>
                a.name.toLowerCase().includes(lowerFilter) ||
                (a.value !== null && String(a.value).toLowerCase().includes(lowerFilter))
            );
        }

        const testAttributes: GroupAttribute[] = [
            { name: 'group_name', value: 'docu' },
            { name: 'description', value: 'Documentum Users' },
            { name: 'group_class', value: 'group' },
            { name: 'owner_name', value: 'dm_dbo' },
            { name: 'is_private', value: false },
            { name: 'empty_attr', value: null },
        ];

        test('returns all attributes when no filter', () => {
            const result = filterAttributes(testAttributes, '');
            assert.strictEqual(result.length, 6);
        });

        test('filters by attribute name', () => {
            const result = filterAttributes(testAttributes, 'group_');
            assert.strictEqual(result.length, 2);
        });

        test('filters by attribute value', () => {
            const result = filterAttributes(testAttributes, 'docu');
            assert.strictEqual(result.length, 2); // group_name and description
        });

        test('filter is case insensitive', () => {
            const result = filterAttributes(testAttributes, 'DOCU');
            assert.strictEqual(result.length, 2);
        });

        test('handles boolean values', () => {
            const result = filterAttributes(testAttributes, 'false');
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'is_private');
        });

        test('returns empty array when no matches', () => {
            const result = filterAttributes(testAttributes, 'nonexistent');
            assert.strictEqual(result.length, 0);
        });
    });

    suite('HTML escaping for group panel', () => {
        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        test('escapes all special characters', () => {
            assert.strictEqual(
                escapeHtml('<script>alert("XSS")</script>'),
                '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
            );
        });

        test('preserves normal text', () => {
            assert.strictEqual(escapeHtml('docu'), 'docu');
            assert.strictEqual(escapeHtml('dm_world'), 'dm_world');
        });

        test('handles empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });

        test('escapes group names with special chars', () => {
            assert.strictEqual(escapeHtml("group_with_'quote"), "group_with_&#039;quote");
            assert.strictEqual(escapeHtml('group&name'), 'group&amp;name');
        });
    });

    suite('DQL query generation', () => {
        function generateDqlQuery(groupName: string): string {
            return `SELECT group_name, group_address, group_class, owner_name,
    description, users_names, groups_names, is_private, is_dynamic
FROM dm_group
WHERE group_name = '${groupName}'`;
        }

        test('generates query for group', () => {
            const query = generateDqlQuery('docu');
            assert.ok(query.includes('SELECT group_name'));
            assert.ok(query.includes('FROM dm_group'));
            assert.ok(query.includes("WHERE group_name = 'docu'"));
        });

        test('includes all expected attributes', () => {
            const query = generateDqlQuery('testgroup');
            assert.ok(query.includes('group_address'));
            assert.ok(query.includes('group_class'));
            assert.ok(query.includes('owner_name'));
            assert.ok(query.includes('users_names'));
            assert.ok(query.includes('groups_names'));
            assert.ok(query.includes('is_private'));
            assert.ok(query.includes('is_dynamic'));
        });
    });

    suite('Member count calculations', () => {
        interface GroupInfo {
            members: string[];
            groupMembers: string[];
        }

        function calculateMemberCounts(group: GroupInfo): {
            users: number;
            groups: number;
            total: number;
        } {
            return {
                users: group.members.length,
                groups: group.groupMembers.length,
                total: group.members.length + group.groupMembers.length
            };
        }

        test('counts users and groups correctly', () => {
            const group: GroupInfo = {
                members: ['user1', 'user2', 'user3'],
                groupMembers: ['subgroup1', 'subgroup2']
            };
            const counts = calculateMemberCounts(group);
            assert.strictEqual(counts.users, 3);
            assert.strictEqual(counts.groups, 2);
            assert.strictEqual(counts.total, 5);
        });

        test('handles empty members', () => {
            const group: GroupInfo = {
                members: [],
                groupMembers: []
            };
            const counts = calculateMemberCounts(group);
            assert.strictEqual(counts.users, 0);
            assert.strictEqual(counts.groups, 0);
            assert.strictEqual(counts.total, 0);
        });

        test('handles only users', () => {
            const group: GroupInfo = {
                members: ['user1', 'user2'],
                groupMembers: []
            };
            const counts = calculateMemberCounts(group);
            assert.strictEqual(counts.users, 2);
            assert.strictEqual(counts.groups, 0);
            assert.strictEqual(counts.total, 2);
        });

        test('handles only groups', () => {
            const group: GroupInfo = {
                members: [],
                groupMembers: ['subgroup1']
            };
            const counts = calculateMemberCounts(group);
            assert.strictEqual(counts.users, 0);
            assert.strictEqual(counts.groups, 1);
            assert.strictEqual(counts.total, 1);
        });
    });

    suite('Group badge display', () => {
        interface GroupInfo {
            isPrivate: boolean;
            isDynamic: boolean;
            groupClass: string;
        }

        function getBadges(group: GroupInfo): string[] {
            const badges: string[] = [];
            if (group.isPrivate) {
                badges.push('Private');
            }
            if (group.isDynamic) {
                badges.push('Dynamic');
            }
            badges.push(group.groupClass || 'group');
            return badges;
        }

        test('shows private badge when private', () => {
            const badges = getBadges({ isPrivate: true, isDynamic: false, groupClass: 'group' });
            assert.ok(badges.includes('Private'));
        });

        test('shows dynamic badge when dynamic', () => {
            const badges = getBadges({ isPrivate: false, isDynamic: true, groupClass: 'group' });
            assert.ok(badges.includes('Dynamic'));
        });

        test('shows both badges when private and dynamic', () => {
            const badges = getBadges({ isPrivate: true, isDynamic: true, groupClass: 'group' });
            assert.ok(badges.includes('Private'));
            assert.ok(badges.includes('Dynamic'));
        });

        test('always shows group class', () => {
            const badges = getBadges({ isPrivate: false, isDynamic: false, groupClass: 'group' });
            assert.ok(badges.includes('group'));
        });

        test('uses custom group class', () => {
            const badges = getBadges({ isPrivate: false, isDynamic: false, groupClass: 'role' });
            assert.ok(badges.includes('role'));
        });

        test('defaults to group if no class specified', () => {
            const badges = getBadges({ isPrivate: false, isDynamic: false, groupClass: '' });
            assert.ok(badges.includes('group'));
        });
    });

    suite('Attribute value rendering', () => {
        function renderAttributeValue(value: unknown): { display: string; isNull: boolean } {
            const valueStr = value === null || value === undefined
                ? 'null'
                : String(value);
            const isNull = value === null || value === undefined || valueStr === '';

            return {
                display: isNull ? '(empty)' : valueStr,
                isNull
            };
        }

        test('renders string value', () => {
            const result = renderAttributeValue('docu');
            assert.strictEqual(result.display, 'docu');
            assert.strictEqual(result.isNull, false);
        });

        test('renders number value', () => {
            const result = renderAttributeValue(42);
            assert.strictEqual(result.display, '42');
            assert.strictEqual(result.isNull, false);
        });

        test('renders boolean true value', () => {
            const result = renderAttributeValue(true);
            assert.strictEqual(result.display, 'true');
            assert.strictEqual(result.isNull, false);
        });

        test('renders boolean false value', () => {
            const result = renderAttributeValue(false);
            assert.strictEqual(result.display, 'false');
            assert.strictEqual(result.isNull, false);
        });

        test('renders null value', () => {
            const result = renderAttributeValue(null);
            assert.strictEqual(result.display, '(empty)');
            assert.strictEqual(result.isNull, true);
        });

        test('renders undefined value', () => {
            const result = renderAttributeValue(undefined);
            assert.strictEqual(result.display, '(empty)');
            assert.strictEqual(result.isNull, true);
        });

        test('renders empty string', () => {
            const result = renderAttributeValue('');
            assert.strictEqual(result.display, '(empty)');
            assert.strictEqual(result.isNull, true);
        });
    });

    suite('Attribute grouping (excluding members)', () => {
        type AttributeGroup = 'identity' | 'access' | 'members' | 'system' | 'other';

        interface GroupAttribute {
            name: string;
            value: unknown;
        }

        function categorizeAttribute(name: string): AttributeGroup {
            if (['group_name', 'description'].includes(name)) {
                return 'identity';
            }
            if (['acl_domain', 'is_private'].includes(name)) {
                return 'access';
            }
            if (['users_names', 'groups_names'].includes(name)) {
                return 'members';
            }
            if (name.startsWith('r_') || name.startsWith('i_')) {
                return 'system';
            }
            return 'other';
        }

        function groupAttributesExcludingMembers(attributes: GroupAttribute[]): Record<AttributeGroup, GroupAttribute[]> {
            const groups: Record<AttributeGroup, GroupAttribute[]> = {
                identity: [],
                access: [],
                members: [],
                system: [],
                other: []
            };

            for (const attr of attributes) {
                const group = categorizeAttribute(attr.name);
                // Members are shown separately, not in attribute groups
                if (group !== 'members') {
                    groups[group].push(attr);
                }
            }

            return groups;
        }

        test('groups attributes correctly', () => {
            const attrs: GroupAttribute[] = [
                { name: 'group_name', value: 'docu' },
                { name: 'acl_domain', value: 'test' },
                { name: 'users_names', value: 'user1' },
                { name: 'r_object_id', value: '123' },
                { name: 'custom_field', value: 'test' },
            ];

            const groups = groupAttributesExcludingMembers(attrs);

            assert.strictEqual(groups.identity.length, 1);
            assert.strictEqual(groups.access.length, 1);
            assert.strictEqual(groups.members.length, 0); // Excluded
            assert.strictEqual(groups.system.length, 1);
            assert.strictEqual(groups.other.length, 1);
        });

        test('excludes users_names and groups_names', () => {
            const attrs: GroupAttribute[] = [
                { name: 'users_names', value: 'user1' },
                { name: 'groups_names', value: 'subgroup1' },
            ];

            const groups = groupAttributesExcludingMembers(attrs);

            assert.strictEqual(groups.members.length, 0);
        });

        test('handles empty attributes', () => {
            const groups = groupAttributesExcludingMembers([]);

            assert.strictEqual(groups.identity.length, 0);
            assert.strictEqual(groups.access.length, 0);
            assert.strictEqual(groups.members.length, 0);
            assert.strictEqual(groups.system.length, 0);
            assert.strictEqual(groups.other.length, 0);
        });
    });

    suite('Parent groups display', () => {
        function hasParentGroups(parentGroups: string[]): boolean {
            return parentGroups.length > 0;
        }

        test('returns true when parent groups exist', () => {
            assert.strictEqual(hasParentGroups(['dm_world', 'docu']), true);
        });

        test('returns false when no parent groups', () => {
            assert.strictEqual(hasParentGroups([]), false);
        });

        test('returns true for single parent group', () => {
            assert.strictEqual(hasParentGroups(['dm_world']), true);
        });
    });
});
