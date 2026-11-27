import * as assert from 'assert';
import { EntityItem, EntityTreeNode, buildEntityTree, entityView, filterEntityNames } from '../../entityList';

const types: EntityItem[] = [
    { name: 'custom_doc', parent: 'DM_DOCUMENT' },
    { name: 'dm_document', parent: 'dm_sysobject' },
    { name: 'dm_folder', parent: 'dm_sysobject' },
    { name: 'dm_sysobject' },
    { name: 'dm_user' }
];

function names(nodes: EntityTreeNode[]): unknown[] {
    return nodes.map(node => node.children.length > 0 ? [node.name, names(node.children)] : node.name);
}

suite('Entity List Test Suite', () => {
    test('the tree puts each type under its supertype and types with no supertype at the root', () => {
        assert.deepStrictEqual(names(buildEntityTree(types)), [
            ['dm_sysobject', [['dm_document', ['custom_doc']], 'dm_folder']],
            'dm_user'
        ]);
    });

    test('a filter returns the names that contain the text, without case', () => {
        assert.deepStrictEqual(filterEntityNames(types, 'DOC'), ['custom_doc', 'dm_document']);
    });

    test('a filter on a hierarchical list returns a flat list with its count', () => {
        assert.deepStrictEqual(entityView(types, 'FOLD', true), { mode: 'list', names: ['dm_folder'], count: 1 });
    });

    test('an empty filter on a hierarchical list returns the tree, counting every item', () => {
        const view = entityView(types, '', true);

        assert.strictEqual(view.mode, 'tree');
        assert.strictEqual(view.count, 5);
        assert.deepStrictEqual(names(view.mode === 'tree' ? view.roots : []), names(buildEntityTree(types)));
    });

    test('an empty filter on a flat list returns every name', () => {
        const users: EntityItem[] = [{ name: 'admin' }, { name: 'jsmith' }];

        assert.deepStrictEqual(entityView(users, '', false), { mode: 'list', names: ['admin', 'jsmith'], count: 2 });
    });
});
