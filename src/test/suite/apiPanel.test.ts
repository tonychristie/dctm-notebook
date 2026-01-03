import * as assert from 'assert';

/**
 * Tests for ApiPanel helper functions
 *
 * Note: Full integration tests require a running VS Code instance.
 * These unit tests focus on the pure logic functions that can be tested in isolation.
 */
suite('ApiPanel Test Suite', () => {

    suite('extractObjectIdFromArg', () => {
        /**
         * Helper function that mirrors the logic in registerApiPanel's executeApiOnObject command.
         * Extracts objectId from various argument types passed to the command.
         */
        function extractObjectIdFromArg(arg?: unknown): string | undefined {
            if (typeof arg === 'string') {
                // Direct string objectId passed
                return arg;
            } else if (arg && typeof arg === 'object') {
                // ObjectBrowserItem from context menu - extract objectId from data
                const item = arg as { data?: { objectId?: string } };
                if (item.data && typeof item.data.objectId === 'string') {
                    return item.data.objectId;
                }
            }
            return undefined;
        }

        test('extracts objectId from direct string argument', () => {
            const result = extractObjectIdFromArg('0900000180001234');
            assert.strictEqual(result, '0900000180001234');
        });

        test('extracts objectId from ObjectBrowserItem structure', () => {
            const item = {
                data: {
                    objectId: '0900000180005678',
                    name: 'test.doc',
                    type: 'document'
                }
            };
            const result = extractObjectIdFromArg(item);
            assert.strictEqual(result, '0900000180005678');
        });

        test('returns undefined for null argument', () => {
            const result = extractObjectIdFromArg(null);
            assert.strictEqual(result, undefined);
        });

        test('returns undefined for undefined argument', () => {
            const result = extractObjectIdFromArg(undefined);
            assert.strictEqual(result, undefined);
        });

        test('returns undefined for object without data property', () => {
            const result = extractObjectIdFromArg({ someOtherProp: 'value' });
            assert.strictEqual(result, undefined);
        });

        test('returns undefined for object with data but no objectId', () => {
            const result = extractObjectIdFromArg({ data: { name: 'test' } });
            assert.strictEqual(result, undefined);
        });

        test('returns undefined for object with non-string objectId', () => {
            const result = extractObjectIdFromArg({ data: { objectId: 12345 } });
            assert.strictEqual(result, undefined);
        });

        test('handles empty string objectId', () => {
            const result = extractObjectIdFromArg('');
            assert.strictEqual(result, '');
        });

        test('handles nested ObjectBrowserItem with full data', () => {
            // Simulates actual ObjectBrowserItem from tree view
            const item = {
                data: {
                    id: 'test-connection::document::0900000180001234',
                    name: 'Important Document.pdf',
                    type: 'document',
                    objectId: '0900000180001234',
                    objectType: 'dm_document',
                    format: 'pdf',
                    parentId: '0c00000180000100',
                    connectionName: 'test-connection'
                },
                collapsibleState: 0,
                contextValue: 'document'
            };
            const result = extractObjectIdFromArg(item);
            assert.strictEqual(result, '0900000180001234');
        });
    });

    suite('Object ID detection in results', () => {
        // Test the isObjectId logic used in formatResultWithLinks
        function isObjectId(value: string): boolean {
            return /^[0-9a-f]{16}$/i.test(value);
        }

        test('recognizes valid 16-character hex object IDs', () => {
            assert.strictEqual(isObjectId('0900000000000001'), true);
            assert.strictEqual(isObjectId('0c00000000000001'), true);
            assert.strictEqual(isObjectId('0900abcdef123456'), true);
            assert.strictEqual(isObjectId('ABCDEF0123456789'), true);
            assert.strictEqual(isObjectId('abcdef0123456789'), true);
        });

        test('rejects invalid object IDs', () => {
            assert.strictEqual(isObjectId('090000000000001'), false); // 15 chars
            assert.strictEqual(isObjectId('09000000000000001'), false); // 17 chars
            assert.strictEqual(isObjectId('0900000000000g01'), false); // invalid char 'g'
            assert.strictEqual(isObjectId(''), false);
            assert.strictEqual(isObjectId('not-an-object-id'), false);
            assert.strictEqual(isObjectId('0900-0000-0000-0001'), false); // with dashes
        });
    });

    suite('formatResultWithLinks', () => {
        // Simulate the escapeHtml function from the webview
        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        // Simulate the formatResultWithLinks function from the webview
        function formatResultWithLinks(text: string): string {
            return text.replace(/\b([0-9a-f]{16})\b/gi, (match) => {
                return `<span class="object-id" data-object-id="${escapeHtml(match)}">${escapeHtml(match)}</span>`;
            });
        }

        test('wraps single object ID with clickable span', () => {
            const input = '0900000000000001';
            const result = formatResultWithLinks(input);
            assert.strictEqual(
                result,
                '<span class="object-id" data-object-id="0900000000000001">0900000000000001</span>'
            );
        });

        test('wraps multiple object IDs in text', () => {
            const input = 'Parent: 0900000000000001, Child: 0900000000000002';
            const result = formatResultWithLinks(input);
            assert.ok(result.includes('<span class="object-id" data-object-id="0900000000000001">0900000000000001</span>'));
            assert.ok(result.includes('<span class="object-id" data-object-id="0900000000000002">0900000000000002</span>'));
        });

        test('preserves text without object IDs', () => {
            const input = 'This is just plain text without any IDs';
            const result = formatResultWithLinks(input);
            assert.strictEqual(result, input);
        });

        test('handles object ID in JSON structure', () => {
            const input = '{\n  "r_object_id": "0900000000000001",\n  "object_name": "test"\n}';
            const result = formatResultWithLinks(input);
            assert.ok(result.includes('<span class="object-id" data-object-id="0900000000000001">0900000000000001</span>'));
            assert.ok(result.includes('"object_name": "test"'));
        });

        test('handles uppercase object IDs', () => {
            const input = 'ABCDEF0123456789';
            const result = formatResultWithLinks(input);
            assert.strictEqual(
                result,
                '<span class="object-id" data-object-id="ABCDEF0123456789">ABCDEF0123456789</span>'
            );
        });

        test('handles mixed case object IDs', () => {
            const input = 'AbCdEf0123456789';
            const result = formatResultWithLinks(input);
            assert.strictEqual(
                result,
                '<span class="object-id" data-object-id="AbCdEf0123456789">AbCdEf0123456789</span>'
            );
        });

        test('does not match partial hex strings', () => {
            const input = 'prefix0900000000000001suffix'; // No word boundary
            const result = formatResultWithLinks(input);
            // Should not wrap because there's no word boundary
            assert.strictEqual(result, input);
        });

        test('handles empty string', () => {
            const input = '';
            const result = formatResultWithLinks(input);
            assert.strictEqual(result, '');
        });

        test('handles null result formatted as string', () => {
            const input = 'null';
            const result = formatResultWithLinks(input);
            assert.strictEqual(result, 'null');
        });
    });

    suite('escapeHtml', () => {
        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        test('escapes ampersand', () => {
            assert.strictEqual(escapeHtml('foo & bar'), 'foo &amp; bar');
        });

        test('escapes less than', () => {
            assert.strictEqual(escapeHtml('foo < bar'), 'foo &lt; bar');
        });

        test('escapes greater than', () => {
            assert.strictEqual(escapeHtml('foo > bar'), 'foo &gt; bar');
        });

        test('escapes double quote', () => {
            assert.strictEqual(escapeHtml('foo "bar"'), 'foo &quot;bar&quot;');
        });

        test('escapes single quote', () => {
            assert.strictEqual(escapeHtml("foo 'bar'"), 'foo &#039;bar&#039;');
        });

        test('escapes multiple special characters', () => {
            assert.strictEqual(
                escapeHtml('<script>alert("xss")</script>'),
                '&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'
            );
        });

        test('preserves normal text', () => {
            assert.strictEqual(escapeHtml('Hello World'), 'Hello World');
        });

        test('handles empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });
    });

    suite('WebviewMessage type validation', () => {
        // Test that message types are correctly structured
        type WebviewMessageType = 'execute' | 'getMethodInfo' | 'searchMethods' | 'getCategories' | 'dumpObject';

        function isValidMessageType(type: string): type is WebviewMessageType {
            return ['execute', 'getMethodInfo', 'searchMethods', 'getCategories', 'dumpObject'].includes(type);
        }

        test('recognizes valid message types', () => {
            assert.strictEqual(isValidMessageType('execute'), true);
            assert.strictEqual(isValidMessageType('getMethodInfo'), true);
            assert.strictEqual(isValidMessageType('searchMethods'), true);
            assert.strictEqual(isValidMessageType('getCategories'), true);
            assert.strictEqual(isValidMessageType('dumpObject'), true);
        });

        test('rejects invalid message types', () => {
            assert.strictEqual(isValidMessageType('invalid'), false);
            assert.strictEqual(isValidMessageType(''), false);
            assert.strictEqual(isValidMessageType('EXECUTE'), false); // case-sensitive
        });
    });
});
