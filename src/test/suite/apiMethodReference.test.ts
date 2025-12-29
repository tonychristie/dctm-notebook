import * as assert from 'assert';
import * as path from 'path';
import { ApiMethodReference, ServerApiMethod } from '../../apiMethodReference';

suite('ApiMethodReference Test Suite', () => {
    let reference: ApiMethodReference;
    const testExtensionPath = path.resolve(__dirname, '../../..');

    setup(async () => {
        reference = new ApiMethodReference(testExtensionPath);
        await reference.load();
    });

    suite('Loading', () => {
        test('hasData returns true after loading', () => {
            assert.strictEqual(reference.hasData(), true);
        });

        test('getAllMethods returns non-empty array', () => {
            const methods = reference.getAllMethods();
            assert.ok(methods.length > 0);
        });

        test('loads exec methods', () => {
            const execMethods = reference.getMethodsByCategory('exec');
            assert.ok(execMethods.length > 0);
        });

        test('loads get methods', () => {
            const getMethods = reference.getMethodsByCategory('get');
            assert.ok(getMethods.length > 0);
        });

        test('loads set methods', () => {
            const setMethods = reference.getMethodsByCategory('set');
            assert.ok(setMethods.length > 0);
        });
    });

    suite('findMethod', () => {
        test('finds known exec method', () => {
            const method = reference.findMethod('save');
            assert.ok(method);
            assert.strictEqual(method.name, 'save');
        });

        test('finds known get method', () => {
            const method = reference.findMethod('connect');
            assert.ok(method);
            assert.strictEqual(method.name, 'connect');
        });

        test('finds known set method', () => {
            const method = reference.findMethod('set');
            assert.ok(method);
            assert.strictEqual(method.name, 'set');
        });

        test('is case-insensitive', () => {
            const method1 = reference.findMethod('SAVE');
            const method2 = reference.findMethod('save');
            const method3 = reference.findMethod('Save');
            assert.deepStrictEqual(method1, method2);
            assert.deepStrictEqual(method2, method3);
        });

        test('returns undefined for unknown method', () => {
            const method = reference.findMethod('unknownMethod123');
            assert.strictEqual(method, undefined);
        });
    });

    suite('getMethodsByCategory', () => {
        test('exec category contains expected methods', () => {
            const methods = reference.getMethodsByCategory('exec');
            const names = methods.map(m => m.name);
            assert.ok(names.includes('save'));
            assert.ok(names.includes('destroy'));
            assert.ok(names.includes('commit'));
        });

        test('get category contains expected methods', () => {
            const methods = reference.getMethodsByCategory('get');
            const names = methods.map(m => m.name);
            assert.ok(names.includes('connect'));
            assert.ok(names.includes('query'));
            assert.ok(names.includes('create'));
        });

        test('set category contains expected methods', () => {
            const methods = reference.getMethodsByCategory('set');
            const names = methods.map(m => m.name);
            assert.ok(names.includes('set'));
            assert.ok(names.includes('append'));
        });

        test('returns empty array for invalid category', () => {
            const methods = reference.getMethodsByCategory('invalid' as any);
            assert.strictEqual(methods.length, 0);
        });
    });

    suite('searchMethods', () => {
        test('finds methods by name pattern', () => {
            const results = reference.searchMethods('check');
            assert.ok(results.length > 0);
            assert.ok(results.some(m => m.name.includes('check')));
        });

        test('finds methods by description pattern', () => {
            const results = reference.searchMethods('transaction');
            assert.ok(results.length > 0);
        });

        test('is case-insensitive', () => {
            const results1 = reference.searchMethods('SAVE');
            const results2 = reference.searchMethods('save');
            assert.strictEqual(results1.length, results2.length);
        });

        test('returns empty array for no matches', () => {
            const results = reference.searchMethods('xyznonexistent123');
            assert.strictEqual(results.length, 0);
        });
    });

    suite('getCompletionItems', () => {
        test('returns completion items for all methods when no prefix', () => {
            const items = reference.getCompletionItems();
            assert.ok(items.length > 0);
        });

        test('returns filtered items when prefix provided', () => {
            const items = reference.getCompletionItems('sav');
            assert.ok(items.length > 0);
            assert.ok(items.some(item => item.label === 'save'));
        });

        test('completion items have correct properties', () => {
            const items = reference.getCompletionItems('save');
            const saveItem = items.find(item => item.label === 'save');
            assert.ok(saveItem);
            assert.ok(saveItem.detail); // Category
            assert.ok(saveItem.documentation); // Signature and description
            assert.ok(saveItem.insertText); // Text to insert
        });

        test('returns empty array for no matches', () => {
            const items = reference.getCompletionItems('xyznonexistent');
            assert.strictEqual(items.length, 0);
        });
    });

    suite('getHoverInfo', () => {
        test('returns hover for known method', () => {
            const hover = reference.getHoverInfo('save');
            assert.ok(hover);
        });

        test('is case-insensitive', () => {
            const hover1 = reference.getHoverInfo('SAVE');
            const hover2 = reference.getHoverInfo('save');
            assert.ok(hover1);
            assert.ok(hover2);
        });

        test('returns undefined for unknown method', () => {
            const hover = reference.getHoverInfo('unknownMethod123');
            assert.strictEqual(hover, undefined);
        });
    });

    suite('Method data structure', () => {
        test('methods have required fields', () => {
            const methods = reference.getAllMethods();
            for (const method of methods) {
                assert.ok(method.name, 'Method should have name');
                assert.ok(method.signature, 'Method should have signature');
                assert.ok(method.description, 'Method should have description');
            }
        });

        test('signatures follow dmAPI format', () => {
            const methods = reference.getAllMethods();
            for (const method of methods) {
                assert.ok(
                    method.signature.includes('dmAPIExec') ||
                    method.signature.includes('dmAPIGet') ||
                    method.signature.includes('dmAPISet'),
                    `Signature should contain dmAPI prefix: ${method.signature}`
                );
            }
        });
    });
});

suite('ApiMethodReference without data', () => {
    test('hasData returns false when not loaded', () => {
        const reference = new ApiMethodReference('/nonexistent/path');
        assert.strictEqual(reference.hasData(), false);
    });

    test('getAllMethods returns empty when not loaded', () => {
        const reference = new ApiMethodReference('/nonexistent/path');
        const methods = reference.getAllMethods();
        assert.strictEqual(methods.length, 0);
    });

    test('findMethod returns undefined when not loaded', () => {
        const reference = new ApiMethodReference('/nonexistent/path');
        const method = reference.findMethod('save');
        assert.strictEqual(method, undefined);
    });

    test('load handles missing file gracefully', async () => {
        const reference = new ApiMethodReference('/nonexistent/path');
        await reference.load(); // Should not throw
        assert.strictEqual(reference.hasData(), false);
    });
});
