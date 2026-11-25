import * as assert from 'assert';
import { toTsv, toTsvRow } from '../../results/tsv';

suite('TSV Test Suite', () => {
    suite('toTsv', () => {
        test('writes a header row and one row per result row in column order', () => {
            const rows = [
                { object_name: 'a', r_object_id: '0900000000000001' },
                { object_name: 'b', r_object_id: '0900000000000002' }
            ];
            assert.strictEqual(
                toTsv(['r_object_id', 'object_name'], rows),
                'r_object_id\tobject_name\n0900000000000001\ta\n0900000000000002\tb'
            );
        });

        test('writes null, undefined and missing values as empty cells', () => {
            const rows = [{ a: null, b: undefined, c: 'x' }];
            assert.strictEqual(toTsv(['a', 'b', 'c', 'd'], rows), 'a\tb\tc\td\n\t\tx\t');
        });
    });

    suite('toTsvRow', () => {
        test('writes the row values in column order with no header line', () => {
            const row = { object_name: 'a', r_object_id: '0900000000000001' };
            assert.strictEqual(toTsvRow(['r_object_id', 'object_name'], row), '0900000000000001\ta');
        });

        test('writes null, undefined and missing values as empty cells', () => {
            assert.strictEqual(toTsvRow(['a', 'b', 'c', 'd'], { a: null, b: undefined, c: 'x' }), '\t\tx\t');
        });
    });
});
