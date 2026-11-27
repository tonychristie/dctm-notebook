import * as assert from 'assert';
import { sortRows } from '../../results/sortRows';

function column(rows: Record<string, unknown>[], name: string): unknown[] {
    return rows.map(row => row[name]);
}

suite('sortRows Test Suite', () => {
    test('sorts numbers as numbers', () => {
        const rows = [{ n: 10 }, { n: 9 }, { n: 100 }];
        assert.deepStrictEqual(column(sortRows(rows, 'n', 'asc'), 'n'), [9, 10, 100]);
        assert.deepStrictEqual(column(sortRows(rows, 'n', 'desc'), 'n'), [100, 10, 9]);
    });

    test('sorts text without case', () => {
        const rows = [{ s: 'banana' }, { s: 'Apple' }, { s: 'cherry' }];
        assert.deepStrictEqual(column(sortRows(rows, 's', 'asc'), 's'), ['Apple', 'banana', 'cherry']);
        assert.deepStrictEqual(column(sortRows(rows, 's', 'desc'), 's'), ['cherry', 'banana', 'Apple']);
    });

    test('sorts null and undefined as empty text', () => {
        const rows = [{ s: 'b' }, { s: null }, { s: 'a' }, {}];
        assert.deepStrictEqual(column(sortRows(rows, 's', 'asc'), 's'), [null, undefined, 'a', 'b']);
        assert.deepStrictEqual(column(sortRows(rows, 's', 'desc'), 's'), ['b', 'a', null, undefined]);
    });

    test('leaves the given rows in their order', () => {
        const rows = [{ n: 2 }, { n: 1 }];
        sortRows(rows, 'n', 'asc');
        assert.deepStrictEqual(column(rows, 'n'), [2, 1]);
    });
});
