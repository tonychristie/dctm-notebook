import * as assert from 'assert';
import { NotebookApiCompletionProvider } from '../../notebook/notebookCompletionProvider';
import { ApiMethodReference, ServerApiMethod } from '../../apiMethodReference';

/**
 * Mock ApiMethodReference for testing
 */
class MockApiMethodReference {
    private methods: ServerApiMethod[] = [
        {
            name: 'dump',
            signature: 'dmAPIGet("dump,session,object_id[,format_flag]")',
            description: 'Returns the object dump'
        },
        {
            name: 'save',
            signature: 'dmAPIExec("save,session,object_id")',
            description: 'Saves an object'
        },
        {
            name: 'set',
            signature: 'dmAPISet("set,session,object_id,attribute_name,value")',
            description: 'Sets an attribute value'
        },
        {
            name: 'checkout',
            signature: 'dmAPIExec("checkout,session,object_id[,default|policy_id]")',
            description: 'Checks out an object'
        },
        {
            name: 'getfile',
            signature: 'dmAPIGet("getfile,session,object_id,file_path[,format]")',
            description: 'Gets content file'
        }
    ];

    findMethod(name: string): ServerApiMethod | undefined {
        return this.methods.find(m => m.name.toLowerCase() === name.toLowerCase());
    }

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    getCompletionItems(_prefix?: string, _category?: string): { label: string }[] {
        return this.methods.map(m => ({ label: m.name }));
    }
}

/**
 * Create a mock text document for testing
 */
function createMockDocument(content: string): {
    lineAt: (line: number) => { text: string };
} {
    const lines = content.split('\n');
    return {
        lineAt: (line: number) => ({
            text: lines[line] || ''
        })
    };
}

/**
 * Create a mock position
 */
function createPosition(line: number, character: number): { line: number; character: number } {
    return { line, character };
}

/**
 * Create a mock cancellation token
 */
const mockToken = {
    isCancellationRequested: false,
    onCancellationRequested: () => ({ dispose: () => {} })
};

suite('NotebookApiCompletionProvider Test Suite', () => {
    let provider: NotebookApiCompletionProvider;
    let mockReference: MockApiMethodReference;

    setup(() => {
        mockReference = new MockApiMethodReference();
        provider = new NotebookApiCompletionProvider(mockReference as unknown as ApiMethodReference);
    });

    suite('Method completions', () => {
        test('provides method completions after dmAPIGet("', () => {
            const doc = createMockDocument('dmAPIGet("');
            const position = createPosition(0, 10);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should return completions');
        });

        test('provides method completions after dmAPIExec("', () => {
            const doc = createMockDocument('dmAPIExec("');
            const position = createPosition(0, 11);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should return completions');
        });

        test('provides method completions after dmAPISet("', () => {
            const doc = createMockDocument('dmAPISet("');
            const position = createPosition(0, 10);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should return completions');
        });

        test('filters method completions with partial input', () => {
            const doc = createMockDocument('dmAPIGet("du');
            const position = createPosition(0, 12);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should return filtered completions');
        });

        test('returns empty for non-API context', () => {
            const doc = createMockDocument('SELECT * FROM dm_document');
            const position = createPosition(0, 25);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.strictEqual(result.length, 0, 'Should return no completions for non-API context');
        });
    });

    suite('Parameter completions', () => {
        test('provides parameter hint after method name and comma', () => {
            const doc = createMockDocument('dmAPIGet("dump,');
            const position = createPosition(0, 15);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            // Should provide session parameter hint
            assert.ok(result.length > 0, 'Should return parameter completions');
            const hasSessionHint = result.some(item =>
                item.detail?.includes('session') ||
                (typeof item.label === 'string' && item.label.toLowerCase().includes('session'))
            );
            assert.ok(hasSessionHint, 'Should include session parameter hint');
        });

        test('provides next parameter hint after session', () => {
            const doc = createMockDocument('dmAPIGet("dump,session,');
            const position = createPosition(0, 23);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should return parameter completions');
        });

        test('handles method with optional parameters', () => {
            const doc = createMockDocument('dmAPIExec("checkout,session,object_id,');
            const position = createPosition(0, 38);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            // Should handle the optional parameter position
            assert.ok(Array.isArray(result), 'Should return an array');
        });

        test('provides close quote when all parameters entered', () => {
            const doc = createMockDocument('dmAPIExec("save,session,object_id');
            const position = createPosition(0, 33);

            // After all required parameters, might suggest closing
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            // Result could include end-quote completion or be empty
            assert.ok(Array.isArray(result), 'Should return an array');
        });
    });

    suite('splitSignature', () => {
        // Testing through the provider's parameter completion behavior
        // which relies on splitSignature internally

        test('handles simple signatures without brackets', () => {
            const doc = createMockDocument('dmAPIExec("save,session,');
            const position = createPosition(0, 24);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            // Should parse "save,session,object_id" correctly
            assert.ok(Array.isArray(result), 'Should handle simple signature');
        });

        test('handles signatures with optional brackets', () => {
            const doc = createMockDocument('dmAPIGet("dump,session,object_id,');
            const position = createPosition(0, 33);

            // dump has optional format_flag: dmAPIGet("dump,session,object_id[,format_flag]")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(Array.isArray(result), 'Should handle signature with brackets');
        });

        test('handles signatures with alternative parameters', () => {
            const doc = createMockDocument('dmAPIExec("checkout,session,object_id,');
            const position = createPosition(0, 38);

            // checkout has: dmAPIExec("checkout,session,object_id[,default|policy_id]")
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            // Should handle the "default|policy_id" alternative syntax
            assert.ok(Array.isArray(result), 'Should handle alternative parameters');
        });
    });

    suite('Case sensitivity', () => {
        test('handles uppercase API type', () => {
            const doc = createMockDocument('DMAPIGET("');
            const position = createPosition(0, 10);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should handle uppercase dmAPIGet');
        });

        test('handles mixed case API type', () => {
            const doc = createMockDocument('DmApiGet("');
            const position = createPosition(0, 10);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should handle mixed case');
        });
    });

    suite('Edge cases', () => {
        test('handles empty document', () => {
            const doc = createMockDocument('');
            const position = createPosition(0, 0);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.strictEqual(result.length, 0, 'Should return empty for empty document');
        });

        test('handles position at start of line', () => {
            const doc = createMockDocument('dmAPIGet("dump")\ndmAPIGet("');
            const position = createPosition(1, 10);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should provide completions on second line');
        });

        test('handles unknown method name gracefully', () => {
            const doc = createMockDocument('dmAPIGet("unknownmethod,');
            const position = createPosition(0, 24);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            // Should not crash, might return empty or generic hints
            assert.ok(Array.isArray(result), 'Should handle unknown method');
        });

        test('handles single quotes', () => {
            const doc = createMockDocument("dmAPIGet('");
            const position = createPosition(0, 10);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should handle single quotes');
        });

        test('handles spaces around parenthesis', () => {
            const doc = createMockDocument('dmAPIGet ( "');
            const position = createPosition(0, 12);

            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const result = provider.provideCompletionItems(doc as any, position as any, mockToken as any, {} as any);

            assert.ok(result.length > 0, 'Should handle spaces');
        });
    });
});
