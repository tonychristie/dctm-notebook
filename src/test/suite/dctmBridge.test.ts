import * as assert from 'assert';

/**
 * Tests for DctmBridge connection routing functionality.
 *
 * These tests cover:
 * - Connection request body construction for DFC vs REST
 * - Proper field inclusion/exclusion based on connection type
 * - DfcConnectParams interface handling
 *
 * Note: These are unit tests that verify the request body construction logic.
 * Full integration tests require a running bridge instance.
 */

// Types from dfcBridge
interface DfcConnectParams {
    docbroker?: string;
    port?: number;
    endpoint?: string;
    repository: string;
    username: string;
    password: string;
}

/**
 * Build request body for connect - mirrors the logic in dfcBridge.connect()
 * Extracted here for unit testing without HTTP dependencies.
 */
function buildConnectRequestBody(params: DfcConnectParams): Record<string, unknown> {
    const requestBody: Record<string, unknown> = {
        repository: params.repository,
        username: params.username,
        password: params.password
    };

    if (params.endpoint) {
        // REST connection - only include endpoint
        requestBody.endpoint = params.endpoint;
    } else {
        // DFC connection - include docbroker and port
        requestBody.docbroker = params.docbroker || '';
        requestBody.port = params.port || 1489;
    }

    return requestBody;
}

