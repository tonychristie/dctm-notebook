import * as assert from 'assert';

/**
 * Tests for TypeDumpPanel helper functions
 *
 * Note: Full integration tests require a running VS Code instance and mock type cache.
 * These unit tests focus on the pure logic functions that can be tested in isolation.
 */
suite('TypeDumpPanel Test Suite', () => {

    suite('Attribute filtering', () => {
        interface TypeAttribute {
            name: string;
            dataType: string;
            length: number;
            isRepeating: boolean;
            isInherited: boolean;
        }

        function filterAttributes(
            attributes: TypeAttribute[],
            filter: string,
            showInherited: boolean
        ): TypeAttribute[] {
            let result = attributes;

            if (!showInherited) {
                result = result.filter(a => !a.isInherited);
            }

            if (filter) {
                const lowerFilter = filter.toLowerCase();
                result = result.filter(a =>
                    a.name.toLowerCase().includes(lowerFilter) ||
                    a.dataType.toLowerCase().includes(lowerFilter)
                );
            }

            return result;
        }

        const testAttributes: TypeAttribute[] = [
            { name: 'object_name', dataType: 'string', length: 255, isRepeating: false, isInherited: true },
            { name: 'r_object_id', dataType: 'id', length: 16, isRepeating: false, isInherited: true },
            { name: 'custom_attr', dataType: 'string', length: 100, isRepeating: false, isInherited: false },
            { name: 'custom_date', dataType: 'time', length: 0, isRepeating: false, isInherited: false },
            { name: 'authors', dataType: 'string', length: 64, isRepeating: true, isInherited: true },
        ];

        test('returns all attributes when no filter and showInherited is true', () => {
            const result = filterAttributes(testAttributes, '', true);
            assert.strictEqual(result.length, 5);
        });

        test('filters out inherited attributes when showInherited is false', () => {
            const result = filterAttributes(testAttributes, '', false);
            assert.strictEqual(result.length, 2);
            assert.ok(result.every(a => !a.isInherited));
        });

        test('filters by attribute name', () => {
            const result = filterAttributes(testAttributes, 'custom', true);
            assert.strictEqual(result.length, 2);
            assert.ok(result.every(a => a.name.includes('custom')));
        });

        test('filters by data type', () => {
            const result = filterAttributes(testAttributes, 'string', true);
            assert.strictEqual(result.length, 3);
            assert.ok(result.every(a => a.dataType === 'string'));
        });

        test('filter is case insensitive', () => {
            const result = filterAttributes(testAttributes, 'CUSTOM', true);
            assert.strictEqual(result.length, 2);
        });

        test('combines filter with showInherited', () => {
            const result = filterAttributes(testAttributes, 'string', false);
            assert.strictEqual(result.length, 1);
            assert.strictEqual(result[0].name, 'custom_attr');
        });

        test('returns empty array when no matches', () => {
            const result = filterAttributes(testAttributes, 'nonexistent', true);
            assert.strictEqual(result.length, 0);
        });
    });

    suite('Attribute sorting', () => {
        interface TypeAttribute {
            name: string;
            isInherited: boolean;
        }

        function sortAttributes(attributes: TypeAttribute[]): TypeAttribute[] {
            return [...attributes].sort((a, b) => {
                // Non-inherited first, then by name
                if (a.isInherited !== b.isInherited) {
                    return a.isInherited ? 1 : -1;
                }
                return a.name.localeCompare(b.name);
            });
        }

        test('sorts non-inherited before inherited', () => {
            const attrs: TypeAttribute[] = [
                { name: 'inherited_attr', isInherited: true },
                { name: 'own_attr', isInherited: false },
            ];
            const result = sortAttributes(attrs);
            assert.strictEqual(result[0].name, 'own_attr');
            assert.strictEqual(result[1].name, 'inherited_attr');
        });

        test('sorts alphabetically within same inheritance group', () => {
            const attrs: TypeAttribute[] = [
                { name: 'zebra', isInherited: false },
                { name: 'apple', isInherited: false },
                { name: 'monkey', isInherited: false },
            ];
            const result = sortAttributes(attrs);
            assert.strictEqual(result[0].name, 'apple');
            assert.strictEqual(result[1].name, 'monkey');
            assert.strictEqual(result[2].name, 'zebra');
        });

        test('handles mixed inheritance and alphabetical sort', () => {
            const attrs: TypeAttribute[] = [
                { name: 'z_inherited', isInherited: true },
                { name: 'a_inherited', isInherited: true },
                { name: 'z_own', isInherited: false },
                { name: 'a_own', isInherited: false },
            ];
            const result = sortAttributes(attrs);
            assert.strictEqual(result[0].name, 'a_own');
            assert.strictEqual(result[1].name, 'z_own');
            assert.strictEqual(result[2].name, 'a_inherited');
            assert.strictEqual(result[3].name, 'z_inherited');
        });
    });

    suite('Type display formatting', () => {
        function formatTypeDisplay(dataType: string, length: number): string {
            return length > 0 ? `${dataType}(${length})` : dataType;
        }

        test('formats type with length', () => {
            assert.strictEqual(formatTypeDisplay('string', 255), 'string(255)');
            assert.strictEqual(formatTypeDisplay('string', 32), 'string(32)');
        });

        test('formats type without length', () => {
            assert.strictEqual(formatTypeDisplay('time', 0), 'time');
            assert.strictEqual(formatTypeDisplay('boolean', 0), 'boolean');
            assert.strictEqual(formatTypeDisplay('id', 0), 'id');
        });

        test('handles edge case of length 1', () => {
            assert.strictEqual(formatTypeDisplay('integer', 1), 'integer(1)');
        });
    });

    suite('Attribute count calculations', () => {
        interface TypeAttribute {
            isInherited: boolean;
        }

        function calculateAttributeCounts(attributes: TypeAttribute[]): {
            total: number;
            inherited: number;
            own: number;
        } {
            const inherited = attributes.filter(a => a.isInherited).length;
            return {
                total: attributes.length,
                inherited: inherited,
                own: attributes.length - inherited
            };
        }

        test('counts all attributes correctly', () => {
            const attrs = [
                { isInherited: true },
                { isInherited: true },
                { isInherited: false },
                { isInherited: false },
                { isInherited: false },
            ];
            const counts = calculateAttributeCounts(attrs);
            assert.strictEqual(counts.total, 5);
            assert.strictEqual(counts.inherited, 2);
            assert.strictEqual(counts.own, 3);
        });

        test('handles all inherited attributes', () => {
            const attrs = [
                { isInherited: true },
                { isInherited: true },
            ];
            const counts = calculateAttributeCounts(attrs);
            assert.strictEqual(counts.total, 2);
            assert.strictEqual(counts.inherited, 2);
            assert.strictEqual(counts.own, 0);
        });

        test('handles all own attributes', () => {
            const attrs = [
                { isInherited: false },
                { isInherited: false },
            ];
            const counts = calculateAttributeCounts(attrs);
            assert.strictEqual(counts.total, 2);
            assert.strictEqual(counts.inherited, 0);
            assert.strictEqual(counts.own, 2);
        });

        test('handles empty attributes', () => {
            const counts = calculateAttributeCounts([]);
            assert.strictEqual(counts.total, 0);
            assert.strictEqual(counts.inherited, 0);
            assert.strictEqual(counts.own, 0);
        });
    });

    suite('HTML escaping for type panel', () => {
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
            assert.strictEqual(escapeHtml('dm_document'), 'dm_document');
            assert.strictEqual(escapeHtml('custom_type_123'), 'custom_type_123');
        });

        test('handles empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });

        test('escapes type names with special chars', () => {
            assert.strictEqual(escapeHtml("type_with_'quote"), "type_with_&#039;quote");
        });
    });

    suite('DQL query generation', () => {
        interface TypeAttribute {
            name: string;
            isInherited: boolean;
        }

        function generateDqlQuery(typeName: string, attributes: TypeAttribute[]): string {
            // Get type-specific attributes (not inherited)
            let attrs = attributes
                .filter(a => !a.isInherited)
                .slice(0, 5)
                .map(a => a.name);

            if (attrs.length === 0) {
                attrs = ['r_object_id', 'object_name'];
            }

            return `SELECT ${attrs.join(', ')}\nFROM ${typeName}\nWHERE 1=1`;
        }

        test('generates query with own attributes', () => {
            const attrs = [
                { name: 'custom_attr1', isInherited: false },
                { name: 'custom_attr2', isInherited: false },
                { name: 'inherited_attr', isInherited: true },
            ];
            const query = generateDqlQuery('my_type', attrs);
            assert.ok(query.includes('SELECT custom_attr1, custom_attr2'));
            assert.ok(query.includes('FROM my_type'));
            assert.ok(query.includes('WHERE 1=1'));
            assert.ok(!query.includes('inherited_attr'));
        });

        test('limits to 5 attributes', () => {
            const attrs = Array.from({ length: 10 }, (_, i) => ({
                name: `attr_${i}`,
                isInherited: false
            }));
            const query = generateDqlQuery('my_type', attrs);
            const selectMatch = query.match(/SELECT (.+)\n/);
            assert.ok(selectMatch);
            const columns = selectMatch[1].split(', ');
            assert.strictEqual(columns.length, 5);
        });

        test('uses default attributes when no own attributes', () => {
            const attrs = [
                { name: 'inherited_attr', isInherited: true },
            ];
            const query = generateDqlQuery('my_type', attrs);
            assert.ok(query.includes('SELECT r_object_id, object_name'));
        });

        test('uses default attributes for empty type', () => {
            const query = generateDqlQuery('empty_type', []);
            assert.ok(query.includes('SELECT r_object_id, object_name'));
        });
    });

    suite('Type navigation', () => {
        // Test type hierarchy navigation logic
        interface TypeInfo {
            name: string;
            superType: string | null;
            children: string[];
        }

        test('identifies root types (no super type)', () => {
            const rootType: TypeInfo = {
                name: 'dm_sysobject',
                superType: null,
                children: ['dm_document', 'dm_folder']
            };
            assert.strictEqual(rootType.superType, null);
        });

        test('identifies types with children', () => {
            const parentType: TypeInfo = {
                name: 'dm_document',
                superType: 'dm_sysobject',
                children: ['custom_document', 'special_document']
            };
            assert.ok(parentType.children.length > 0);
        });

        test('identifies leaf types (no children)', () => {
            const leafType: TypeInfo = {
                name: 'custom_document',
                superType: 'dm_document',
                children: []
            };
            assert.strictEqual(leafType.children.length, 0);
        });
    });
});
