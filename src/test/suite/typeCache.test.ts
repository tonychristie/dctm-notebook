import * as assert from 'assert';
import { TypeCache, TypeInfo } from '../../typeCache';

// Mock ConnectionManager for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConnectionManager: any = {
    getActiveConnection: () => null,
    getDctmBridge: () => null,
    onConnectionChange: () => {}
};

suite('TypeCache Test Suite', () => {
    let typeCache: TypeCache;

    setup(() => {
        typeCache = new TypeCache(mockConnectionManager);
    });

    suite('Initial State', () => {
        test('hasData returns false initially', () => {
            assert.strictEqual(typeCache.hasData(), false);
        });

        test('getTypeNames returns empty array initially', () => {
            const names = typeCache.getTypeNames();
            assert.strictEqual(names.length, 0);
        });

        test('getRootTypes returns empty array initially', () => {
            const roots = typeCache.getRootTypes();
            assert.strictEqual(roots.length, 0);
        });

        test('getLastRefresh returns null initially', () => {
            assert.strictEqual(typeCache.getLastRefresh(), null);
        });

        test('getStats returns zero count initially', () => {
            const stats = typeCache.getStats();
            assert.strictEqual(stats.typeCount, 0);
            assert.strictEqual(stats.lastRefresh, null);
        });
    });

    suite('Type Operations (without data)', () => {
        test('getType returns undefined for unknown type', () => {
            const type = typeCache.getType('dm_document');
            assert.strictEqual(type, undefined);
        });

        test('getChildTypes returns empty array for unknown type', () => {
            const children = typeCache.getChildTypes('dm_document');
            assert.strictEqual(children.length, 0);
        });

        test('isTypeName returns false for any name', () => {
            assert.strictEqual(typeCache.isTypeName('dm_document'), false);
            assert.strictEqual(typeCache.isTypeName('anything'), false);
        });

        test('getAttributes returns empty array for unknown type', () => {
            const attrs = typeCache.getAttributes('dm_document');
            assert.strictEqual(attrs.length, 0);
        });

        test('searchTypes returns empty array', () => {
            const results = typeCache.searchTypes('dm');
            assert.strictEqual(results.length, 0);
        });
    });

    suite('clear', () => {
        test('clear resets all data', () => {
            // Since we can't easily populate without mocking the bridge,
            // just verify clear doesn't throw
            typeCache.clear();
            assert.strictEqual(typeCache.hasData(), false);
            assert.strictEqual(typeCache.getLastRefresh(), null);
        });
    });

    suite('onRefresh callback', () => {
        test('callback is registered without error', () => {
            let called = false;
            typeCache.onRefresh(() => {
                called = true;
            });
            // Can't trigger refresh without connection, but verify registration works
            assert.strictEqual(called, false);
        });

        test('multiple callbacks can be registered', () => {
            let count = 0;
            typeCache.onRefresh(() => count++);
            typeCache.onRefresh(() => count++);
            typeCache.onRefresh(() => count++);
            // Just verify no errors
            assert.strictEqual(count, 0);
        });
    });

    suite('refresh error handling', () => {
        test('refresh throws error without connection', async () => {
            try {
                await typeCache.refresh();
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok((error as Error).message.includes('No active connection'));
            }
        });
    });

    suite('fetchTypeDetails error handling', () => {
        test('fetchTypeDetails returns undefined without connection', async () => {
            const result = await typeCache.fetchTypeDetails('dm_document');
            assert.strictEqual(result, undefined);
        });
    });
});

