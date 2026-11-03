import * as assert from 'assert';
import {
    categorizeGroupAttribute,
    categorizeObjectAttribute,
    categorizeTypeAttribute,
    categorizeUserAttribute,
    describeAttributeValue,
    formatAttributeValue,
    formatTypeDisplay,
    groupGroupAttributes,
    groupObjectAttributes,
    groupTypeAttributes,
    groupUserAttributes,
    toObjectAttributeEntry
} from '../../attributeGroups';

function names(attrs: { name: string }[]): string[] {
    return attrs.map(a => a.name);
}

suite('Attribute Groups Test Suite', () => {
    suite('object attributes', () => {
        test('groups by prefix', () => {
            assert.strictEqual(categorizeObjectAttribute('r_object_id'), 'system');
            assert.strictEqual(categorizeObjectAttribute('i_chronicle_id'), 'internal');
            assert.strictEqual(categorizeObjectAttribute('a_content_type'), 'application');
            assert.strictEqual(categorizeObjectAttribute('object_name'), 'standard');
        });

        test('sorts attributes by name in every group', () => {
            const groups = groupObjectAttributes([
                { name: 'title' }, { name: 'r_object_type' }, { name: 'object_name' }, { name: 'r_creation_date' }
            ], undefined);

            assert.deepStrictEqual(names(groups.standard), ['object_name', 'title']);
            assert.deepStrictEqual(names(groups.system), ['r_creation_date', 'r_object_type']);
            assert.deepStrictEqual(groups.custom, []);
        });

        test('sends attributes without a prefix that the standard type lacks to the custom group', () => {
            const groups = groupObjectAttributes(
                [{ name: 'title' }, { name: 'odms_revision' }, { name: 'object_name' }, { name: 'odms_asset' }],
                new Set(['object_name', 'title'])
            );

            assert.deepStrictEqual(names(groups.standard), ['object_name', 'title']);
            assert.deepStrictEqual(names(groups.custom), ['odms_asset', 'odms_revision']);
        });

        test('keeps prefixed attributes in their prefix groups when the standard type lacks them', () => {
            const groups = groupObjectAttributes(
                [{ name: 'r_folder_path' }, { name: 'a_custom' }, { name: 'i_ancestor_id' }],
                new Set(['object_name'])
            );

            assert.deepStrictEqual(names(groups.system), ['r_folder_path']);
            assert.deepStrictEqual(names(groups.application), ['a_custom']);
            assert.deepStrictEqual(names(groups.internal), ['i_ancestor_id']);
            assert.deepStrictEqual(groups.custom, []);
        });
    });

    suite('type attributes', () => {
        test('sends own attributes to the custom group whatever their prefix', () => {
            assert.strictEqual(categorizeTypeAttribute({ name: 'r_my_attr', isInherited: false }), 'custom');
            assert.strictEqual(categorizeTypeAttribute({ name: 'my_attr', isInherited: false }), 'custom');
        });

        test('groups inherited attributes by prefix', () => {
            const groups = groupTypeAttributes([
                { name: 'r_object_id', isInherited: true },
                { name: 'i_vstamp', isInherited: true },
                { name: 'a_status', isInherited: true },
                { name: 'title', isInherited: true },
                { name: 'object_name', isInherited: true },
                { name: 'zeta', isInherited: false },
                { name: 'alpha', isInherited: false }
            ]);

            assert.deepStrictEqual(names(groups.custom), ['alpha', 'zeta']);
            assert.deepStrictEqual(names(groups.standard), ['object_name', 'title']);
            assert.deepStrictEqual(names(groups.system), ['r_object_id']);
            assert.deepStrictEqual(names(groups.internal), ['i_vstamp']);
            assert.deepStrictEqual(names(groups.application), ['a_status']);
        });
    });

    suite('user attributes', () => {
        test('puts the documented names in their groups', () => {
            assert.strictEqual(categorizeUserAttribute('user_login_name'), 'identity');
            assert.strictEqual(categorizeUserAttribute('user_privileges'), 'access');
            assert.strictEqual(categorizeUserAttribute('default_folder'), 'preferences');
        });

        test('sends r_ and i_ to system and everything else to other', () => {
            assert.strictEqual(categorizeUserAttribute('r_is_group'), 'system');
            assert.strictEqual(categorizeUserAttribute('i_is_replica'), 'system');
            assert.strictEqual(categorizeUserAttribute('a_something'), 'other');
            assert.strictEqual(categorizeUserAttribute('description'), 'other');
        });

        test('sorts attributes by name in every group', () => {
            const groups = groupUserAttributes([
                { name: 'user_os_name' }, { name: 'user_address' }, { name: 'r_object_id' }
            ]);

            assert.deepStrictEqual(names(groups.identity), ['user_address', 'user_os_name']);
            assert.deepStrictEqual(names(groups.system), ['r_object_id']);
        });
    });

    suite('group attributes', () => {
        test('puts the documented names in their groups', () => {
            assert.strictEqual(categorizeGroupAttribute('group_class'), 'identity');
            assert.strictEqual(categorizeGroupAttribute('is_private'), 'access');
            assert.strictEqual(categorizeGroupAttribute('users_names'), 'members');
            assert.strictEqual(categorizeGroupAttribute('i_vstamp'), 'system');
            assert.strictEqual(categorizeGroupAttribute('a_something'), 'other');
        });

        test('leaves out member attributes and sorts every group by name', () => {
            const groups = groupGroupAttributes([
                { name: 'users_names' }, { name: 'groups_names' }, { name: 'group_name' }, { name: 'description' }
            ]);

            assert.deepStrictEqual(groups.members, []);
            assert.deepStrictEqual(names(groups.identity), ['description', 'group_name']);
        });
    });

    suite('toObjectAttributeEntry', () => {
        test('reads type, value and repeating flag from a typed entry', () => {
            assert.deepStrictEqual(
                toObjectAttributeEntry('keywords', { type: 'string', value: ['a', 'b'], repeating: true }),
                { name: 'keywords', type: 'string', value: ['a', 'b'], isRepeating: true }
            );
        });

        test('treats a plain string as an untyped single value', () => {
            assert.deepStrictEqual(
                toObjectAttributeEntry('object_name', 'report'),
                { name: 'object_name', type: '', value: 'report', isRepeating: false }
            );
        });

        test('treats a plain array as an untyped repeating value', () => {
            assert.deepStrictEqual(
                toObjectAttributeEntry('r_version_label', ['1.0', 'CURRENT']),
                { name: 'r_version_label', type: '', value: ['1.0', 'CURRENT'], isRepeating: true }
            );
        });

        test('treats a plain null as an untyped single value', () => {
            assert.deepStrictEqual(
                toObjectAttributeEntry('title', null),
                { name: 'title', type: '', value: null, isRepeating: false }
            );
        });
    });

    suite('formatAttributeValue', () => {
        test('returns NULL for null and undefined', () => {
            assert.strictEqual(formatAttributeValue(null, false), 'NULL');
            assert.strictEqual(formatAttributeValue(undefined, true), 'NULL');
        });

        test('joins repeating values, showing null entries as NULL', () => {
            assert.strictEqual(formatAttributeValue(['a', null, 'c'], true), 'a, NULL, c');
        });

        test('returns the string form of a single value', () => {
            assert.strictEqual(formatAttributeValue(42, false), '42');
        });
    });

    suite('describeAttributeValue', () => {
        test('marks null, undefined and empty values as empty', () => {
            assert.deepStrictEqual(describeAttributeValue(null), { text: 'null', isEmpty: true, isObjectId: false });
            assert.deepStrictEqual(describeAttributeValue(undefined), { text: 'null', isEmpty: true, isObjectId: false });
            assert.deepStrictEqual(describeAttributeValue(''), { text: '', isEmpty: true, isObjectId: false });
        });

        test('marks 16-hex values as object IDs', () => {
            assert.deepStrictEqual(
                describeAttributeValue('0900000180001234'),
                { text: '0900000180001234', isEmpty: false, isObjectId: true }
            );
        });

        test('marks other values as plain', () => {
            assert.deepStrictEqual(describeAttributeValue(0), { text: '0', isEmpty: false, isObjectId: false });
        });
    });

    suite('formatTypeDisplay', () => {
        test('includes the length only when it is above zero', () => {
            assert.strictEqual(formatTypeDisplay({ dataType: 'string', length: 32 }), 'string(32)');
            assert.strictEqual(formatTypeDisplay({ dataType: 'integer', length: 0 }), 'integer');
        });
    });
});
