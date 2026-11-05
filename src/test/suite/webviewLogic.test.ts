import * as assert from 'assert';
import type { MethodInfo, ParameterInfo } from '../../apiExecutor';
import { convertParameters, filterMethods, formatResult, formatResultWithLinks, isGroupVisible, matchesFilter } from '../../webviewLogic';

suite('Webview Logic Test Suite', () => {
    suite('convertParameters', () => {
        const required = (type: string): ParameterInfo[] => [{ name: 'value', type, required: true }];

        test('a blank required parameter gives undefined for each type', () => {
            for (const type of ['string', 'int', 'double', 'boolean']) {
                assert.strictEqual(convertParameters(required(type), ['  ']), undefined, type);
            }
        });

        test('a required int takes a whole number only', () => {
            assert.strictEqual(convertParameters(required('int'), ['1.5']), undefined);
            assert.strictEqual(convertParameters(required('int'), ['3abc']), undefined);
            assert.deepStrictEqual(convertParameters(required('int'), ['-2']), [-2]);
        });

        test('a required double takes a number only', () => {
            assert.strictEqual(convertParameters(required('double'), ['3abc']), undefined);
            assert.deepStrictEqual(convertParameters(required('double'), ['2.5']), [2.5]);
        });

        test('a required boolean takes true or false in any case', () => {
            assert.deepStrictEqual(convertParameters(required('boolean'), ['TRUE']), [true]);
            assert.strictEqual(convertParameters(required('boolean'), ['yes']), undefined);
        });

        test('a blank optional parameter is sent as an empty string', () => {
            const parameters: ParameterInfo[] = [
                { name: 'accessorName', type: 'string', required: true },
                { name: 'extendedPermit', type: 'string', required: false }
            ];
            assert.deepStrictEqual(convertParameters(parameters, ['dm_world', '']), ['dm_world', '']);
        });

        test('a method with no parameters gives an empty list', () => {
            assert.deepStrictEqual(convertParameters([], []), []);
        });
    });

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

    suite('filterMethods', () => {
        const method = (name: string, description?: string): MethodInfo =>
            ({ name, returnType: 'void', parameters: [], description });
        const checkout = method('checkout', 'Check out the object');
        const save = method('save', 'Save the object');
        const getString = method('getString', 'Read a value; see CHECKIN state');
        const getId = method('getId');
        const methods = {
            'Version Control': [checkout, save],
            'Attribute Getters': [getString, getId]
        };

        test('with search text and no category, matches name or description in every category without regard to case', () => {
            assert.deepStrictEqual(filterMethods(methods, null, 'CHECK'), [checkout, getString]);
        });

        test('with search text and a category, matches in every category, not only the selected one', () => {
            assert.deepStrictEqual(filterMethods(methods, 'Attribute Getters', 'check'), [checkout, getString]);
        });

        test('with empty search text and a category, returns that category', () => {
            assert.deepStrictEqual(filterMethods(methods, 'Version Control', ''), [checkout, save]);
        });

        test('with empty search text and no category, returns all methods', () => {
            assert.deepStrictEqual(filterMethods(methods, null, ''), [checkout, save, getString, getId]);
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

        test('escapes markup around an ID and still wraps the ID', () => {
            assert.strictEqual(
                formatResultWithLinks('<b>x</b> 0900000180001234'),
                '&lt;b&gt;x&lt;/b&gt; <span class="object-id" data-object-id="0900000180001234">0900000180001234</span>'
            );
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
