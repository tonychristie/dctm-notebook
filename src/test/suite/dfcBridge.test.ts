import * as assert from 'assert';

/**
 * Tests for DfcBridge connection routing functionality.
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

suite('DfcBridge Test Suite', () => {

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

    suite('Bridge port routing', () => {
        /**
         * Tests for connection type to bridge port routing.
         * DFC connections should use bridge.port (9876), REST connections should use bridge.restPort (9877).
         */

        interface BridgeConfig {
            port: number;
            restPort: number;
        }

        /**
         * Get base URL for connection type - mirrors the logic in dfcBridge.getBaseUrlForType()
         */
        function getBaseUrlForType(config: BridgeConfig, connectionType: 'dfc' | 'rest'): string {
            if (connectionType === 'rest') {
                return `http://localhost:${config.restPort}`;
            }
            return `http://localhost:${config.port}`;
        }

        const defaultConfig: BridgeConfig = {
            port: 9876,
            restPort: 9877
        };

        test('DFC connection uses port 9876 by default', () => {
            const baseUrl = getBaseUrlForType(defaultConfig, 'dfc');
            assert.strictEqual(baseUrl, 'http://localhost:9876');
        });

        test('REST connection uses port 9877 by default', () => {
            const baseUrl = getBaseUrlForType(defaultConfig, 'rest');
            assert.strictEqual(baseUrl, 'http://localhost:9877');
        });

        test('DFC connection uses custom port from config', () => {
            const customConfig: BridgeConfig = {
                port: 8000,
                restPort: 9877
            };
            const baseUrl = getBaseUrlForType(customConfig, 'dfc');
            assert.strictEqual(baseUrl, 'http://localhost:8000');
        });

        test('REST connection uses custom restPort from config', () => {
            const customConfig: BridgeConfig = {
                port: 9876,
                restPort: 8001
            };
            const baseUrl = getBaseUrlForType(customConfig, 'rest');
            assert.strictEqual(baseUrl, 'http://localhost:8001');
        });

        test('both ports can be customized independently', () => {
            const customConfig: BridgeConfig = {
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
                port: 9999,
                restPort: 9999
            };
            const dfcUrl = getBaseUrlForType(samePortConfig, 'dfc');
            const restUrl = getBaseUrlForType(samePortConfig, 'rest');

            assert.strictEqual(dfcUrl, 'http://localhost:9999');
            assert.strictEqual(restUrl, 'http://localhost:9999');
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
});
