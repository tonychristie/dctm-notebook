import * as assert from 'assert';
import { formatResult, formatResultWithLinks, isGroupVisible, matchesFilter } from '../../webviewLogic';

suite('Webview Logic Test Suite', () => {
    suite('matchesFilter', () => {
        test('matches on the name without regard to case', () => {
            assert.strictEqual(matchesFilter('OBJECT', 'r_object_id', 'id'), true);
        });

        test('matches on the second field without regard to case', () => {
            assert.strictEqual(matchesFilter('String', 'title', 'string(400)'), true);
        });

        test('rejects an attribute that matches on neither field', () => {
            assert.strictEqual(matchesFilter('owner', 'title', 'string(400)'), false);
        });

        test('an empty filter matches everything', () => {
            assert.strictEqual(matchesFilter('', 'title', ''), true);
        });
    });

    suite('isGroupVisible', () => {
        test('hides an inherited group when show inherited is off, whatever its count', () => {
            assert.strictEqual(isGroupVisible(true, false, 5), false);
        });

        test('shows an inherited group with visible attributes when show inherited is on', () => {
            assert.strictEqual(isGroupVisible(true, true, 1), true);
        });

        test('shows any other group only when it has a visible attribute', () => {
            assert.strictEqual(isGroupVisible(false, false, 1), true);
            assert.strictEqual(isGroupVisible(false, true, 0), false);
            assert.strictEqual(isGroupVisible(true, true, 0), false);
        });
    });

    suite('formatResultWithLinks', () => {
        test('wraps whole-word 16-hex IDs in either case', () => {
            assert.strictEqual(
                formatResultWithLinks('id 0900000180001234 and 09000001800ABCDE'),
                'id <span class="object-id" data-object-id="0900000180001234">0900000180001234</span> and ' +
                '<span class="object-id" data-object-id="09000001800ABCDE">09000001800ABCDE</span>'
            );
        });

        test('leaves shorter and longer hex strings alone', () => {
            const text = '090000018000123 09000001800012345 x0900000180001234';
            assert.strictEqual(formatResultWithLinks(text), text);
        });
    });

    suite('formatResult', () => {
        test('returns null for null and undefined', () => {
            assert.strictEqual(formatResult(null), 'null');
            assert.strictEqual(formatResult(undefined), 'null');
        });

        test('returns indented JSON for objects', () => {
            assert.strictEqual(formatResult({ a: 1 }), JSON.stringify({ a: 1 }, null, 2));
        });
    });
});
