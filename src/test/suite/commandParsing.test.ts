import * as assert from 'assert';
import {
    formatValue,
    getOutputFormat,
    nextOutputFormat,
    parseApiCommand,
    parseDmApiCommand,
    stripComments
} from '../../notebook/commandParsing';

suite('Command Parsing Test Suite', () => {
    suite('stripComments', () => {
        test('removes line comments', () => {
            assert.strictEqual(
                stripComments('-- header\nSELECT * FROM dm_document -- trailing\nWHERE 1=1'),
                'SELECT * FROM dm_document\nWHERE 1=1'
            );
        });

        test('removes block comments when asked', () => {
            assert.strictEqual(
                stripComments('/* one\ntwo */SELECT r_object_id /* inline */ FROM dm_document', true),
                'SELECT r_object_id  FROM dm_document'
            );
        });

        test('keeps block comments by default', () => {
            assert.strictEqual(stripComments('/* keep */ getservermap'), '/* keep */ getservermap');
        });

        test('drops blank lines', () => {
            assert.strictEqual(stripComments('\n  a  \n\n   \nb\n'), 'a\nb');
        });

        test('returns an empty string for comment-only input', () => {
            assert.strictEqual(stripComments('-- one\n/* two */', true), '');
        });

        test('keeps -- inside a single-quoted string and removes the line comment after it', () => {
            assert.strictEqual(
                stripComments("select r_object_id from dm_document where object_name like '%--%' -- find them"),
                "select r_object_id from dm_document where object_name like '%--%'"
            );
        });

        test('keeps a block comment inside a single-quoted string when block comments are removed', () => {
            assert.strictEqual(
                stripComments("select * from dm_document where object_name = 'a /* b */ c' /* note */", true),
                "select * from dm_document where object_name = 'a /* b */ c'"
            );
        });

        test('keeps -- inside a double-quoted string that holds a single-quoted part', () => {
            const command = `dmAPIGet("query,c,select r_object_id from dm_document where object_name like '%--%'")`;
            assert.strictEqual(stripComments(`-- run the query\n${command}`), command);
        });

        test('keeps a doubled quote inside a string whole', () => {
            assert.strictEqual(
                stripComments("select * from dm_document where object_name = 'it''s -- here'"),
                "select * from dm_document where object_name = 'it''s -- here'"
            );
        });

        test('an apostrophe inside a line comment does not open a string', () => {
            assert.strictEqual(stripComments("-- don't run this\nselect 1 -- trailing"), 'select 1');
        });

        test('leaves a block comment with no closing marker in the text', () => {
            assert.strictEqual(
                stripComments('select 1 /* not closed', true),
                'select 1 /* not closed'
            );
        });
    });

    suite('parseDmApiCommand', () => {
        test('recognises dmAPIGet, dmAPIExec and dmAPISet', () => {
            assert.deepStrictEqual(parseDmApiCommand('dmAPIGet("getservermap,session")'), { callType: 'get', args: 'getservermap,session' });
            assert.deepStrictEqual(parseDmApiCommand('dmAPIExec("save,c,0900000180001234")'), { callType: 'exec', args: 'save,c,0900000180001234' });
            assert.deepStrictEqual(parseDmApiCommand('dmAPISet("set,c,l,object_name")'), { callType: 'set', args: 'set,c,l,object_name' });
        });

        test('matches in any case', () => {
            assert.deepStrictEqual(parseDmApiCommand('DMAPIGET("getservermap,session")'), { callType: 'get', args: 'getservermap,session' });
            assert.deepStrictEqual(parseDmApiCommand('dmapiexec("save,c,l")'), { callType: 'exec', args: 'save,c,l' });
        });

        test('accepts single quotes and spaces inside the brackets', () => {
            assert.deepStrictEqual(parseDmApiCommand("dmAPIGet( 'getservermap,session' )"), { callType: 'get', args: 'getservermap,session' });
            assert.deepStrictEqual(parseDmApiCommand('dmAPIGet ("getservermap,session")'), { callType: 'get', args: 'getservermap,session' });
        });

        test('returns null for anything else', () => {
            assert.strictEqual(parseDmApiCommand('getString object_name'), null);
            assert.strictEqual(parseDmApiCommand('dmAPIGet(getservermap)'), null);
            assert.strictEqual(parseDmApiCommand('dmAPIFetch("x")'), null);
            assert.strictEqual(parseDmApiCommand(''), null);
        });
    });

    suite('parseApiCommand', () => {
        test('splits the method name from its arguments', () => {
            assert.deepStrictEqual(parseApiCommand('  getString   object_name  '), { method: 'getString', args: ['object_name'] });
        });

        test('returns no arguments for a bare method', () => {
            assert.deepStrictEqual(parseApiCommand('getSessionId'), { method: 'getSessionId', args: [] });
        });
    });

    suite('output format', () => {
        test('getOutputFormat returns html when the metadata or the setting is missing', () => {
            assert.strictEqual(getOutputFormat(undefined), 'html');
            assert.strictEqual(getOutputFormat({}), 'html');
        });

        test('getOutputFormat returns the stored format', () => {
            assert.strictEqual(getOutputFormat({ outputFormat: 'json' }), 'json');
            assert.strictEqual(getOutputFormat({ outputFormat: 'html' }), 'html');
        });

        test('nextOutputFormat switches between html and json', () => {
            assert.strictEqual(nextOutputFormat('html'), 'json');
            assert.strictEqual(nextOutputFormat('json'), 'html');
        });
    });

    suite('formatValue', () => {
        test('returns null for null and undefined', () => {
            assert.strictEqual(formatValue(null), 'null');
            assert.strictEqual(formatValue(undefined), 'null');
        });

        test('returns indented JSON for objects', () => {
            assert.strictEqual(formatValue({ a: [1] }), JSON.stringify({ a: [1] }, null, 2));
        });

        test('returns the string form otherwise', () => {
            assert.strictEqual(formatValue(42), '42');
            assert.strictEqual(formatValue(false), 'false');
            assert.strictEqual(formatValue('text'), 'text');
        });
    });
});
