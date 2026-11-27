import * as assert from 'assert';
import { TypeCache } from '../../typeCache';
import { DctmBridge } from '../../dctmBridge';
import { TypeAttribute, TypeSummary } from '../../bridgeTypes';

const typeSummaries: TypeSummary[] = [
    { name: 'my_document', superType: 'dm_document', isInternal: false },
    { name: 'dm_folder', superType: 'dm_sysobject', isInternal: false },
    { name: 'dm_sysobject', superType: null, isInternal: false },
    { name: 'my_document_v2', superType: 'my_document', isInternal: false },
    { name: 'dm_document', superType: 'dm_sysobject', isInternal: false },
    { name: 'dmi_queue_item', superType: null, isInternal: true }
];

const bridgeAttributes: TypeAttribute[] = [
    { name: 'r_object_id', dataType: 'ID', length: 16, isRepeating: false, isInherited: true },
    { name: 'custom_field', dataType: 'STRING', length: 100, isRepeating: false, isInherited: false }
];

suite('TypeCache Test Suite', () => {
    let detailCalls: string[];
    let detailsError: Error | undefined;
    let typeCache: TypeCache;

    setup(async () => {
        detailCalls = [];
        detailsError = undefined;
        const bridge = {
            getTypes: async () => typeSummaries,
            getTypeDetails: async (sessionId: string, typeName: string) => {
                detailCalls.push(`${sessionId}:${typeName}`);
                if (detailsError) {
                    throw detailsError;
                }
                return { name: typeName, superType: 'dm_document', isInternal: false, attributes: bridgeAttributes };
            }
        };
        typeCache = new TypeCache(bridge as unknown as DctmBridge, 'session-1');
        await typeCache.refresh();
    });

    teardown(() => {
        typeCache.dispose();
    });

    test('refresh builds the root types and the child lists from getTypes', () => {
        assert.deepStrictEqual(typeCache.getRootTypes(), ['dm_sysobject', 'dmi_queue_item']);
        assert.deepStrictEqual(typeCache.getChildTypes('dm_sysobject'), ['dm_document', 'dm_folder']);
        assert.deepStrictEqual(typeCache.getChildTypes('DM_DOCUMENT'), ['my_document']);
        assert.deepStrictEqual(typeCache.getChildTypes('dm_folder'), []);
        assert.deepStrictEqual(typeCache.getChildTypes('unknown_type'), []);
    });

    test('isTypeName is true for a cached type in any case and false otherwise', () => {
        assert.strictEqual(typeCache.isTypeName('Dm_Document'), true);
        assert.strictEqual(typeCache.isTypeName('select'), false);
    });

    suite('getNearestStandardType', () => {
        test('returns the standard type above a custom type', () => {
            assert.strictEqual(typeCache.getNearestStandardType('my_document_v2'), 'dm_document');
        });

        test('returns a standard type itself', () => {
            assert.strictEqual(typeCache.getNearestStandardType('dm_folder'), 'dm_folder');
        });

        test('returns undefined for a type that is not in the cache', () => {
            assert.strictEqual(typeCache.getNearestStandardType('unknown_type'), undefined);
        });
    });

    suite('fetchTypeDetails', () => {
        test('fetches the attributes of a cached type from the bridge', async () => {
            const type = await typeCache.fetchTypeDetails('my_document');

            assert.deepStrictEqual(detailCalls, ['session-1:my_document']);
            assert.ok(type);
            assert.deepStrictEqual(type.attributes, bridgeAttributes);
        });

        test('returns a type with attributes without a bridge call unless refresh is set', async () => {
            await typeCache.fetchTypeDetails('my_document');

            await typeCache.fetchTypeDetails('my_document');
            assert.strictEqual(detailCalls.length, 1);

            await typeCache.fetchTypeDetails('my_document', true);
            assert.strictEqual(detailCalls.length, 2);
        });

        test('rejects with the bridge error', async () => {
            detailsError = new Error('401 Unauthorized');

            await assert.rejects(typeCache.fetchTypeDetails('my_document'), /401 Unauthorized/);
        });

        test('returns undefined without a bridge call for a type that is not in the cache', async () => {
            const type = await typeCache.fetchTypeDetails('unknown_type');

            assert.strictEqual(type, undefined);
            assert.deepStrictEqual(detailCalls, []);
        });
    });
});
