import * as assert from 'assert';
import { NavigationHistory } from '../../navigationHistory';

suite('Navigation History Test Suite', () => {
    suite('NavigationHistory', () => {
        let history: NavigationHistory<string>;

        setup(() => {
            history = new NavigationHistory<string>();
            history.add('a');
            history.add('b');
            history.add('c');
        });

        test('cannot move in any direction when empty', () => {
            const empty = new NavigationHistory<string>();

            assert.strictEqual(empty.canGoBack(), false);
            assert.strictEqual(empty.canGoForward(), false);
            assert.strictEqual(empty.back(), undefined);
            assert.strictEqual(empty.forward(), undefined);
        });

        test('moves back and forward in order', () => {
            assert.strictEqual(history.back(), 'b');
            assert.strictEqual(history.back(), 'a');
            assert.strictEqual(history.back(), undefined);
            assert.strictEqual(history.forward(), 'b');
            assert.strictEqual(history.forward(), 'c');
            assert.strictEqual(history.forward(), undefined);
        });

        test('reports canGoBack and canGoForward', () => {
            assert.strictEqual(history.canGoBack(), true);
            assert.strictEqual(history.canGoForward(), false);

            history.back();
            history.back();

            assert.strictEqual(history.canGoBack(), false);
            assert.strictEqual(history.canGoForward(), true);
        });

        test('current follows the position in the history', () => {
            assert.strictEqual(new NavigationHistory<string>().current(), undefined);
            assert.strictEqual(history.current(), 'c');

            history.back();

            assert.strictEqual(history.current(), 'b');
        });

        test('discards forward entries when an entry is added after moving back', () => {
            history.back();
            history.back();

            history.add('d');

            assert.strictEqual(history.canGoForward(), false);
            assert.strictEqual(history.back(), 'a');
        });
    });
});
