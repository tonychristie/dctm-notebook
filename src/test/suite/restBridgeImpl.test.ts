import * as assert from 'assert';
import { RestBridgeImpl } from '../../restBridgeImpl';
import { FakeAxiosClient } from './fakeAxiosClient';

suite('RestBridgeImpl Test Suite', () => {
    function getTypeDetailsFor(data: Record<string, unknown>) {
        const client = new FakeAxiosClient(() => data);
        return new RestBridgeImpl(client.asAxios()).getTypeDetails('s1', 'my_type');
    }

    suite('getTypeDetails', () => {
        test('maps isRepeating and isInherited', async () => {
            const type = await getTypeDetailsFor({
                name: 'my_type',
                superType: 'dm_document',
                isInternal: true,
                attributes: [
                    { name: 'a', dataType: 'string', length: 32, isRepeating: true, isInherited: true }
                ]
            });

            assert.strictEqual(type.isInternal, true);
            assert.deepStrictEqual(type.attributes, [
                { name: 'a', dataType: 'string', length: 32, isRepeating: true, isInherited: true }
            ]);
        });

        test('maps repeating and inherited', async () => {
            const type = await getTypeDetailsFor({
                name: 'my_type',
                attributes: [{ name: 'a', dataType: 'string', length: 32, repeating: true, inherited: true }]
            });

            assert.strictEqual(type.attributes[0].isRepeating, true);
            assert.strictEqual(type.attributes[0].isInherited, true);
        });

        test('defaults isRepeating, isInherited and isInternal to false', async () => {
            const type = await getTypeDetailsFor({
                name: 'my_type',
                attributes: [{ name: 'a', dataType: 'string', length: 32 }]
            });

            assert.strictEqual(type.isInternal, false);
            assert.strictEqual(type.attributes[0].isRepeating, false);
            assert.strictEqual(type.attributes[0].isInherited, false);
        });

        test('returns no attributes when the response has none', async () => {
            const type = await getTypeDetailsFor({ name: 'my_type' });

            assert.deepStrictEqual(type.attributes, []);
        });
    });
});
