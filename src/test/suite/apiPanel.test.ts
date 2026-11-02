import * as assert from 'assert';
import { extractObjectId } from '../../apiPanel';

suite('ApiPanel Test Suite', () => {
    suite('extractObjectId', () => {
        test('returns a string argument as it is', () => {
            assert.strictEqual(extractObjectId('0900000180001234'), '0900000180001234');
        });

        test('returns data.objectId from a browser item', () => {
            assert.strictEqual(
                extractObjectId({ label: 'doc', data: { objectId: '0900000180001234' } }),
                '0900000180001234'
            );
        });

        test('returns undefined for anything else', () => {
            assert.strictEqual(extractObjectId(undefined), undefined);
            assert.strictEqual(extractObjectId(null), undefined);
            assert.strictEqual(extractObjectId(42), undefined);
            assert.strictEqual(extractObjectId({ objectId: '0900000180001234' }), undefined);
            assert.strictEqual(extractObjectId({ data: { objectId: 42 } }), undefined);
        });
    });
});
