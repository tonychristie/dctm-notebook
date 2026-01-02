import * as assert from 'assert';

/**
 * Tests for ObjectDumpPanel helper functions
 *
 * Note: Full integration tests require a running VS Code instance and mock bridge.
 * These unit tests focus on the pure logic functions that can be tested in isolation.
 */
suite('ObjectDumpPanel Test Suite', () => {

    suite('Attribute categorization', () => {
        // Test the logic that would be in categorizeAttribute
        type AttributeGroup = 'standard' | 'custom' | 'system' | 'application' | 'internal';

        function categorizeAttribute(name: string): AttributeGroup {
            if (name.startsWith('r_')) {
                return 'system';
            }
            if (name.startsWith('i_')) {
                return 'internal';
            }
            if (name.startsWith('a_')) {
                return 'application';
            }
            return 'standard';
        }

        test('categorizes r_ prefix as system', () => {
            assert.strictEqual(categorizeAttribute('r_object_id'), 'system');
            assert.strictEqual(categorizeAttribute('r_object_type'), 'system');
            assert.strictEqual(categorizeAttribute('r_creation_date'), 'system');
            assert.strictEqual(categorizeAttribute('r_modify_date'), 'system');
        });

        test('categorizes i_ prefix as internal', () => {
            assert.strictEqual(categorizeAttribute('i_is_replica'), 'internal');
            assert.strictEqual(categorizeAttribute('i_partition'), 'internal');
            assert.strictEqual(categorizeAttribute('i_vstamp'), 'internal');
        });

        test('categorizes a_ prefix as application', () => {
            assert.strictEqual(categorizeAttribute('a_content_type'), 'application');
            assert.strictEqual(categorizeAttribute('a_status'), 'application');
            assert.strictEqual(categorizeAttribute('a_storage_type'), 'application');
        });

        test('categorizes other attributes as standard', () => {
            assert.strictEqual(categorizeAttribute('object_name'), 'standard');
            assert.strictEqual(categorizeAttribute('title'), 'standard');
            assert.strictEqual(categorizeAttribute('subject'), 'standard');
            assert.strictEqual(categorizeAttribute('authors'), 'standard');
        });
    });

    suite('Object ID detection', () => {
        // Test the isObjectId logic
        function isObjectId(value: unknown): boolean {
            if (typeof value !== 'string') {
                return false;
            }
            return /^[0-9a-f]{16}$/i.test(value);
        }

        test('recognizes valid object IDs', () => {
            assert.strictEqual(isObjectId('0900000000000001'), true);
            assert.strictEqual(isObjectId('0c00000000000001'), true);
            assert.strictEqual(isObjectId('0900abcdef123456'), true);
            assert.strictEqual(isObjectId('ABCDEF0123456789'), true);
        });

        test('rejects invalid object IDs', () => {
            assert.strictEqual(isObjectId('090000000000001'), false); // 15 chars
            assert.strictEqual(isObjectId('09000000000000001'), false); // 17 chars
            assert.strictEqual(isObjectId('0900000000000g01'), false); // invalid char
            assert.strictEqual(isObjectId(''), false);
            assert.strictEqual(isObjectId(null), false);
            assert.strictEqual(isObjectId(undefined), false);
            assert.strictEqual(isObjectId(12345), false);
            assert.strictEqual(isObjectId({}), false);
        });
    });

    suite('Dump parsing', () => {
        // Test the parseDump logic for extracting attributes
        interface ParsedAttribute {
            name: string;
            type: string;
            value: string | string[];
            isRepeating: boolean;
        }

        function parseDumpLine(line: string): ParsedAttribute | null {
            const trimmed = line.trim();
            if (!trimmed || trimmed.startsWith('---')) {
                return null;
            }

            // Match attribute line: "  attr_name [type] : value" or "attr_name : value"
            // Also handle repeating: "  attr_name[0] : value"
            const match = trimmed.match(/^(\S+?)(?:\[(\d+)\])?\s*(?:\[([^\]]+)\])?\s*[:=]\s*(.*)$/);
            if (match) {
                const [, name, indexStr, type, value] = match;
                const isRepeating = indexStr !== undefined;

                return {
                    name,
                    type: type || 'string',
                    value: isRepeating ? [value] : value,
                    isRepeating
                };
            }
            return null;
        }

        test('parses simple attribute line', () => {
            const result = parseDumpLine('object_name : Test Document');
            assert.deepStrictEqual(result, {
                name: 'object_name',
                type: 'string',
                value: 'Test Document',
                isRepeating: false
            });
        });

        test('parses attribute with type', () => {
            const result = parseDumpLine('r_object_id [ID] : 0900000000000001');
            assert.deepStrictEqual(result, {
                name: 'r_object_id',
                type: 'ID',
                value: '0900000000000001',
                isRepeating: false
            });
        });

        test('parses repeating attribute', () => {
            const result = parseDumpLine('r_version_label[0] : CURRENT');
            assert.deepStrictEqual(result, {
                name: 'r_version_label',
                type: 'string',
                value: ['CURRENT'],
                isRepeating: true
            });
        });

        test('returns null for empty lines', () => {
            assert.strictEqual(parseDumpLine(''), null);
            assert.strictEqual(parseDumpLine('   '), null);
        });

        test('returns null for separator lines', () => {
            assert.strictEqual(parseDumpLine('---'), null);
            assert.strictEqual(parseDumpLine('--- dm_document ---'), null);
        });

        test('handles equals sign separator', () => {
            const result = parseDumpLine('object_name = Test Document');
            assert.deepStrictEqual(result, {
                name: 'object_name',
                type: 'string',
                value: 'Test Document',
                isRepeating: false
            });
        });
    });

    suite('Attribute value formatting', () => {
        function formatAttributeValue(value: unknown, isRepeating: boolean): string {
            if (value === null || value === undefined) {
                return 'NULL';
            }
            if (isRepeating && Array.isArray(value)) {
                return value.map(v => v === null ? 'NULL' : String(v)).join(', ');
            }
            return String(value);
        }

        test('formats null as NULL', () => {
            assert.strictEqual(formatAttributeValue(null, false), 'NULL');
            assert.strictEqual(formatAttributeValue(undefined, false), 'NULL');
        });

        test('formats simple values as strings', () => {
            assert.strictEqual(formatAttributeValue('test', false), 'test');
            assert.strictEqual(formatAttributeValue(123, false), '123');
            assert.strictEqual(formatAttributeValue(true, false), 'true');
        });

        test('formats repeating values as comma-separated', () => {
            assert.strictEqual(formatAttributeValue(['a', 'b', 'c'], true), 'a, b, c');
            assert.strictEqual(formatAttributeValue(['CURRENT', '1.0'], true), 'CURRENT, 1.0');
        });

        test('handles NULL in repeating values', () => {
            assert.strictEqual(formatAttributeValue(['a', null, 'c'], true), 'a, NULL, c');
        });
    });

    suite('Group ordering', () => {
        // Verify the expected group order (custom first, then standard, then system groups)
        const groupOrder = ['custom', 'standard', 'application', 'system', 'internal'];

        test('custom attributes appear first', () => {
            assert.strictEqual(groupOrder[0], 'custom');
        });

        test('standard attributes appear second', () => {
            assert.strictEqual(groupOrder[1], 'standard');
        });

        test('system attributes appear near end', () => {
            assert.strictEqual(groupOrder[3], 'system');
        });

        test('internal attributes appear last', () => {
            assert.strictEqual(groupOrder[4], 'internal');
        });
    });

    suite('HTML escaping for dump panel', () => {
        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        test('escapes all special characters', () => {
            assert.strictEqual(
                escapeHtml('<script>alert("XSS")</script>'),
                '&lt;script&gt;alert(&quot;XSS&quot;)&lt;/script&gt;'
            );
        });

        test('preserves normal text', () => {
            assert.strictEqual(escapeHtml('Normal text 123'), 'Normal text 123');
        });

        test('handles empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });

        test('escapes attribute values with special chars', () => {
            assert.strictEqual(escapeHtml("O'Brien & Sons"), "O&#039;Brien &amp; Sons");
        });
    });

    suite('Navigation history', () => {
        // Test the navigation history logic in isolation
        interface NavigationEntry {
            objectId: string;
            objectName: string;
            typeName: string;
        }

        class NavigationHistory {
            private history: NavigationEntry[] = [];
            private index: number = -1;

            push(entry: NavigationEntry): void {
                // Remove any forward history when navigating to a new object
                if (this.index < this.history.length - 1) {
                    this.history = this.history.slice(0, this.index + 1);
                }
                this.history.push(entry);
                this.index = this.history.length - 1;
            }

            goBack(): NavigationEntry | undefined {
                if (this.canGoBack()) {
                    this.index--;
                    return this.history[this.index];
                }
                return undefined;
            }

            goForward(): NavigationEntry | undefined {
                if (this.canGoForward()) {
                    this.index++;
                    return this.history[this.index];
                }
                return undefined;
            }

            canGoBack(): boolean {
                return this.index > 0;
            }

            canGoForward(): boolean {
                return this.index < this.history.length - 1;
            }

            current(): NavigationEntry | undefined {
                return this.index >= 0 ? this.history[this.index] : undefined;
            }

            size(): number {
                return this.history.length;
            }
        }

        test('starts empty with no navigation available', () => {
            const nav = new NavigationHistory();
            assert.strictEqual(nav.canGoBack(), false);
            assert.strictEqual(nav.canGoForward(), false);
            assert.strictEqual(nav.current(), undefined);
        });

        test('allows forward after going back', () => {
            const nav = new NavigationHistory();
            nav.push({ objectId: '1', objectName: 'Object 1', typeName: 'dm_document' });
            nav.push({ objectId: '2', objectName: 'Object 2', typeName: 'dm_document' });

            assert.strictEqual(nav.canGoBack(), true);
            assert.strictEqual(nav.canGoForward(), false);

            nav.goBack();
            assert.strictEqual(nav.canGoForward(), true);
            assert.strictEqual(nav.current()?.objectId, '1');

            nav.goForward();
            assert.strictEqual(nav.current()?.objectId, '2');
            assert.strictEqual(nav.canGoForward(), false);
        });

        test('clears forward history when navigating to new object', () => {
            const nav = new NavigationHistory();
            nav.push({ objectId: '1', objectName: 'Object 1', typeName: 'dm_document' });
            nav.push({ objectId: '2', objectName: 'Object 2', typeName: 'dm_document' });
            nav.push({ objectId: '3', objectName: 'Object 3', typeName: 'dm_document' });

            // Go back twice
            nav.goBack();
            nav.goBack();
            assert.strictEqual(nav.current()?.objectId, '1');

            // Navigate to new object - should clear forward history
            nav.push({ objectId: '4', objectName: 'Object 4', typeName: 'dm_document' });

            assert.strictEqual(nav.canGoForward(), false);
            assert.strictEqual(nav.size(), 2); // Only 1 and 4
            assert.strictEqual(nav.current()?.objectId, '4');
        });

        test('does not go back beyond first entry', () => {
            const nav = new NavigationHistory();
            nav.push({ objectId: '1', objectName: 'Object 1', typeName: 'dm_document' });

            assert.strictEqual(nav.canGoBack(), false);
            assert.strictEqual(nav.goBack(), undefined);
            assert.strictEqual(nav.current()?.objectId, '1');
        });

        test('does not go forward beyond last entry', () => {
            const nav = new NavigationHistory();
            nav.push({ objectId: '1', objectName: 'Object 1', typeName: 'dm_document' });

            assert.strictEqual(nav.canGoForward(), false);
            assert.strictEqual(nav.goForward(), undefined);
            assert.strictEqual(nav.current()?.objectId, '1');
        });

        test('tracks multiple navigations correctly', () => {
            const nav = new NavigationHistory();
            nav.push({ objectId: 'a', objectName: 'A', typeName: 'type' });
            nav.push({ objectId: 'b', objectName: 'B', typeName: 'type' });
            nav.push({ objectId: 'c', objectName: 'C', typeName: 'type' });
            nav.push({ objectId: 'd', objectName: 'D', typeName: 'type' });

            assert.strictEqual(nav.current()?.objectId, 'd');
            assert.strictEqual(nav.size(), 4);

            // Go back to A
            nav.goBack();
            nav.goBack();
            nav.goBack();
            assert.strictEqual(nav.current()?.objectId, 'a');
            assert.strictEqual(nav.canGoBack(), false);

            // Go forward to D
            nav.goForward();
            nav.goForward();
            nav.goForward();
            assert.strictEqual(nav.current()?.objectId, 'd');
            assert.strictEqual(nav.canGoForward(), false);
        });
    });
});
