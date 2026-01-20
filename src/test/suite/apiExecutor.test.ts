import * as assert from 'assert';
import {
    ApiExecutor,
    COMMON_DFC_METHODS,
    MethodInfo
} from '../../apiExecutor';

// Mock ConnectionManager for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConnectionManager: any = {
    getActiveConnection: () => null,
    getDctmBridge: () => null
};

suite('ApiExecutor Test Suite', () => {
    let apiExecutor: ApiExecutor;

    setup(() => {
        apiExecutor = new ApiExecutor(mockConnectionManager);
    });

    suite('getCategories', () => {
        test('returns all method categories', () => {
            const categories = apiExecutor.getCategories();

            assert.ok(categories.length > 0, 'Should have at least one category');
            assert.ok(categories.includes('Object Lifecycle'), 'Should include Object Lifecycle');
            assert.ok(categories.includes('Version Control'), 'Should include Version Control');
            assert.ok(categories.includes('Attribute Getters'), 'Should include Attribute Getters');
            assert.ok(categories.includes('Attribute Setters'), 'Should include Attribute Setters');
        });

        test('returns same categories as COMMON_DFC_METHODS keys', () => {
            const categories = apiExecutor.getCategories();
            const expectedCategories = Object.keys(COMMON_DFC_METHODS);

            assert.deepStrictEqual(categories, expectedCategories);
        });
    });

    suite('getMethodsByCategory', () => {
        test('returns methods for valid category', () => {
            const methods = apiExecutor.getMethodsByCategory('Object Lifecycle');

            assert.ok(methods.length > 0, 'Should return methods');
            assert.ok(methods.some(m => m.name === 'save'), 'Should include save method');
            assert.ok(methods.some(m => m.name === 'destroy'), 'Should include destroy method');
        });

        test('returns empty array for invalid category', () => {
            const methods = apiExecutor.getMethodsByCategory('NonExistentCategory');

            assert.strictEqual(methods.length, 0, 'Should return empty array');
        });

        test('returns methods with correct structure', () => {
            const methods = apiExecutor.getMethodsByCategory('Version Control');

            methods.forEach(method => {
                assert.ok(method.name, 'Method should have name');
                assert.ok(method.returnType, 'Method should have returnType');
                assert.ok(Array.isArray(method.parameters), 'Method should have parameters array');
            });
        });
    });

    suite('getAllMethods', () => {
        test('returns flat list of all methods', () => {
            const allMethods = apiExecutor.getAllMethods();

            assert.ok(allMethods.length > 0, 'Should return methods');

            // Count expected methods from all categories
            const expectedCount = Object.values(COMMON_DFC_METHODS)
                .reduce((sum, methods) => sum + methods.length, 0);

            assert.strictEqual(allMethods.length, expectedCount, 'Should include all methods');
        });

        test('includes methods from all categories', () => {
            const allMethods = apiExecutor.getAllMethods();

            // Check for methods from different categories
            assert.ok(allMethods.some(m => m.name === 'save'), 'Should include save (Object Lifecycle)');
            assert.ok(allMethods.some(m => m.name === 'checkout'), 'Should include checkout (Version Control)');
            assert.ok(allMethods.some(m => m.name === 'getString'), 'Should include getString (Attribute Getters)');
            assert.ok(allMethods.some(m => m.name === 'setString'), 'Should include setString (Attribute Setters)');
            assert.ok(allMethods.some(m => m.name === 'link'), 'Should include link (Folder Operations)');
        });
    });

    suite('findMethod', () => {
        test('finds method by exact name', () => {
            const method = apiExecutor.findMethod('save');

            assert.ok(method, 'Should find save method');
            assert.strictEqual(method!.name, 'save');
            assert.strictEqual(method!.returnType, 'void');
        });

        test('finds method with parameters', () => {
            const method = apiExecutor.findMethod('getString');

            assert.ok(method, 'Should find getString method');
            assert.strictEqual(method!.name, 'getString');
            assert.strictEqual(method!.returnType, 'string');
            assert.ok(method!.parameters.length > 0, 'Should have parameters');
            assert.strictEqual(method!.parameters[0].name, 'attributeName');
        });

        test('returns undefined for non-existent method', () => {
            const method = apiExecutor.findMethod('nonExistentMethod');

            assert.strictEqual(method, undefined, 'Should return undefined');
        });

        test('is case-sensitive', () => {
            const method = apiExecutor.findMethod('Save');

            assert.strictEqual(method, undefined, 'Should not find Save (case mismatch)');
        });

        test('finds checkout method with correct details', () => {
            const method = apiExecutor.findMethod('checkout');

            assert.ok(method, 'Should find checkout method');
            assert.strictEqual(method!.returnType, 'IDfId');
            assert.ok(method!.description, 'Should have description');
        });
    });

    suite('searchMethods', () => {
        test('finds methods by name pattern', () => {
            const results = apiExecutor.searchMethods('get');

            assert.ok(results.length > 0, 'Should find methods');
            assert.ok(results.every(m => m.name.toLowerCase().includes('get') ||
                (m.description && m.description.toLowerCase().includes('get'))),
                'All results should match pattern');
        });

        test('finds methods by description pattern', () => {
            const results = apiExecutor.searchMethods('attribute');

            assert.ok(results.length > 0, 'Should find methods');
            // getString has "Gets string value of an attribute"
            assert.ok(results.some(m => m.name === 'getString'),
                'Should find getString by description');
        });

        test('is case-insensitive', () => {
            const resultsLower = apiExecutor.searchMethods('save');
            const resultsUpper = apiExecutor.searchMethods('SAVE');
            const resultsMixed = apiExecutor.searchMethods('SaVe');

            assert.deepStrictEqual(resultsLower, resultsUpper, 'Lower and upper should match');
            assert.deepStrictEqual(resultsLower, resultsMixed, 'Mixed case should match');
        });

        test('returns empty array for no matches', () => {
            const results = apiExecutor.searchMethods('xyz123nonexistent');

            assert.strictEqual(results.length, 0, 'Should return empty array');
        });

        test('finds methods with partial match', () => {
            const results = apiExecutor.searchMethods('check');

            assert.ok(results.length >= 3, 'Should find multiple methods');
            assert.ok(results.some(m => m.name === 'checkout'), 'Should include checkout');
            assert.ok(results.some(m => m.name === 'checkin'), 'Should include checkin');
            assert.ok(results.some(m => m.name === 'cancelCheckout'), 'Should include cancelCheckout');
        });

        test('finds version control methods', () => {
            const results = apiExecutor.searchMethods('version');

            assert.ok(results.length > 0, 'Should find methods with version in description');
        });
    });

    suite('COMMON_DFC_METHODS structure', () => {
        test('all methods have required fields', () => {
            Object.entries(COMMON_DFC_METHODS).forEach(([category, methods]) => {
                methods.forEach((method: MethodInfo) => {
                    assert.ok(method.name, `Method in ${category} should have name`);
                    assert.ok(method.returnType, `${method.name} should have returnType`);
                    assert.ok(Array.isArray(method.parameters),
                        `${method.name} should have parameters array`);
                });
            });
        });

        test('all parameters have required fields', () => {
            Object.values(COMMON_DFC_METHODS).forEach(methods => {
                methods.forEach((method: MethodInfo) => {
                    method.parameters.forEach(param => {
                        assert.ok(param.name, `Parameter in ${method.name} should have name`);
                        assert.ok(param.type, `Parameter ${param.name} should have type`);
                        assert.ok(typeof param.required === 'boolean',
                            `Parameter ${param.name} should have required boolean`);
                    });
                });
            });
        });

        test('categories have expected methods', () => {
            // Object Lifecycle
            const lifecycle = COMMON_DFC_METHODS['Object Lifecycle'];
            assert.ok(lifecycle.some(m => m.name === 'save'));
            assert.ok(lifecycle.some(m => m.name === 'destroy'));

            // Version Control
            const versionControl = COMMON_DFC_METHODS['Version Control'];
            assert.ok(versionControl.some(m => m.name === 'checkout'));
            assert.ok(versionControl.some(m => m.name === 'checkin'));
            assert.ok(versionControl.some(m => m.name === 'cancelCheckout'));

            // Permissions
            const permissions = COMMON_DFC_METHODS['Permissions'];
            assert.ok(permissions.some(m => m.name === 'getPermit'));
            assert.ok(permissions.some(m => m.name === 'grant'));
            assert.ok(permissions.some(m => m.name === 'revoke'));
        });
    });
});