// Test suite with mocked data
suite('TypeCache with Mock Data', () => {
    // These tests simulate what happens after a successful refresh
    // by directly manipulating internal state through a custom subclass

    class TestableTypeCache extends TypeCache {
        // Expose internal methods for testing
        public addMockType(name: string, info: TypeInfo): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).typeMap.set(name.toLowerCase(), info);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).typeNames.add(name.toLowerCase());
        }

        public addMockRootType(name: string): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).rootTypes.push(name.toLowerCase());
        }

        public setLastRefresh(date: Date): void {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (this as any).lastRefresh = date;
        }
    }

    let typeCache: TestableTypeCache;

    setup(() => {
        typeCache = new TestableTypeCache(mockConnectionManager);

        // Add mock types
        typeCache.addMockType('dm_sysobject', {
            name: 'dm_sysobject',
            superType: null,
            isInternal: false,
            attributes: [
                { name: 'r_object_id', dataType: 'ID', length: 16, isRepeating: false, isInherited: false },
                { name: 'object_name', dataType: 'STRING', length: 255, isRepeating: false, isInherited: false }
            ],
            children: ['dm_document', 'dm_folder']
        });

        typeCache.addMockType('dm_document', {
            name: 'dm_document',
            superType: 'dm_sysobject',
            isInternal: false,
            attributes: [
                { name: 'r_object_id', dataType: 'ID', length: 16, isRepeating: false, isInherited: true },
                { name: 'object_name', dataType: 'STRING', length: 255, isRepeating: false, isInherited: true },
                { name: 'a_content_type', dataType: 'STRING', length: 64, isRepeating: false, isInherited: false }
            ],
            children: ['my_document']
        });

        typeCache.addMockType('dm_folder', {
            name: 'dm_folder',
            superType: 'dm_sysobject',
            isInternal: false,
            attributes: [
                { name: 'r_object_id', dataType: 'ID', length: 16, isRepeating: false, isInherited: true },
                { name: 'object_name', dataType: 'STRING', length: 255, isRepeating: false, isInherited: true },
                { name: 'r_folder_path', dataType: 'STRING', length: 255, isRepeating: true, isInherited: false }
            ],
            children: []
        });

        typeCache.addMockType('my_document', {
            name: 'my_document',
            superType: 'dm_document',
            isInternal: false,
            attributes: [
                { name: 'r_object_id', dataType: 'ID', length: 16, isRepeating: false, isInherited: true },
                { name: 'custom_field', dataType: 'STRING', length: 100, isRepeating: false, isInherited: false }
            ],
            children: []
        });

        typeCache.addMockRootType('dm_sysobject');
        typeCache.setLastRefresh(new Date());
    });

    suite('hasData', () => {
        test('returns true when data is loaded', () => {
            assert.strictEqual(typeCache.hasData(), true);
        });
    });

    suite('getTypeNames', () => {
        test('returns all type names', () => {
            const names = typeCache.getTypeNames();
            assert.strictEqual(names.length, 4);
            assert.ok(names.includes('dm_sysobject'));
            assert.ok(names.includes('dm_document'));
            assert.ok(names.includes('dm_folder'));
            assert.ok(names.includes('my_document'));
        });
    });

    suite('getRootTypes', () => {
        test('returns root types', () => {
            const roots = typeCache.getRootTypes();
            assert.strictEqual(roots.length, 1);
            assert.ok(roots.includes('dm_sysobject'));
        });
    });

    suite('getType', () => {
        test('returns type info for known type', () => {
            const type = typeCache.getType('dm_document');
            assert.ok(type);
            assert.strictEqual(type.name, 'dm_document');
            assert.strictEqual(type.superType, 'dm_sysobject');
        });

        test('is case-insensitive', () => {
            const type1 = typeCache.getType('DM_DOCUMENT');
            const type2 = typeCache.getType('dm_document');
            assert.deepStrictEqual(type1, type2);
        });

        test('returns undefined for unknown type', () => {
            const type = typeCache.getType('unknown_type');
            assert.strictEqual(type, undefined);
        });
    });

    suite('getChildTypes', () => {
        test('returns child types for parent', () => {
            const children = typeCache.getChildTypes('dm_sysobject');
            assert.strictEqual(children.length, 2);
            assert.ok(children.includes('dm_document'));
            assert.ok(children.includes('dm_folder'));
        });

        test('returns empty array for leaf type', () => {
            const children = typeCache.getChildTypes('dm_folder');
            assert.strictEqual(children.length, 0);
        });
    });

    suite('isTypeName', () => {
        test('returns true for known types', () => {
            assert.strictEqual(typeCache.isTypeName('dm_document'), true);
            assert.strictEqual(typeCache.isTypeName('dm_folder'), true);
            assert.strictEqual(typeCache.isTypeName('my_document'), true);
        });

        test('is case-insensitive', () => {
            assert.strictEqual(typeCache.isTypeName('DM_DOCUMENT'), true);
            assert.strictEqual(typeCache.isTypeName('Dm_Document'), true);
        });

        test('returns false for unknown types', () => {
            assert.strictEqual(typeCache.isTypeName('unknown'), false);
            assert.strictEqual(typeCache.isTypeName('select'), false);
        });
    });

    suite('getAttributes', () => {
        test('returns all attributes when includeInherited is true', () => {
            const attrs = typeCache.getAttributes('dm_document', true);
            assert.strictEqual(attrs.length, 3);
        });

        test('returns only type-specific attributes when includeInherited is false', () => {
            const attrs = typeCache.getAttributes('dm_document', false);
            assert.strictEqual(attrs.length, 1);
            assert.strictEqual(attrs[0].name, 'a_content_type');
        });

        test('defaults to including inherited', () => {
            const attrs = typeCache.getAttributes('dm_document');
            assert.strictEqual(attrs.length, 3);
        });
    });

    suite('searchTypes', () => {
        test('finds types by pattern', () => {
            const results = typeCache.searchTypes('dm_');
            assert.strictEqual(results.length, 3);
        });

        test('finds types with partial match', () => {
            const results = typeCache.searchTypes('doc');
            assert.strictEqual(results.length, 2);
            assert.ok(results.includes('dm_document'));
            assert.ok(results.includes('my_document'));
        });

        test('is case-insensitive', () => {
            const results1 = typeCache.searchTypes('DM_');
            const results2 = typeCache.searchTypes('dm_');
            assert.deepStrictEqual(results1, results2);
        });

        test('returns sorted results', () => {
            const results = typeCache.searchTypes('dm_');
            const sorted = [...results].sort();
            assert.deepStrictEqual(results, sorted);
        });

        test('returns empty for no matches', () => {
            const results = typeCache.searchTypes('xyz123');
            assert.strictEqual(results.length, 0);
        });
    });

    suite('getStats', () => {
        test('returns correct type count', () => {
            const stats = typeCache.getStats();
            assert.strictEqual(stats.typeCount, 4);
        });

        test('returns last refresh date', () => {
            const stats = typeCache.getStats();
            assert.ok(stats.lastRefresh instanceof Date);
        });
    });

    suite('clear', () => {
        test('removes all data', () => {
            typeCache.clear();
            assert.strictEqual(typeCache.hasData(), false);
            assert.strictEqual(typeCache.getTypeNames().length, 0);
            assert.strictEqual(typeCache.getRootTypes().length, 0);
            assert.strictEqual(typeCache.getLastRefresh(), null);
        });
    });
});
