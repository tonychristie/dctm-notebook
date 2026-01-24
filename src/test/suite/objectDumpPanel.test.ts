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

        test('parses continuation line format', () => {
            // Continuation lines start with [index] and are used for additional values
            // of repeating attributes in Documentum dump output
            const contMatch = '[1] [string] : CURRENT'.match(/^\[(\d+)\]\s*(?:\[([^\]]+)\])?\s*[:=]\s*(.*)$/);
            assert.ok(contMatch, 'Should match continuation line format');
            assert.strictEqual(contMatch[1], '1');
            assert.strictEqual(contMatch[2], 'string');
            assert.strictEqual(contMatch[3], 'CURRENT');
        });

        test('parses continuation line without type', () => {
            const contMatch = '[2] = third_value'.match(/^\[(\d+)\]\s*(?:\[([^\]]+)\])?\s*[:=]\s*(.*)$/);
            assert.ok(contMatch, 'Should match continuation line without type');
            assert.strictEqual(contMatch[1], '2');
            assert.strictEqual(contMatch[2], undefined);
            assert.strictEqual(contMatch[3], 'third_value');
        });
    });

    suite('Multi-line dump parsing', () => {
        // Test the full parseDump behavior with multi-line input
        type AttributeGroup = 'standard' | 'custom' | 'system' | 'application' | 'internal';

        interface AttributeInfo {
            name: string;
            type: string;
            value: unknown;
            isRepeating: boolean;
            group: AttributeGroup;
        }

        function categorizeAttribute(name: string): AttributeGroup {
            if (name.startsWith('r_')) {return 'system';}
            if (name.startsWith('i_')) {return 'internal';}
            if (name.startsWith('a_')) {return 'application';}
            return 'standard';
        }

        /**
         * Simplified version of parseDump for testing the core logic
         */
        function parseDump(dumpText: string): AttributeInfo[] {
            const attributes: AttributeInfo[] = [];
            const lines = dumpText.split('\n');
            const repeatingAttrs = new Map<string, AttributeInfo>();
            let lastAttrName: string | undefined;

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed || trimmed.startsWith('---')) {continue;}

                // Check for continuation line format: "[index] [type] : value"
                const contMatch = trimmed.match(/^\[(\d+)\]\s*(?:\[([^\]]+)\])?\s*[:=]\s*(.*)$/);
                if (contMatch) {
                    // If there's no previous attribute, skip orphaned continuation lines
                    if (!lastAttrName) {
                        continue;
                    }
                    const [, indexStr, type, rawValue] = contMatch;
                    const index = parseInt(indexStr);

                    let existing = repeatingAttrs.get(lastAttrName);
                    if (!existing) {
                        existing = attributes.find(a => a.name === lastAttrName);
                        if (existing) {
                            existing.isRepeating = true;
                            const currentVal = existing.value;
                            existing.value = Array.isArray(currentVal) ? currentVal : [currentVal];
                            repeatingAttrs.set(lastAttrName, existing);
                        }
                    }

                    if (existing && Array.isArray(existing.value)) {
                        const values = existing.value as string[];
                        while (values.length <= index) {values.push('');}
                        values[index] = rawValue;
                        if (type && existing.type === 'string') {existing.type = type;}
                    }
                    continue;
                }

                // Standard attribute line
                const match = trimmed.match(/^(\S+?)(?:\[(\d+)\])?\s*(?:\[([^\]]+)\])?\s*[:=]\s*(.*)$/);
                if (match) {
                    const [, name, indexStr, type, rawValue] = match;
                    const index = indexStr ? parseInt(indexStr) : undefined;
                    const isRepeating = index !== undefined;
                    lastAttrName = name;
                    const group = categorizeAttribute(name);

                    if (isRepeating) {
                        const existing = repeatingAttrs.get(name);
                        if (existing && Array.isArray(existing.value)) {
                            const values = existing.value as string[];
                            while (values.length <= index) {values.push('');}
                            values[index] = rawValue;
                            if (type && existing.type === 'string') {existing.type = type;}
                            continue;
                        }

                        const values: string[] = [];
                        while (values.length <= index) {values.push('');}
                        values[index] = rawValue;

                        const attr: AttributeInfo = {
                            name, type: type || 'string', value: values, isRepeating: true, group
                        };
                        attributes.push(attr);
                        repeatingAttrs.set(name, attr);
                    } else {
                        attributes.push({
                            name, type: type || 'string', value: rawValue, isRepeating: false, group
                        });
                    }
                }
            }

            return attributes;
        }

        test('parses repeating attribute with continuation lines', () => {
            const dump = `r_version_label[0] : 1.0
[1] : CURRENT`;
            const result = parseDump(dump);
            const attr = result.find(a => a.name === 'r_version_label');
            assert.ok(attr, 'Should find r_version_label');
            assert.strictEqual(attr.isRepeating, true);
            assert.deepStrictEqual(attr.value, ['1.0', 'CURRENT']);
        });

        test('handles out-of-order indices', () => {
            const dump = `r_version_label[1] : CURRENT
r_version_label[0] : 1.0`;
            const result = parseDump(dump);
            const attr = result.find(a => a.name === 'r_version_label');
            assert.ok(attr, 'Should find r_version_label');
            assert.strictEqual(attr.isRepeating, true);
            assert.deepStrictEqual(attr.value, ['1.0', 'CURRENT']);
        });

        test('parses continuation line that follows non-indexed attribute', () => {
            // This tests the case where the first line has no index but subsequent lines do
            const dump = `keywords : first_keyword
[1] : second_keyword
[2] : third_keyword`;
            const result = parseDump(dump);
            const attr = result.find(a => a.name === 'keywords');
            assert.ok(attr, 'Should find keywords');
            assert.strictEqual(attr.isRepeating, true);
            // First value was at implicit index 0
            assert.deepStrictEqual(attr.value, ['first_keyword', 'second_keyword', 'third_keyword']);
        });

        test('does not treat [index] as attribute when no previous attribute', () => {
            // If [index] appears at the start with no previous attribute, it should be ignored
            const dump = `[1] : orphan_value
object_name : test`;
            const result = parseDump(dump);
            // Should only have object_name, not [1] as an attribute
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'object_name');
        });

        test('handles multiple repeating attributes', () => {
            const dump = `r_version_label[0] : 1.0
[1] : CURRENT
keywords[0] : tag1
[1] : tag2
[2] : tag3`;
            const result = parseDump(dump);

            const versionLabel = result.find(a => a.name === 'r_version_label');
            assert.ok(versionLabel);
            assert.deepStrictEqual(versionLabel.value, ['1.0', 'CURRENT']);

            const keywords = result.find(a => a.name === 'keywords');
            assert.ok(keywords);
            assert.deepStrictEqual(keywords.value, ['tag1', 'tag2', 'tag3']);
        });

        test('mixes repeating and non-repeating attributes', () => {
            const dump = `object_name : My Document
r_version_label[0] : 1.0
[1] : CURRENT
title : Document Title`;
            const result = parseDump(dump);

            assert.strictEqual(result.length, 3);

            const name = result.find(a => a.name === 'object_name');
            assert.ok(name);
            assert.strictEqual(name.isRepeating, false);
            assert.strictEqual(name.value, 'My Document');

            const version = result.find(a => a.name === 'r_version_label');
            assert.ok(version);
            assert.strictEqual(version.isRepeating, true);
            assert.deepStrictEqual(version.value, ['1.0', 'CURRENT']);

            const title = result.find(a => a.name === 'title');
            assert.ok(title);
            assert.strictEqual(title.isRepeating, false);
            assert.strictEqual(title.value, 'Document Title');
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
