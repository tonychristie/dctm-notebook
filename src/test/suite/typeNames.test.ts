import * as assert from 'assert';
import { findTypeNames, isTypeContext } from '../../dql/typeNames';

const CACHED = new Set(['dm_document', 'dm_folder', 'my_custom_type', 'select']);
const isCached = (name: string) => CACHED.has(name.toLowerCase());

function typeNamesIn(text: string): string[] {
    const lines = text.split('\n');
    return findTypeNames(text, isCached).map(range => lines[range.line].substr(range.start, range.length));
}

function contextBefore(line: string, word: string, last = false): boolean {
    const position = last ? line.lastIndexOf(word) : line.indexOf(word);
    return isTypeContext(line.substring(0, position));
}

suite('DQL type name rule', () => {
    suite('findTypeNames', () => {
        test('finds a cached type after FROM, after a comma in the FROM list and after JOIN', () => {
            assert.deepStrictEqual(typeNamesIn('select * from dm_document, my_custom_type join dm_folder on 1=1'),
                ['dm_document', 'my_custom_type', 'dm_folder']);
        });

        test('finds a cached type after INTO, UPDATE and TYPE', () => {
            assert.deepStrictEqual(typeNamesIn('insert into dm_document\nupdate dm_folder\nalter type my_custom_type'),
                ['dm_document', 'dm_folder', 'my_custom_type']);
        });

        test('skips a cached type outside a type position', () => {
            assert.deepStrictEqual(typeNamesIn('select dm_folder from dm_document where dm_folder = 1'), ['dm_document']);
        });

        test('skips a vocabulary word even when the cache has it', () => {
            assert.deepStrictEqual(typeNamesIn('select * from select'), []);
        });

        test('skips a word the cache does not have', () => {
            assert.deepStrictEqual(typeNamesIn('select * from other_type'), []);
        });

        test('gives the line, start and length of each type name', () => {
            assert.deepStrictEqual(findTypeNames('select *\nfrom   Dm_Document', isCached), [{ line: 1, start: 7, length: 11 }]);
        });
    });

    suite('isTypeContext - a type position', () => {
        test('after FROM keyword', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document', 'dm_document'), true);
        });

        test('after FROM keyword with extra spaces', () => {
            assert.strictEqual(contextBefore('SELECT * FROM   dm_document', 'dm_document'), true);
        });

        test('after JOIN keyword', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document d JOIN dm_folder f ON d.i_folder_id = f.r_object_id', 'dm_folder'), true);
        });

        test('after LEFT JOIN keyword', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document LEFT JOIN dm_folder ON 1=1', 'dm_folder'), true);
        });

        test('after INNER JOIN keyword', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document INNER JOIN dm_folder ON 1=1', 'dm_folder'), true);
        });

        test('after INTO keyword', () => {
            assert.strictEqual(contextBefore('INSERT INTO dm_document (object_name) VALUES', 'dm_document'), true);
        });

        test('after UPDATE keyword', () => {
            assert.strictEqual(contextBefore('UPDATE dm_document SET object_name = \'test\'', 'dm_document'), true);
        });

        test('in type() function call', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_sysobject WHERE TYPE(dm_document)', 'dm_document', true), true);
        });

        test('after (ALL) subtype syntax', () => {
            assert.strictEqual(contextBefore('SELECT * FROM (ALL) dm_document', 'dm_document'), true);
        });

        test('after CREATE TYPE', () => {
            assert.strictEqual(contextBefore('CREATE TYPE my_custom_type', 'my_custom_type'), true);
        });

        test('after ALTER TYPE', () => {
            assert.strictEqual(contextBefore('ALTER TYPE my_custom_type', 'my_custom_type'), true);
        });

        test('after DROP TYPE', () => {
            assert.strictEqual(contextBefore('DROP TYPE my_custom_type', 'my_custom_type'), true);
        });

        test('after REGISTER AS', () => {
            assert.strictEqual(contextBefore('REGISTER AS my_custom_type', 'my_custom_type'), true);
        });

        test('after REGISTER TABLE', () => {
            assert.strictEqual(contextBefore('REGISTER TABLE my_custom_type', 'my_custom_type'), true);
        });

        test('comma-separated types in FROM clause', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document, dm_folder', 'dm_folder'), true);
        });

        test('case insensitive FROM', () => {
            assert.strictEqual(contextBefore('select * from dm_document', 'dm_document'), true);
        });

        test('case insensitive JOIN', () => {
            assert.strictEqual(contextBefore('select * from dm_document join dm_folder on 1=1', 'dm_folder'), true);
        });

        test('mixed case keywords', () => {
            assert.strictEqual(contextBefore('Select * From dm_document Where a = 1', 'dm_document'), true);
        });

        test('multiple spaces between keywords', () => {
            assert.strictEqual(contextBefore('SELECT   *   FROM   dm_document', 'dm_document'), true);
        });

        test('tabs instead of spaces', () => {
            assert.strictEqual(contextBefore('SELECT\t*\tFROM\tdm_document', 'dm_document'), true);
        });

        test('FROM at the start of the line', () => {
            assert.strictEqual(contextBefore('FROM dm_document', 'dm_document'), true);
        });
    });

    suite('isTypeContext - not a type position', () => {
        test('in SELECT clause (before FROM)', () => {
            assert.strictEqual(contextBefore('SELECT dm_document FROM dm_folder', 'dm_document'), false);
        });

        test('attribute name in SELECT clause', () => {
            assert.strictEqual(contextBefore('SELECT object_name, r_object_id FROM dm_document', 'object_name'), false);
        });

        test('after WHERE keyword', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document WHERE dm_folder = \'test\'', 'dm_folder', true), false);
        });

        test('after AND keyword', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document WHERE a = 1 AND dm_folder = 2', 'dm_folder', true), false);
        });

        test('after OR keyword', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document WHERE a = 1 OR dm_folder = 2', 'dm_folder', true), false);
        });

        test('random position without keyword context', () => {
            assert.strictEqual(isTypeContext(''), false);
        });

        test('in ORDER BY clause', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document ORDER BY dm_folder', 'dm_folder', true), false);
        });

        test('in GROUP BY clause', () => {
            assert.strictEqual(contextBefore('SELECT * FROM dm_document GROUP BY dm_folder', 'dm_folder', true), false);
        });
    });
});
