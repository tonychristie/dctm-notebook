import * as assert from 'assert';
import { escapeHtml, isObjectId } from '../../htmlUtils';

suite('HTML Utils Test Suite', () => {
    suite('escapeHtml', () => {
        test('escapes &, <, >, " and \'', () => {
            assert.strictEqual(
                escapeHtml(`<a href="x">Tom & Jerry's</a>`),
                '&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&#039;s&lt;/a&gt;'
            );
        });

        test('escapes & before the other characters', () => {
            assert.strictEqual(escapeHtml('&lt;'), '&amp;lt;');
        });
    });

    suite('isObjectId', () => {
        test('accepts 16 hex characters in any case', () => {
            assert.strictEqual(isObjectId('0900000180001234'), true);
            assert.strictEqual(isObjectId('09000001800ABCDE'), true);
            assert.strictEqual(isObjectId('09000001800abcde'), true);
        });

        test('rejects other lengths', () => {
            assert.strictEqual(isObjectId('090000018000123'), false);
            assert.strictEqual(isObjectId('09000001800012345'), false);
            assert.strictEqual(isObjectId(''), false);
        });

        test('rejects other characters', () => {
            assert.strictEqual(isObjectId('090000018000123g'), false);
            assert.strictEqual(isObjectId(' 900000180001234'), false);
        });

        test('rejects non-strings', () => {
            assert.strictEqual(isObjectId(null), false);
            assert.strictEqual(isObjectId(undefined), false);
            assert.strictEqual(isObjectId(900000180001234), false);
            assert.strictEqual(isObjectId(['0900000180001234']), false);
        });
    });
});
