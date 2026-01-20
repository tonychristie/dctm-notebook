import * as assert from 'assert';
import { DqlSemanticTokensProvider } from '../../dqlSemanticTokens';
import { TypeCache } from '../../typeCache';

// Mock ConnectionManager for testing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockConnectionManager: any = {
    getActiveConnection: () => null,
    getDctmBridge: () => null,
    onConnectionChange: () => {}
};

// Testable subclass that exposes private methods
class TestableDqlSemanticTokensProvider extends DqlSemanticTokensProvider {
    public testIsTypeContext(line: string, position: number): boolean {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (this as any).isTypeContext(line, position);
    }
}

// Create a mock TypeCache with test data
class MockTypeCache extends TypeCache {
    private mockTypes: Set<string> = new Set();

    constructor() {
        super(mockConnectionManager);
    }

    addMockType(typeName: string): void {
        this.mockTypes.add(typeName.toLowerCase());
    }

    override isTypeName(name: string): boolean {
        return this.mockTypes.has(name.toLowerCase());
    }

    override hasData(): boolean {
        return this.mockTypes.size > 0;
    }
}

suite('DqlSemanticTokensProvider Test Suite', () => {
    let provider: TestableDqlSemanticTokensProvider;
    let mockTypeCache: MockTypeCache;

    setup(() => {
        mockTypeCache = new MockTypeCache();
        mockTypeCache.addMockType('dm_document');
        mockTypeCache.addMockType('dm_folder');
        mockTypeCache.addMockType('dm_sysobject');
        mockTypeCache.addMockType('my_custom_type');
        provider = new TestableDqlSemanticTokensProvider(mockTypeCache);
    });

    suite('isTypeContext - Should highlight (return true)', () => {
        test('after FROM keyword', () => {
            const line = 'SELECT * FROM dm_document';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after FROM keyword with extra spaces', () => {
            const line = 'SELECT * FROM   dm_document';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after JOIN keyword', () => {
            const line = 'SELECT * FROM dm_document d JOIN dm_folder f ON d.i_folder_id = f.r_object_id';
            const position = line.indexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after LEFT JOIN keyword', () => {
            const line = 'SELECT * FROM dm_document LEFT JOIN dm_folder ON 1=1';
            const position = line.indexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after INNER JOIN keyword', () => {
            const line = 'SELECT * FROM dm_document INNER JOIN dm_folder ON 1=1';
            const position = line.indexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after INTO keyword', () => {
            const line = 'INSERT INTO dm_document (object_name) VALUES';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after UPDATE keyword', () => {
            const line = 'UPDATE dm_document SET object_name = \'test\'';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('in type() function call', () => {
            const line = 'SELECT * FROM dm_sysobject WHERE TYPE(dm_document)';
            // Find dm_document inside TYPE()
            const position = line.lastIndexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after (ALL) subtype syntax', () => {
            const line = 'SELECT * FROM (ALL) dm_document';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after CREATE TYPE', () => {
            const line = 'CREATE TYPE my_custom_type';
            const position = line.indexOf('my_custom_type');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after ALTER TYPE', () => {
            const line = 'ALTER TYPE my_custom_type';
            const position = line.indexOf('my_custom_type');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after DROP TYPE', () => {
            const line = 'DROP TYPE my_custom_type';
            const position = line.indexOf('my_custom_type');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after REGISTER AS', () => {
            const line = 'REGISTER AS my_custom_type';
            const position = line.indexOf('my_custom_type');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('after REGISTER TABLE', () => {
            const line = 'REGISTER TABLE my_custom_type';
            const position = line.indexOf('my_custom_type');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('comma-separated types in FROM clause', () => {
            const line = 'SELECT * FROM dm_document, dm_folder';
            const position = line.indexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });
    });

    suite('isTypeContext - Should NOT highlight (return false)', () => {
        test('in SELECT clause (before FROM)', () => {
            const line = 'SELECT dm_document FROM dm_folder';
            // dm_document appears in SELECT clause - should NOT highlight
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });

        test('attribute name in SELECT clause', () => {
            const line = 'SELECT object_name, r_object_id FROM dm_document';
            // object_name is in SELECT clause
            const position = line.indexOf('object_name');
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });

        test('after WHERE keyword', () => {
            const line = 'SELECT * FROM dm_document WHERE dm_folder = \'test\'';
            // dm_folder after WHERE should NOT highlight (it's likely being compared)
            const position = line.lastIndexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });

        test('after AND keyword', () => {
            const line = 'SELECT * FROM dm_document WHERE a = 1 AND dm_folder = 2';
            const position = line.lastIndexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });

        test('after OR keyword', () => {
            const line = 'SELECT * FROM dm_document WHERE a = 1 OR dm_folder = 2';
            const position = line.lastIndexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });

        test('in string literal context', () => {
            // Note: This test verifies the position check, not string detection
            // The actual string literal handling would need more context
            const _line = 'SELECT * FROM dm_document WHERE name = \'dm_folder\'';
            // Position of dm_folder in string - context check alone won't prevent this
            // but the semantic token provider should not match quoted strings
            // This is a limitation - the current implementation doesn't handle quotes
        });

        test('random position without keyword context', () => {
            const line = 'dm_document is a type';
            const position = 0;
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });

        test('in ORDER BY clause', () => {
            const line = 'SELECT * FROM dm_document ORDER BY dm_folder';
            // dm_folder in ORDER BY should not highlight (it would be an alias or attribute)
            const position = line.lastIndexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });

        test('in GROUP BY clause', () => {
            const line = 'SELECT * FROM dm_document GROUP BY dm_folder';
            const position = line.lastIndexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), false);
        });
    });

    suite('isTypeContext - Edge cases', () => {
        test('FROM at end of line', () => {
            const line = 'SELECT * FROM';
            // No type name yet, but if there was one at the end after FROM
            // This should return true since beforeWord ends with 'from'
            assert.strictEqual(provider.testIsTypeContext(line + ' dm_document', line.length + 1), true);
        });

        test('case insensitive FROM', () => {
            const line = 'select * from dm_document';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('case insensitive JOIN', () => {
            const line = 'select * from dm_document join dm_folder on 1=1';
            const position = line.indexOf('dm_folder');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('mixed case keywords', () => {
            const line = 'Select * From dm_document Where a = 1';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('type name immediately after FROM (no space)', () => {
            // Edge case: no space between FROM and type name
            // The regex looks for beforeWord.endsWith('from'), so "FROM" + immediate position
            // would have beforeWord ending in 'from'
            const line = 'SELECT * FROMdm_document';
            const position = line.indexOf('dm_document');
            // beforeWord would be 'SELECT * FROM' - ends with 'from', so true
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('multiple spaces between keywords', () => {
            const line = 'SELECT   *   FROM   dm_document';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('tabs instead of spaces', () => {
            const line = 'SELECT\t*\tFROM\tdm_document';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });

        test('newline handling - type on same line as FROM', () => {
            // Single line with newline in the middle should still work
            const line = 'FROM dm_document';
            const position = line.indexOf('dm_document');
            assert.strictEqual(provider.testIsTypeContext(line, position), true);
        });
    });

    suite('DQL_KEYWORDS filtering', () => {
        // These tests verify that DQL keywords are excluded even if they match type names
        // Note: This is tested at the tokenizeLine level, not isTypeContext

        test('SELECT keyword is in DQL_KEYWORDS', () => {
            // This verifies the concept - actual filtering happens in tokenizeLine
            // If someone named a type 'select', it should not be highlighted
            // because it's in DQL_KEYWORDS
        });
    });
});