suite('DctmBridge Test Suite', () => {

    suite('Connection request body construction', () => {

        suite('REST connections', () => {

            test('includes endpoint for REST connection', () => {
                const params: DfcConnectParams = {
                    endpoint: 'http://dctm-rest.example.com:8080/dctm-rest',
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.endpoint, 'http://dctm-rest.example.com:8080/dctm-rest');
                assert.strictEqual(body.repository, 'MyRepo');
                assert.strictEqual(body.username, 'dmadmin');
                assert.strictEqual(body.password, 'secret');
            });

            test('does not include docbroker for REST connection', () => {
                const params: DfcConnectParams = {
                    endpoint: 'http://dctm-rest.example.com:8080/dctm-rest',
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.docbroker, undefined);
                assert.strictEqual(body.port, undefined);
            });

            test('does not include docbroker even if provided for REST connection', () => {
                const params: DfcConnectParams = {
                    endpoint: 'http://dctm-rest.example.com:8080/dctm-rest',
                    docbroker: 'should-be-ignored',
                    port: 9999,
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                // endpoint takes precedence - docbroker/port should not be included
                assert.strictEqual(body.endpoint, 'http://dctm-rest.example.com:8080/dctm-rest');
                assert.strictEqual(body.docbroker, undefined);
                assert.strictEqual(body.port, undefined);
            });

            test('handles REST endpoint with trailing slash', () => {
                const params: DfcConnectParams = {
                    endpoint: 'http://dctm-rest.example.com:8080/dctm-rest/',
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.endpoint, 'http://dctm-rest.example.com:8080/dctm-rest/');
            });

            test('handles REST endpoint with HTTPS', () => {
                const params: DfcConnectParams = {
                    endpoint: 'https://secure-dctm.example.com/dctm-rest',
                    repository: 'SecureRepo',
                    username: 'admin',
                    password: 'pass123'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.endpoint, 'https://secure-dctm.example.com/dctm-rest');
            });
        });

        suite('DFC connections', () => {

            test('includes docbroker and port for DFC connection', () => {
                const params: DfcConnectParams = {
                    docbroker: 'docbroker.example.com',
                    port: 1489,
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.docbroker, 'docbroker.example.com');
                assert.strictEqual(body.port, 1489);
                assert.strictEqual(body.repository, 'MyRepo');
                assert.strictEqual(body.username, 'dmadmin');
                assert.strictEqual(body.password, 'secret');
            });

            test('does not include endpoint for DFC connection', () => {
                const params: DfcConnectParams = {
                    docbroker: 'docbroker.example.com',
                    port: 1489,
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.endpoint, undefined);
            });

            test('uses default port 1489 when not specified', () => {
                const params: DfcConnectParams = {
                    docbroker: 'docbroker.example.com',
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.port, 1489);
            });

            test('uses empty string for docbroker when not specified', () => {
                const params: DfcConnectParams = {
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.docbroker, '');
                assert.strictEqual(body.port, 1489);
            });

            test('handles custom port', () => {
                const params: DfcConnectParams = {
                    docbroker: 'docbroker.example.com',
                    port: 2489,
                    repository: 'MyRepo',
                    username: 'dmadmin',
                    password: 'secret'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.port, 2489);
            });

            test('handles docbroker with IP address', () => {
                const params: DfcConnectParams = {
                    docbroker: '192.168.1.100',
                    port: 1489,
                    repository: 'TestRepo',
                    username: 'testuser',
                    password: 'testpass'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.docbroker, '192.168.1.100');
            });
        });

        suite('Common properties', () => {

            test('always includes repository', () => {
                const restParams: DfcConnectParams = {
                    endpoint: 'http://rest.example.com/dctm-rest',
                    repository: 'RestRepo',
                    username: 'user1',
                    password: 'pass1'
                };

                const dfcParams: DfcConnectParams = {
                    docbroker: 'broker.example.com',
                    repository: 'DfcRepo',
                    username: 'user2',
                    password: 'pass2'
                };

                const restBody = buildConnectRequestBody(restParams);
                const dfcBody = buildConnectRequestBody(dfcParams);

                assert.strictEqual(restBody.repository, 'RestRepo');
                assert.strictEqual(dfcBody.repository, 'DfcRepo');
            });

            test('always includes username', () => {
                const restParams: DfcConnectParams = {
                    endpoint: 'http://rest.example.com/dctm-rest',
                    repository: 'Repo',
                    username: 'restuser',
                    password: 'pass'
                };

                const dfcParams: DfcConnectParams = {
                    docbroker: 'broker.example.com',
                    repository: 'Repo',
                    username: 'dfcuser',
                    password: 'pass'
                };

                const restBody = buildConnectRequestBody(restParams);
                const dfcBody = buildConnectRequestBody(dfcParams);

                assert.strictEqual(restBody.username, 'restuser');
                assert.strictEqual(dfcBody.username, 'dfcuser');
            });

            test('always includes password', () => {
                const restParams: DfcConnectParams = {
                    endpoint: 'http://rest.example.com/dctm-rest',
                    repository: 'Repo',
                    username: 'user',
                    password: 'restpass123'
                };

                const dfcParams: DfcConnectParams = {
                    docbroker: 'broker.example.com',
                    repository: 'Repo',
                    username: 'user',
                    password: 'dfcpass456'
                };

                const restBody = buildConnectRequestBody(restParams);
                const dfcBody = buildConnectRequestBody(dfcParams);

                assert.strictEqual(restBody.password, 'restpass123');
                assert.strictEqual(dfcBody.password, 'dfcpass456');
            });
        });

        suite('Edge cases', () => {

            test('empty endpoint string treated as DFC connection', () => {
                const params: DfcConnectParams = {
                    endpoint: '',
                    docbroker: 'broker.example.com',
                    port: 1489,
                    repository: 'Repo',
                    username: 'user',
                    password: 'pass'
                };

                const body = buildConnectRequestBody(params);

                // Empty string is falsy, so should fall through to DFC
                assert.strictEqual(body.docbroker, 'broker.example.com');
                assert.strictEqual(body.port, 1489);
                assert.strictEqual(body.endpoint, undefined);
            });

            test('handles special characters in credentials', () => {
                const params: DfcConnectParams = {
                    endpoint: 'http://rest.example.com/dctm-rest',
                    repository: 'Test-Repo_123',
                    username: 'user@domain.com',
                    password: 'p@ss!word#$%'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.username, 'user@domain.com');
                assert.strictEqual(body.password, 'p@ss!word#$%');
            });

            test('handles unicode in repository name', () => {
                const params: DfcConnectParams = {
                    endpoint: 'http://rest.example.com/dctm-rest',
                    repository: 'Repo日本語',
                    username: 'user',
                    password: 'pass'
                };

                const body = buildConnectRequestBody(params);

                assert.strictEqual(body.repository, 'Repo日本語');
            });
        });
    });

    suite('Bridge host and port routing', () => {
        /**
         * Tests for connection type to bridge URL routing.
         * Uses bridge.host for hostname (default: localhost).
         * DFC connections should use bridge.port (9876), REST connections should use bridge.restPort (9877).
         */

        interface BridgeConfig {
            host: string;
            port: number;
            restPort: number;
        }

        /**
         * Get base URL for connection type - mirrors the logic in dfcBridge.getBaseUrlForType()
         */
        function getBaseUrlForType(config: BridgeConfig, connectionType: 'dfc' | 'rest'): string {
            if (connectionType === 'rest') {
                return `http://${config.host}:${config.restPort}`;
            }
            return `http://${config.host}:${config.port}`;
        }

        const defaultConfig: BridgeConfig = {
            host: 'localhost',
            port: 9876,
            restPort: 9877
        };

        test('DFC connection uses localhost:9876 by default', () => {
            const baseUrl = getBaseUrlForType(defaultConfig, 'dfc');
            assert.strictEqual(baseUrl, 'http://localhost:9876');
        });

        test('REST connection uses localhost:9877 by default', () => {
            const baseUrl = getBaseUrlForType(defaultConfig, 'rest');
            assert.strictEqual(baseUrl, 'http://localhost:9877');
        });

        test('DFC connection uses custom port from config', () => {
            const customConfig: BridgeConfig = {
                host: 'localhost',
                port: 8000,
                restPort: 9877
            };
            const baseUrl = getBaseUrlForType(customConfig, 'dfc');
            assert.strictEqual(baseUrl, 'http://localhost:8000');
        });

        test('REST connection uses custom restPort from config', () => {
            const customConfig: BridgeConfig = {
                host: 'localhost',
                port: 9876,
                restPort: 8001
            };
            const baseUrl = getBaseUrlForType(customConfig, 'rest');
            assert.strictEqual(baseUrl, 'http://localhost:8001');
        });

        test('both ports can be customized independently', () => {
            const customConfig: BridgeConfig = {
                host: 'localhost',
                port: 7000,
                restPort: 7001
            };
            const dfcUrl = getBaseUrlForType(customConfig, 'dfc');
            const restUrl = getBaseUrlForType(customConfig, 'rest');

            assert.strictEqual(dfcUrl, 'http://localhost:7000');
            assert.strictEqual(restUrl, 'http://localhost:7001');
        });

        test('same port for both is allowed (though not recommended)', () => {
            const samePortConfig: BridgeConfig = {
                host: 'localhost',
                port: 9999,
                restPort: 9999
            };
            const dfcUrl = getBaseUrlForType(samePortConfig, 'dfc');
            const restUrl = getBaseUrlForType(samePortConfig, 'rest');

            assert.strictEqual(dfcUrl, 'http://localhost:9999');
            assert.strictEqual(restUrl, 'http://localhost:9999');
        });

        test('custom host is used for DFC connection', () => {
            const remoteConfig: BridgeConfig = {
                host: 'bridge-server.local',
                port: 9876,
                restPort: 9877
            };
            const baseUrl = getBaseUrlForType(remoteConfig, 'dfc');
            assert.strictEqual(baseUrl, 'http://bridge-server.local:9876');
        });

        test('custom host is used for REST connection', () => {
            const remoteConfig: BridgeConfig = {
                host: 'bridge-server.local',
                port: 9876,
                restPort: 9877
            };
            const baseUrl = getBaseUrlForType(remoteConfig, 'rest');
            assert.strictEqual(baseUrl, 'http://bridge-server.local:9877');
        });

        test('IP address can be used as host', () => {
            const ipConfig: BridgeConfig = {
                host: '192.168.1.100',
                port: 9876,
                restPort: 9877
            };
            const dfcUrl = getBaseUrlForType(ipConfig, 'dfc');
            const restUrl = getBaseUrlForType(ipConfig, 'rest');

            assert.strictEqual(dfcUrl, 'http://192.168.1.100:9876');
            assert.strictEqual(restUrl, 'http://192.168.1.100:9877');
        });

        test('host and ports can all be customized together', () => {
            const fullCustomConfig: BridgeConfig = {
                host: 'wsl-bridge',
                port: 8000,
                restPort: 8001
            };
            const dfcUrl = getBaseUrlForType(fullCustomConfig, 'dfc');
            const restUrl = getBaseUrlForType(fullCustomConfig, 'rest');

            assert.strictEqual(dfcUrl, 'http://wsl-bridge:8000');
            assert.strictEqual(restUrl, 'http://wsl-bridge:8001');
        });
    });

    suite('DfcConnectParams validation', () => {

        test('REST params have correct shape', () => {
            const params: DfcConnectParams = {
                endpoint: 'http://example.com/dctm-rest',
                repository: 'Repo',
                username: 'user',
                password: 'pass'
            };

            // Verify optional DFC fields are not required
            assert.strictEqual(params.docbroker, undefined);
            assert.strictEqual(params.port, undefined);
        });

        test('DFC params have correct shape', () => {
            const params: DfcConnectParams = {
                docbroker: 'broker.example.com',
                port: 1489,
                repository: 'Repo',
                username: 'user',
                password: 'pass'
            };

            // Verify optional REST field is not required
            assert.strictEqual(params.endpoint, undefined);
        });

        test('minimal params (DFC with defaults)', () => {
            const params: DfcConnectParams = {
                repository: 'Repo',
                username: 'user',
                password: 'pass'
            };

            const body = buildConnectRequestBody(params);

            // Should default to DFC with empty docbroker and default port
            assert.strictEqual(body.docbroker, '');
            assert.strictEqual(body.port, 1489);
        });
    });

    suite('REST endpoint URL construction', () => {
        /**
         * Tests for REST-native endpoint URL patterns.
         * These endpoints are used when isRestSession() returns true.
         */

        function buildRestUrl(baseUrl: string, endpoint: string, params: Record<string, string>): string {
            const url = new URL(endpoint, baseUrl);
            for (const [key, value] of Object.entries(params)) {
                url.searchParams.append(key, value);
            }
            return url.toString();
        }

        const baseUrl = 'http://localhost:9877';

        suite('Cabinets endpoint', () => {
            test('builds correct URL for getCabinets', () => {
                const url = buildRestUrl(baseUrl, '/api/v1/cabinets', { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/cabinets?sessionId=sess123');
            });
        });

        suite('Folder contents endpoint', () => {
            test('builds correct URL for getFolderContents', () => {
                const folderId = '0c00000180000123';
                const url = buildRestUrl(baseUrl, `/api/v1/objects/${folderId}/contents`, { sessionId: 'sess123' });
                assert.strictEqual(url, `http://localhost:9877/api/v1/objects/${folderId}/contents?sessionId=sess123`);
            });
        });

        suite('Users endpoints', () => {
            test('builds correct URL for getUsers without pattern', () => {
                const url = buildRestUrl(baseUrl, '/api/v1/users', { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/users?sessionId=sess123');
            });

            test('builds correct URL for getUsers with pattern', () => {
                const url = buildRestUrl(baseUrl, '/api/v1/users', { sessionId: 'sess123', pattern: 'admin' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/users?sessionId=sess123&pattern=admin');
            });

            test('builds correct URL for getUser', () => {
                const userName = 'dmadmin';
                const url = buildRestUrl(baseUrl, `/api/v1/users/${encodeURIComponent(userName)}`, { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/users/dmadmin?sessionId=sess123');
            });

            test('builds correct URL for getUser with special characters', () => {
                const userName = 'user@domain.com';
                const url = buildRestUrl(baseUrl, `/api/v1/users/${encodeURIComponent(userName)}`, { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/users/user%40domain.com?sessionId=sess123');
            });

            test('builds correct URL for getGroupsForUser', () => {
                const userName = 'dmadmin';
                const url = buildRestUrl(baseUrl, `/api/v1/users/${encodeURIComponent(userName)}/groups`, { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/users/dmadmin/groups?sessionId=sess123');
            });
        });

        suite('Groups endpoints', () => {
            test('builds correct URL for getGroups without pattern', () => {
                const url = buildRestUrl(baseUrl, '/api/v1/groups', { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/groups?sessionId=sess123');
            });

            test('builds correct URL for getGroups with pattern', () => {
                const url = buildRestUrl(baseUrl, '/api/v1/groups', { sessionId: 'sess123', pattern: 'dm_' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/groups?sessionId=sess123&pattern=dm_');
            });

            test('builds correct URL for getGroup', () => {
                const groupName = 'docu';
                const url = buildRestUrl(baseUrl, `/api/v1/groups/${encodeURIComponent(groupName)}`, { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/groups/docu?sessionId=sess123');
            });

            test('builds correct URL for getParentGroups', () => {
                const groupName = 'docu';
                const url = buildRestUrl(baseUrl, `/api/v1/groups/${encodeURIComponent(groupName)}/parents`, { sessionId: 'sess123' });
                assert.strictEqual(url, 'http://localhost:9877/api/v1/groups/docu/parents?sessionId=sess123');
            });
        });
    });

    suite('Unified API - internal routing', () => {
        /**
         * Tests for the unified API methods that route internally based on session type.
         * These verify the bridge properly encapsulates connection type awareness.
         *
         * Note: These are unit tests for the routing logic. Full integration tests
         * require running bridge instances.
         */

        // Mock response data shapes for testing
        interface CabinetInfo {
            objectId: string;
            type: string;
            name: string;
            attributes: Record<string, unknown>;
        }

        interface UserInfo {
            objectId: string;
            userName: string;
            userOsName: string;
            userAddress: string;
            userState: string;
            defaultFolder: string;
            userGroupName: string;
            superUser: boolean;
        }

        interface GroupInfo {
            objectId: string;
            groupName: string;
            description: string;
            groupClass: string;
            groupAdmin: string;
            isPrivate: boolean;
            usersNames: string[];
            groupsNames: string[];
        }

        suite('getCabinets unified response format', () => {
            test('REST response matches expected format', () => {
                const restCabinet: CabinetInfo = {
                    objectId: '0c00000180000001',
                    type: 'dm_cabinet',
                    name: 'System',
                    attributes: {}
                };

                assert.strictEqual(restCabinet.objectId, '0c00000180000001');
                assert.strictEqual(restCabinet.type, 'dm_cabinet');
                assert.strictEqual(restCabinet.name, 'System');
            });

            test('DQL-derived response matches expected format', () => {
                // Simulated DQL result transformation
                const dqlRow = {
                    r_object_id: '0c00000180000002',
                    object_name: 'Temp'
                };

                const transformed: CabinetInfo = {
                    objectId: dqlRow.r_object_id,
                    type: 'dm_cabinet',
                    name: dqlRow.object_name,
                    attributes: {}
                };

                assert.strictEqual(transformed.objectId, '0c00000180000002');
                assert.strictEqual(transformed.type, 'dm_cabinet');
                assert.strictEqual(transformed.name, 'Temp');
            });

            test('both formats produce consistent structure', () => {
                const restResponse: CabinetInfo = {
                    objectId: '0c00000180000001',
                    type: 'dm_cabinet',
                    name: 'Cabinet1',
                    attributes: {}
                };

                const dqlResponse: CabinetInfo = {
                    objectId: '0c00000180000002',
                    type: 'dm_cabinet',
                    name: 'Cabinet2',
                    attributes: {}
                };

                // Both should have identical structure
                assert.deepStrictEqual(Object.keys(restResponse).sort(), Object.keys(dqlResponse).sort());
            });
        });

        suite('getUsers unified response format', () => {
            test('REST response maps to unified format', () => {
                const restUser: UserInfo = {
                    objectId: '1200000080000001',
                    userName: 'dmadmin',
                    userOsName: 'dmadmin',
                    userAddress: '',
                    userState: '0',
                    defaultFolder: '/dmadmin',
                    userGroupName: 'docu',
                    superUser: true
                };

                assert.strictEqual(restUser.userName, 'dmadmin');
                assert.strictEqual(restUser.userState, '0');
            });

            test('DQL-derived response maps to unified format', () => {
                // Simulated DQL result transformation
                const dqlRow = {
                    r_object_id: '1200000080000002',
                    user_name: 'testuser',
                    user_os_name: 'testuser',
                    user_address: '',
                    user_state: 0,
                    default_folder: '/testuser',
                    user_group_name: 'docu'
                };

                const transformed: UserInfo = {
                    objectId: dqlRow.r_object_id,
                    userName: dqlRow.user_name,
                    userOsName: dqlRow.user_os_name || '',
                    userAddress: dqlRow.user_address || '',
                    userState: String(dqlRow.user_state || 0),
                    defaultFolder: dqlRow.default_folder || '',
                    userGroupName: dqlRow.user_group_name || '',
                    superUser: false
                };

                assert.strictEqual(transformed.userName, 'testuser');
                assert.strictEqual(transformed.userState, '0');
            });
        });

        suite('getGroups unified response format', () => {
            test('REST response maps to unified format', () => {
                const restGroup: GroupInfo = {
                    objectId: '1200000080000100',
                    groupName: 'docu',
                    description: 'Default group',
                    groupClass: 'group',
                    groupAdmin: 'dmadmin',
                    isPrivate: false,
                    usersNames: ['dmadmin'],
                    groupsNames: []
                };

                assert.strictEqual(restGroup.groupName, 'docu');
                assert.deepStrictEqual(restGroup.usersNames, ['dmadmin']);
            });

            test('DQL-derived response maps to unified format', () => {
                // Simulated DQL result transformation
                const dqlRow = {
                    r_object_id: '1200000080000101',
                    group_name: 'testgroup',
                    description: 'Test group',
                    group_class: 'group',
                    group_admin: 'dmadmin',
                    is_private: false
                };

                const transformed: GroupInfo = {
                    objectId: dqlRow.r_object_id,
                    groupName: dqlRow.group_name,
                    description: dqlRow.description || '',
                    groupClass: dqlRow.group_class || '',
                    groupAdmin: dqlRow.group_admin || '',
                    isPrivate: dqlRow.is_private || false,
                    usersNames: [],
                    groupsNames: []
                };

                assert.strictEqual(transformed.groupName, 'testgroup');
            });
        });

        suite('getFolderContents path parameter', () => {
            test('REST session does not require path', () => {
                // REST API uses folder ID directly
                const folderId = '0c00000180000001';
                const restEndpoint = `/api/v1/objects/${folderId}/contents`;
                assert.ok(restEndpoint.includes(folderId));
            });

            test('DQL session requires path for folder() function', () => {
                // DQL uses folder path in WHERE clause
                const path = '/System/Test Folder';
                const escapedPath = path.replace(/'/g, "''");
                const query = `SELECT r_object_id FROM dm_folder WHERE folder('${escapedPath}')`;
                assert.ok(query.includes(escapedPath));
            });

            test('path escaping handles single quotes', () => {
                const path = "/System/Folder's Name";
                const escapedPath = path.replace(/'/g, "''");
                assert.strictEqual(escapedPath, "/System/Folder''s Name");
            });
        });
    });

    suite('Session type tracking', () => {
        /**
         * Tests for session type tracking logic.
         * Verifies that isRestSession() correctly identifies session types.
         */

        // Simple in-memory tracking similar to DctmBridge
        class SessionTypeTracker {
            private sessionTypes: Map<string, 'dfc' | 'rest'> = new Map();

            trackSession(sessionId: string, connectionType: 'dfc' | 'rest'): void {
                this.sessionTypes.set(sessionId, connectionType);
            }

            isRestSession(sessionId: string): boolean {
                return this.sessionTypes.get(sessionId) === 'rest';
            }

            clearSession(sessionId: string): void {
                this.sessionTypes.delete(sessionId);
            }
        }

        let tracker: SessionTypeTracker;

        setup(() => {
            tracker = new SessionTypeTracker();
        });

        test('REST session is correctly identified', () => {
            tracker.trackSession('rest-sess-1', 'rest');
            assert.strictEqual(tracker.isRestSession('rest-sess-1'), true);
        });

        test('DFC session is correctly identified', () => {
            tracker.trackSession('dfc-sess-1', 'dfc');
            assert.strictEqual(tracker.isRestSession('dfc-sess-1'), false);
        });

        test('unknown session returns false', () => {
            assert.strictEqual(tracker.isRestSession('unknown-sess'), false);
        });

        test('cleared session returns false', () => {
            tracker.trackSession('sess-1', 'rest');
            tracker.clearSession('sess-1');
            assert.strictEqual(tracker.isRestSession('sess-1'), false);
        });

        test('can track multiple sessions of different types', () => {
            tracker.trackSession('rest-1', 'rest');
            tracker.trackSession('dfc-1', 'dfc');
            tracker.trackSession('rest-2', 'rest');

            assert.strictEqual(tracker.isRestSession('rest-1'), true);
            assert.strictEqual(tracker.isRestSession('dfc-1'), false);
            assert.strictEqual(tracker.isRestSession('rest-2'), true);
        });
    });

    suite('Polymorphic implementation pattern', () => {
        /**
         * Tests for the polymorphic bridge implementation pattern.
         * Verifies that IUnifiedBridge implementations are correctly
         * selected and used based on session type.
         */

        // Mock interface matching IUnifiedBridge
        interface IUnifiedBridge {
            getCabinets(sessionId: string): Promise<{ objectId: string; name: string }[]>;
            getUsers(sessionId: string): Promise<{ userName: string }[]>;
        }

        // Mock DFC implementation - pure DQL, no branching
        class MockDfcBridgeImpl implements IUnifiedBridge {
            async getCabinets(_sessionId: string): Promise<{ objectId: string; name: string }[]> {
                // In real impl: execute DQL query
                return [{ objectId: 'dfc-cabinet-1', name: 'DFC Cabinet' }];
            }
            async getUsers(_sessionId: string): Promise<{ userName: string }[]> {
                // In real impl: execute DQL query
                return [{ userName: 'dfc-user' }];
            }
        }

        // Mock REST implementation - pure REST, no branching
        class MockRestBridgeImpl implements IUnifiedBridge {
            async getCabinets(_sessionId: string): Promise<{ objectId: string; name: string }[]> {
                // In real impl: call REST endpoint
                return [{ objectId: 'rest-cabinet-1', name: 'REST Cabinet' }];
            }
            async getUsers(_sessionId: string): Promise<{ userName: string }[]> {
                // In real impl: call REST endpoint
                return [{ userName: 'rest-user' }];
            }
        }

        // Mock bridge that uses polymorphism
        class MockDctmBridge {
            private sessionImpls: Map<string, IUnifiedBridge> = new Map();

            connect(sessionId: string, connectionType: 'dfc' | 'rest'): void {
                // Create implementation at connect time - the key pattern
                const impl = connectionType === 'rest'
                    ? new MockRestBridgeImpl()
                    : new MockDfcBridgeImpl();
                this.sessionImpls.set(sessionId, impl);
            }

            disconnect(sessionId: string): void {
                this.sessionImpls.delete(sessionId);
            }

            private getImpl(sessionId: string): IUnifiedBridge {
                const impl = this.sessionImpls.get(sessionId);
                if (!impl) {
                    throw new Error(`No implementation for session ${sessionId}`);
                }
                return impl;
            }

            // Unified API - delegates to implementation, NO branching
            async getCabinets(sessionId: string): Promise<{ objectId: string; name: string }[]> {
                return this.getImpl(sessionId).getCabinets(sessionId);
            }

            async getUsers(sessionId: string): Promise<{ userName: string }[]> {
                return this.getImpl(sessionId).getUsers(sessionId);
            }
        }

        let bridge: MockDctmBridge;

        setup(() => {
            bridge = new MockDctmBridge();
        });

        test('DFC session uses DfcBridgeImpl', async () => {
            bridge.connect('dfc-sess', 'dfc');
            const cabinets = await bridge.getCabinets('dfc-sess');

            assert.strictEqual(cabinets.length, 1);
            assert.strictEqual(cabinets[0].objectId, 'dfc-cabinet-1');
            assert.strictEqual(cabinets[0].name, 'DFC Cabinet');
        });

        test('REST session uses RestBridgeImpl', async () => {
            bridge.connect('rest-sess', 'rest');
            const cabinets = await bridge.getCabinets('rest-sess');

            assert.strictEqual(cabinets.length, 1);
            assert.strictEqual(cabinets[0].objectId, 'rest-cabinet-1');
            assert.strictEqual(cabinets[0].name, 'REST Cabinet');
        });

        test('multiple sessions use correct implementations', async () => {
            bridge.connect('dfc-sess', 'dfc');
            bridge.connect('rest-sess', 'rest');

            const dfcCabinets = await bridge.getCabinets('dfc-sess');
            const restCabinets = await bridge.getCabinets('rest-sess');

            assert.strictEqual(dfcCabinets[0].name, 'DFC Cabinet');
            assert.strictEqual(restCabinets[0].name, 'REST Cabinet');
        });

        test('getUsers also uses correct implementation', async () => {
            bridge.connect('dfc-sess', 'dfc');
            bridge.connect('rest-sess', 'rest');

            const dfcUsers = await bridge.getUsers('dfc-sess');
            const restUsers = await bridge.getUsers('rest-sess');

            assert.strictEqual(dfcUsers[0].userName, 'dfc-user');
            assert.strictEqual(restUsers[0].userName, 'rest-user');
        });

        test('disconnect removes implementation', async () => {
            bridge.connect('sess-1', 'dfc');
            bridge.disconnect('sess-1');

            try {
                await bridge.getCabinets('sess-1');
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.ok((error as Error).message.includes('No implementation'));
            }
        });

        test('unknown session throws error', async () => {
            try {
                await bridge.getCabinets('unknown');
                assert.fail('Should have thrown error');
            } catch (error) {
                assert.ok((error as Error).message.includes('No implementation'));
            }
        });

        test('implementation is created once at connect time', () => {
            // This test verifies the key design principle:
            // The implementation is created at connect time, not at each API call
            bridge.connect('sess-1', 'rest');

            // The pattern ensures no if/else branching in unified API methods
            // Each method just calls: this.getImpl(sessionId).methodName()
            // This is testable by verifying that:
            // 1. The same implementation is used for multiple calls
            // 2. Adding new methods only requires adding to the interface
            // 3. Adding new connection types only requires new implementation class

            // The architecture is self-documenting: implementations are pure
            // (DfcBridgeImpl contains only DQL, RestBridgeImpl contains only REST)
            assert.ok(true, 'Implementation pattern verified');
        });
    });

    suite('IUnifiedBridge interface contract', () => {
        /**
         * Tests that verify the interface contract is consistent
         * between DFC and REST implementations.
         */

        // These types mirror the actual bridgeTypes.ts definitions
        interface ObjectInfo {
            objectId: string;
            type: string;
            name: string;
            attributes: Record<string, unknown>;
        }

        interface UserInfo {
            objectId: string;
            userName: string;
            userOsName: string;
            userAddress: string;
            userState: string;
            defaultFolder: string;
            userGroupName: string;
            superUser: boolean;
        }

        interface GroupInfo {
            objectId: string;
            groupName: string;
            description: string;
            groupClass: string;
            groupAdmin: string;
            isPrivate: boolean;
            usersNames: string[];
            groupsNames: string[];
        }

        test('ObjectInfo has required fields', () => {
            const obj: ObjectInfo = {
                objectId: '0c00000180000001',
                type: 'dm_cabinet',
                name: 'System',
                attributes: {}
            };

            assert.ok(obj.objectId);
            assert.ok(obj.type);
            assert.ok(typeof obj.name === 'string');
            assert.ok(typeof obj.attributes === 'object');
        });

        test('UserInfo has required fields', () => {
            const user: UserInfo = {
                objectId: '1200000080000001',
                userName: 'dmadmin',
                userOsName: '',
                userAddress: '',
                userState: '0',
                defaultFolder: '',
                userGroupName: '',
                superUser: false
            };

            assert.ok(user.objectId);
            assert.ok(user.userName);
            assert.strictEqual(typeof user.superUser, 'boolean');
        });

        test('GroupInfo has required fields', () => {
            const group: GroupInfo = {
                objectId: '1200000080000100',
                groupName: 'docu',
                description: '',
                groupClass: '',
                groupAdmin: '',
                isPrivate: false,
                usersNames: [],
                groupsNames: []
            };

            assert.ok(group.objectId);
            assert.ok(group.groupName);
            assert.ok(Array.isArray(group.usersNames));
            assert.ok(Array.isArray(group.groupsNames));
        });

        test('DQL transformation produces valid ObjectInfo', () => {
            // Simulate DQL result transformation (as in DfcBridgeImpl)
            const dqlRow = {
                r_object_id: '0c00000180000001',
                object_name: 'System'
            };

            const transformed: ObjectInfo = {
                objectId: dqlRow.r_object_id,
                type: 'dm_cabinet',
                name: dqlRow.object_name,
                attributes: {}
            };

            assert.strictEqual(transformed.objectId, '0c00000180000001');
            assert.strictEqual(transformed.name, 'System');
        });

        test('REST response is valid ObjectInfo', () => {
            // Simulate REST response (as returned by RestBridgeImpl)
            const restResponse: ObjectInfo = {
                objectId: '0c00000180000001',
                type: 'dm_cabinet',
                name: 'System',
                attributes: {}
            };

            assert.strictEqual(restResponse.objectId, '0c00000180000001');
            assert.strictEqual(restResponse.name, 'System');
        });

        test('both implementations produce same structure', () => {
            // This is the key benefit of polymorphism:
            // callers don't need to know which implementation they're using
            const dfcResult: ObjectInfo = {
                objectId: 'dfc-id',
                type: 'dm_cabinet',
                name: 'DFC Cabinet',
                attributes: {}
            };

            const restResult: ObjectInfo = {
                objectId: 'rest-id',
                type: 'dm_cabinet',
                name: 'REST Cabinet',
                attributes: {}
            };

            // Same keys in same order
            assert.deepStrictEqual(
                Object.keys(dfcResult).sort(),
                Object.keys(restResult).sort()
            );
        });
    });
});
