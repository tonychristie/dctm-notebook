import * as assert from 'assert';
import { buildGroupQuery, buildTypeQuery, buildUserQuery } from '../../dqlQueries';

suite('DQL Queries Test Suite', () => {
    suite('buildUserQuery', () => {
        test('queries dm_user by user name', () => {
            const dql = buildUserQuery('jsmith');

            assert.ok(dql.includes('FROM dm_user'));
            assert.ok(dql.includes("WHERE user_name = 'jsmith'"));
        });

        test('doubles single quotes in the name', () => {
            assert.ok(buildUserQuery("O'Brien").includes("WHERE user_name = 'O''Brien'"));
        });
    });

    suite('buildGroupQuery', () => {
        test('queries dm_group by group name', () => {
            const dql = buildGroupQuery('admins');

            assert.ok(dql.includes('FROM dm_group'));
            assert.ok(dql.includes("WHERE group_name = 'admins'"));
        });

        test('doubles single quotes in the name', () => {
            assert.ok(buildGroupQuery("O'Brien's team").includes("WHERE group_name = 'O''Brien''s team'"));
        });
    });

    suite('buildTypeQuery', () => {
        test('selects up to five own attributes from the type', () => {
            const dql = buildTypeQuery({
                name: 'my_doc',
                attributes: [
                    { name: 'object_name', isInherited: true },
                    { name: 'a1', isInherited: false },
                    { name: 'a2', isInherited: false },
                    { name: 'a3', isInherited: false },
                    { name: 'a4', isInherited: false },
                    { name: 'a5', isInherited: false },
                    { name: 'a6', isInherited: false }
                ]
            });

            assert.strictEqual(dql, 'SELECT a1, a2, a3, a4, a5\nFROM my_doc\nWHERE 1=1');
        });

        test('falls back to r_object_id and object_name when the type has no own attributes', () => {
            const dql = buildTypeQuery({ name: 'dm_document', attributes: [{ name: 'object_name', isInherited: true }] });

            assert.strictEqual(dql, 'SELECT r_object_id, object_name\nFROM dm_document\nWHERE 1=1');
        });
    });
});
