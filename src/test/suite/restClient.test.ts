import * as assert from 'assert';

/**
 * Tests for RestClient
 *
 * Note: Full integration tests require a running REST server.
 * These unit tests focus on the pure logic functions that can be tested in isolation.
 */
suite('RestClient Test Suite', () => {

    suite('Session ID format', () => {
        // The session ID format is: rest:<repository>:<timestamp>
        function parseSessionId(sessionId: string): { type: string; repository: string; timestamp: number } | null {
            const parts = sessionId.split(':');
            if (parts.length !== 3 || parts[0] !== 'rest') {
                return null;
            }
            return {
                type: parts[0],
                repository: parts[1],
                timestamp: parseInt(parts[2], 10)
            };
        }

        test('valid session ID format', () => {
            const sessionId = 'rest:EDMS:1234567890';
            const parsed = parseSessionId(sessionId);

            assert.ok(parsed !== null, 'Should parse valid session ID');
            assert.strictEqual(parsed!.type, 'rest');
            assert.strictEqual(parsed!.repository, 'EDMS');
            assert.strictEqual(parsed!.timestamp, 1234567890);
        });

        test('invalid session ID returns null', () => {
            const invalidIds = [
                'dfc:EDMS:123',  // wrong type
                'rest:EDMS',     // missing timestamp
                'rest',          // missing all parts
                '',              // empty
            ];

            for (const id of invalidIds) {
                const parsed = parseSessionId(id);
                assert.strictEqual(parsed, null, `Should return null for: ${id}`);
            }
        });

        test('session ID with special repository name', () => {
            const sessionId = 'rest:MyDocbase123:9999';
            const parsed = parseSessionId(sessionId);

            assert.ok(parsed !== null);
            assert.strictEqual(parsed!.repository, 'MyDocbase123');
        });
    });

    suite('Endpoint URL normalization', () => {
        function normalizeEndpoint(endpoint: string): string {
            return endpoint.replace(/\/$/, ''); // Remove trailing slash
        }

        test('removes trailing slash', () => {
            assert.strictEqual(
                normalizeEndpoint('http://localhost:8080/dctm-rest/'),
                'http://localhost:8080/dctm-rest'
            );
        });

        test('preserves URL without trailing slash', () => {
            assert.strictEqual(
                normalizeEndpoint('http://localhost:8080/dctm-rest'),
                'http://localhost:8080/dctm-rest'
            );
        });

        test('handles multiple trailing slashes', () => {
            // Only removes one trailing slash (standard behavior)
            assert.strictEqual(
                normalizeEndpoint('http://localhost:8080/dctm-rest//'),
                'http://localhost:8080/dctm-rest/'
            );
        });

        test('handles empty string', () => {
            assert.strictEqual(normalizeEndpoint(''), '');
        });
    });

    suite('DQL result transformation', () => {
        // This mirrors the logic in RestClient.executeDql
        interface RestEntry {
            content?: {
                properties?: Record<string, unknown>;
            };
        }

        interface DqlQueryResult {
            columns: string[];
            rows: Record<string, unknown>[];
            rowCount: number;
        }

        function transformDqlResponse(entries: RestEntry[]): DqlQueryResult {
            const columns: string[] = [];
            const rows: Record<string, unknown>[] = [];

            if (entries.length > 0) {
                const firstEntry = entries[0];
                if (firstEntry.content?.properties) {
                    Object.keys(firstEntry.content.properties).forEach(key => {
                        columns.push(key);
                    });
                }

                entries.forEach((entry: RestEntry) => {
                    if (entry.content?.properties) {
                        rows.push(entry.content.properties);
                    }
                });
            }

            return {
                columns,
                rows,
                rowCount: rows.length
            };
        }

        test('transforms empty response', () => {
            const result = transformDqlResponse([]);

            assert.deepStrictEqual(result.columns, []);
            assert.deepStrictEqual(result.rows, []);
            assert.strictEqual(result.rowCount, 0);
        });

        test('extracts columns from first entry', () => {
            const entries: RestEntry[] = [
                { content: { properties: { r_object_id: '0c123', object_name: 'Doc1' } } },
                { content: { properties: { r_object_id: '0c456', object_name: 'Doc2' } } }
            ];

            const result = transformDqlResponse(entries);

            assert.ok(result.columns.includes('r_object_id'));
            assert.ok(result.columns.includes('object_name'));
            assert.strictEqual(result.columns.length, 2);
        });

        test('transforms all entries to rows', () => {
            const entries: RestEntry[] = [
                { content: { properties: { r_object_id: '0c123', object_name: 'Doc1' } } },
                { content: { properties: { r_object_id: '0c456', object_name: 'Doc2' } } },
                { content: { properties: { r_object_id: '0c789', object_name: 'Doc3' } } }
            ];

            const result = transformDqlResponse(entries);

            assert.strictEqual(result.rowCount, 3);
            assert.strictEqual(result.rows[0].r_object_id, '0c123');
            assert.strictEqual(result.rows[1].object_name, 'Doc2');
            assert.strictEqual(result.rows[2].r_object_id, '0c789');
        });

        test('handles entries without properties', () => {
            const entries: RestEntry[] = [
                { content: { properties: { r_object_id: '0c123' } } },
                { content: {} },  // No properties
                { }  // No content
            ];

            const result = transformDqlResponse(entries);

            assert.strictEqual(result.rowCount, 1);
            assert.strictEqual(result.rows[0].r_object_id, '0c123');
        });

        test('handles various property types', () => {
            const entries: RestEntry[] = [
                {
                    content: {
                        properties: {
                            string_val: 'hello',
                            int_val: 42,
                            bool_val: true,
                            null_val: null,
                            array_val: ['a', 'b', 'c']
                        }
                    }
                }
            ];

            const result = transformDqlResponse(entries);

            assert.strictEqual(result.rows[0].string_val, 'hello');
            assert.strictEqual(result.rows[0].int_val, 42);
            assert.strictEqual(result.rows[0].bool_val, true);
            assert.strictEqual(result.rows[0].null_val, null);
            assert.deepStrictEqual(result.rows[0].array_val, ['a', 'b', 'c']);
        });
    });

    suite('Error message formatting', () => {
        // Error messages for unsupported operations
        const DMAPI_ERROR = 'dmAPI commands require a DFC connection. Switch to a DFC connection or use DQL instead.';
        const API_METHOD_ERROR = 'Direct API method execution requires a DFC connection. Use REST-specific endpoints or switch to a DFC connection.';

        test('dmAPI error message is user-friendly', () => {
            assert.ok(DMAPI_ERROR.includes('DFC connection'), 'Should mention DFC');
            assert.ok(DMAPI_ERROR.includes('DQL'), 'Should suggest DQL alternative');
            assert.ok(!DMAPI_ERROR.includes('Error:'), 'Should not have redundant Error prefix');
        });

        test('API method error message is user-friendly', () => {
            assert.ok(API_METHOD_ERROR.includes('DFC connection'), 'Should mention DFC');
            assert.ok(API_METHOD_ERROR.includes('REST-specific'), 'Should suggest REST alternatives');
        });
    });

    suite('Connection type detection', () => {
        // Helper to detect connection type from session ID
        function getConnectionTypeFromSessionId(sessionId: string): 'dfc' | 'rest' | null {
            if (sessionId.startsWith('rest:')) {
                return 'rest';
            } else if (sessionId && !sessionId.includes(':')) {
                // DFC session IDs are typically plain UUIDs
                return 'dfc';
            }
            return null;
        }

        test('detects REST session ID', () => {
            assert.strictEqual(getConnectionTypeFromSessionId('rest:EDMS:123'), 'rest');
        });

        test('detects DFC session ID', () => {
            assert.strictEqual(getConnectionTypeFromSessionId('abc123def456'), 'dfc');
        });

        test('returns null for empty', () => {
            assert.strictEqual(getConnectionTypeFromSessionId(''), null);
        });
    });

    suite('REST endpoint paths', () => {
        // Verify correct endpoint path construction
        function buildRepositoryPath(repository: string): string {
            return `/repositories/${repository}`;
        }

        function buildDqlPath(repository: string): string {
            return `/repositories/${repository}`;
        }

        function buildTypesPath(repository: string): string {
            return `/repositories/${repository}/types`;
        }

        function buildTypeDetailPath(repository: string, typeName: string): string {
            return `/repositories/${repository}/types/${typeName}`;
        }

        function buildCurrentUserPath(repository: string): string {
            return `/repositories/${repository}/currentuser`;
        }

        test('repository path', () => {
            assert.strictEqual(buildRepositoryPath('EDMS'), '/repositories/EDMS');
        });

        test('DQL path (same as repository, uses query param)', () => {
            assert.strictEqual(buildDqlPath('EDMS'), '/repositories/EDMS');
        });

        test('types path', () => {
            assert.strictEqual(buildTypesPath('EDMS'), '/repositories/EDMS/types');
        });

        test('type detail path', () => {
            assert.strictEqual(buildTypeDetailPath('EDMS', 'dm_document'), '/repositories/EDMS/types/dm_document');
        });

        test('current user path', () => {
            assert.strictEqual(buildCurrentUserPath('EDMS'), '/repositories/EDMS/currentuser');
        });

        test('handles repository names with special characters', () => {
            // Repository names typically follow naming conventions
            assert.strictEqual(buildRepositoryPath('My_Docbase_1'), '/repositories/My_Docbase_1');
        });
    });
});
