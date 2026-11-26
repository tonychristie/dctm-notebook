import * as assert from 'assert';
import { completeDql, DqlCompletionItem, DqlSchema } from '../../dql/completion';
import { typeCacheSchema } from '../../dql/typeCacheSchema';
import { DQL_SERVER_FUNCTIONS } from '../../dql/vocabulary';

const ATTRIBUTES: Record<string, string[]> = {
    dm_document: ['object_name', 'owner_name', 'r_object_id'],
    my_custom_type: ['custom_code', 'object_name'],
    dm_folder: ['r_folder_path']
};

const schema: DqlSchema = {
    typeNames: () => ['dm_document', 'dm_folder', 'My_Custom_Type'],
    attributes: async typeName => ATTRIBUTES[typeName.toLowerCase()] ?? []
};

// The cursor is at the | in the text.
async function complete(textWithCursor: string, withSchema: DqlSchema | null = schema) {
    const offset = textWithCursor.indexOf('|');
    return completeDql(textWithCursor.replace('|', ''), offset, withSchema ?? undefined);
}

function labelsOf(items: DqlCompletionItem[], kind: DqlCompletionItem['kind']): string[] {
    return items.filter(item => item.kind === kind).map(item => item.label);
}

suite('DQL completion rules', () => {
    test('offers the type names in a type position', async () => {
        const result = await complete('select * from |');

        assert.deepStrictEqual(result?.items.map(item => [item.label, item.kind]),
            [['dm_document', 'type'], ['dm_folder', 'type'], ['My_Custom_Type', 'type']]);
    });

    test('matches the word as a prefix without case and replaces it', async () => {
        const result = await complete('select * from MY_c|');

        assert.deepStrictEqual(result?.items.map(item => item.insertText), ['My_Custom_Type']);
        assert.deepStrictEqual([result?.from, result?.to], [14, 18]);
    });

    test('offers the attributes of the aliased type after alias.', async () => {
        const result = await complete('select * from my_custom_type d where d.|');

        assert.deepStrictEqual(result?.items.map(item => [item.label, item.kind]),
            [['custom_code', 'attribute'], ['object_name', 'attribute']]);
    });

    test('offers the attributes of a type named before the dot', async () => {
        const result = await complete('select dm_folder.r| from dm_folder');

        assert.deepStrictEqual(labelsOf(result!.items, 'attribute'), ['r_folder_path']);
    });

    test('offers keywords, functions and the attributes of the FROM types in a select list', async () => {
        const result = await complete('select | from dm_document, dm_folder');

        assert.deepStrictEqual(labelsOf(result!.items, 'attribute'), ['object_name', 'owner_name', 'r_object_id', 'r_folder_path']);
        assert.ok(labelsOf(result!.items, 'keyword').includes('WHERE'));
        assert.ok(labelsOf(result!.items, 'function').includes('COUNT'));
    });

    test('obj in a select list on dm_document offers object_name as an attribute and no function', async () => {
        const result = await complete('select obj| from dm_document');

        assert.deepStrictEqual(labelsOf(result!.items, 'attribute'), ['object_name']);
        assert.deepStrictEqual(labelsOf(result!.items, 'function'), []);
    });

    test('offers only the DQL server functions as functions, inserted with (', async () => {
        const result = await complete('select |');
        const functions = result!.items.filter(item => item.kind === 'function');

        assert.deepStrictEqual(functions.map(item => item.label.toLowerCase()).sort(), [...DQL_SERVER_FUNCTIONS].sort());
        assert.ok(functions.every(item => item.insertText === `${item.label}(`));
    });

    test('inserts keywords, constants and functions in upper case', async () => {
        const result = await complete('select * from dm_document where object_name is nu|');

        assert.deepStrictEqual(result?.items.map(item => item.insertText), ['NULL', 'NULLDATE', 'NULLSTRING', 'NULLINT', 'NULLID']);
        assert.deepStrictEqual(labelsOf((await complete('select cou|'))!.items, 'function'), ['COUNT']);
        assert.ok(labelsOf((await complete('sel|'))!.items, 'keyword').includes('SELECT'));
    });

    test('offers nothing inside a string or a comment', async () => {
        assert.strictEqual(await complete('select * from dm_document where object_name = \'ab|'), undefined);
        assert.strictEqual(await complete('select * from dm_document where object_name = "ab|"'), undefined);
        assert.strictEqual(await complete('select * -- from |'), undefined);
        assert.strictEqual(await complete('select /* from | */ x'), undefined);
    });

    test('offers completion after a closed string', async () => {
        const result = await complete('select * from dm_document where object_name = \'a\' an|');

        assert.deepStrictEqual(labelsOf(result!.items, 'keyword'), ['AND', 'ANY']);
    });

    test('a blank line ends the statement, so another query\'s FROM type adds no attributes', async () => {
        const result = await complete('select * from my_custom_type\n\nselect obj|');

        assert.deepStrictEqual(labelsOf(result!.items, 'attribute'), []);
    });

    test('a ; ends the statement on each side', async () => {
        const before = await complete('select * from dm_folder; select obj| from dm_document');
        const after = await complete('select r_fol| from dm_document; select * from dm_folder');

        assert.deepStrictEqual(labelsOf(before!.items, 'attribute'), ['object_name']);
        assert.deepStrictEqual(labelsOf(after!.items, 'attribute'), []);
    });

    test('a type in a JOIN adds its attributes', async () => {
        const result = await complete('select r_| from dm_document d join dm_folder f on d.r_object_id = f.r_object_id');

        assert.deepStrictEqual(labelsOf(result!.items, 'attribute'), ['r_object_id', 'r_folder_path']);
    });

    test('a word that ends in type is not a type position', async () => {
        const result = await complete('select r_object_type fr|');
        const afterAttribute = await complete('select title from dm_document where a_content_type |');

        assert.deepStrictEqual(labelsOf(result!.items, 'keyword'), ['FROM', 'FREEZE']);
        assert.deepStrictEqual(labelsOf(result!.items, 'type'), []);
        assert.deepStrictEqual(labelsOf(afterAttribute!.items, 'type'), []);
        assert.ok(labelsOf(afterAttribute!.items, 'keyword').includes('LIKE'));
    });

    test('a comma in an ORDER BY or GROUP BY list offers attributes, not types', async () => {
        const orderBy = await complete('select object_name from dm_document order by object_name, r_|');
        const afterWhere = await complete('select object_name from dm_document where title is null order by r_object_id, ow|');
        const groupBy = await complete('select count(*) from dm_document group by owner_name, obj|');

        assert.deepStrictEqual(labelsOf(orderBy!.items, 'attribute'), ['r_object_id']);
        assert.deepStrictEqual(labelsOf(orderBy!.items, 'type'), []);
        assert.deepStrictEqual(labelsOf(afterWhere!.items, 'attribute'), ['owner_name']);
        assert.deepStrictEqual(labelsOf(groupBy!.items, 'attribute'), ['object_name']);
    });

    test('a comma in the FROM list offers types', async () => {
        const result = await complete('select * from dm_document d, dm_f|');

        assert.deepStrictEqual(result?.items.map(item => item.label), ['dm_folder']);
    });

    test('with no schema offers the vocabulary only', async () => {
        const inSelect = await complete('select obj| from dm_document', null);
        const inFrom = await complete('select * from dm_|', null);

        assert.deepStrictEqual(labelsOf(inSelect!.items, 'attribute'), []);
        assert.deepStrictEqual(labelsOf(inSelect!.items, 'keyword'), ['OBJECT', 'OBJECTS']);
        assert.deepStrictEqual(inFrom?.items, []);
    });

    test('a typeCacheSchema whose attribute lookup fails still offers the keywords and functions', async () => {
        const failing = typeCacheSchema({
            getNames: () => ['dm_document'],
            fetchTypeDetails: async () => {
                throw new Error('session expired');
            }
        });

        const result = await complete('select | from dm_document', failing);

        assert.deepStrictEqual(labelsOf(result!.items, 'attribute'), []);
        assert.ok(labelsOf(result!.items, 'keyword').includes('WHERE'));
        assert.ok(labelsOf(result!.items, 'function').includes('COUNT'));
    });
});
