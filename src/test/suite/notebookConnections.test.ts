import * as assert from 'assert';

/**
 * Tests for notebook connection management functionality.
 *
 * These tests cover:
 * - connectNotebook() / disconnectNotebook()
 * - getEffectiveConnection() fallback logic
 * - hasNotebookConnection()
 * - Multiple concurrent notebook sessions
 * - Session cleanup
 *
 * Note: These are unit tests that mock the DfcBridge.
 * Full integration tests require a running bridge instance.
 */

// Types from connectionManager
interface DocumentumConnection {
    name: string;
    type: 'dfc' | 'rest';
    docbroker?: string;
    port?: number;
    dfcProfile?: string;
    endpoint?: string;
    repository: string;
    username?: string;
}

interface ActiveConnection {
    config: DocumentumConnection;
    sessionId: string;
    username: string;
}

/**
 * Mock DfcBridge for testing without actual Documentum connection
 */
class MockDfcBridge {
    private sessionCounter = 0;
    private activeSessions: Map<string, boolean> = new Map();

    async ensureRunning(): Promise<void> {
        // No-op for mock
    }

    async connect(_params: {
        docbroker?: string;
        port?: number;
        endpoint?: string;
        repository: string;
        username: string;
        password: string;
    }): Promise<string> {
        const sessionId = `mock-session-${++this.sessionCounter}`;
        this.activeSessions.set(sessionId, true);
        return sessionId;
    }

    async disconnect(sessionId: string): Promise<void> {
        this.activeSessions.delete(sessionId);
    }

    isSessionActive(sessionId: string): boolean {
        return this.activeSessions.has(sessionId);
    }

    getActiveSessionCount(): number {
        return this.activeSessions.size;
    }
}

/**
 * Simplified ConnectionManager for testing notebook connection logic.
 * Mirrors the actual implementation but uses mock bridge.
 */
class TestableConnectionManager {
    private activeConnection: ActiveConnection | null = null;
    private notebookConnections: Map<string, ActiveConnection> = new Map();
    private mockBridge: MockDfcBridge;
    private savedConnections: DocumentumConnection[];

    constructor(connections: DocumentumConnection[] = []) {
        this.mockBridge = new MockDfcBridge();
        this.savedConnections = connections;
    }

    getMockBridge(): MockDfcBridge {
        return this.mockBridge;
    }

    getConnections(): DocumentumConnection[] {
        return this.savedConnections;
    }

    setActiveConnection(connection: ActiveConnection | null): void {
        this.activeConnection = connection;
    }

    getActiveConnection(): ActiveConnection | null {
        return this.activeConnection;
    }

    async connectNotebook(
        notebookUri: string,
        connectionName: string,
        username: string,
        password: string
    ): Promise<string> {
        const connection = this.savedConnections.find(c => c.name === connectionName);
        if (!connection) {
            throw new Error(`Connection "${connectionName}" not found`);
        }

        await this.mockBridge.ensureRunning();

        // Route to DFC or REST based on connection type
        const sessionId = await this.mockBridge.connect(
            connection.type === 'rest'
                ? {
                    endpoint: connection.endpoint,
                    repository: connection.repository,
                    username,
                    password
                }
                : {
                    docbroker: connection.docbroker || '',
                    port: connection.port || 1489,
                    repository: connection.repository,
                    username,
                    password
                }
        );

        const activeConnection: ActiveConnection = {
            config: connection,
            sessionId,
            username
        };

        this.notebookConnections.set(notebookUri, activeConnection);
        return sessionId;
    }

    async disconnectNotebook(notebookUri: string): Promise<void> {
        const connection = this.notebookConnections.get(notebookUri);
        if (connection) {
            await this.mockBridge.disconnect(connection.sessionId);
            this.notebookConnections.delete(notebookUri);
        }
    }

    getNotebookConnection(notebookUri: string): ActiveConnection | null {
        return this.notebookConnections.get(notebookUri) || null;
    }

    hasNotebookConnection(notebookUri: string): boolean {
        return this.notebookConnections.has(notebookUri);
    }

    getEffectiveConnection(notebookUri?: string): ActiveConnection | null {
        if (notebookUri) {
            const notebookConnection = this.notebookConnections.get(notebookUri);
            if (notebookConnection) {
                return notebookConnection;
            }
        }
        return this.activeConnection;
    }

    getAllNotebookConnections(): Map<string, ActiveConnection> {
        return new Map(this.notebookConnections);
    }

    async disconnectAllNotebooks(): Promise<void> {
        const uris = Array.from(this.notebookConnections.keys());
        await Promise.all(uris.map(uri => this.disconnectNotebook(uri)));
    }
}

suite('Notebook Connections Test Suite', () => {
    const testConnections: DocumentumConnection[] = [
        {
            name: 'dev-docbase',
            type: 'dfc',
            docbroker: 'devserver',
            port: 1489,
            repository: 'dev_repo'
        },
        {
            name: 'prod-docbase',
            type: 'dfc',
            docbroker: 'prodserver',
            port: 1489,
            repository: 'prod_repo'
        },
        {
            name: 'test-docbase',
            type: 'dfc',
            docbroker: 'testserver',
            port: 1490,
            repository: 'test_repo'
        },
        {
            name: 'rest-docbase',
            type: 'rest',
            endpoint: 'http://rest.example.com/dctm-rest',
            repository: 'rest_repo'
        }
    ];

    suite('connectNotebook()', () => {
        test('creates new session for notebook', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            const sessionId = await manager.connectNotebook(
                notebookUri,
                'dev-docbase',
                'testuser',
                'testpass'
            );

            assert.ok(sessionId, 'Should return session ID');
            assert.ok(sessionId.startsWith('mock-session-'), 'Should be mock session ID');
        });

        test('stores connection in notebook connections map', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            await manager.connectNotebook(notebookUri, 'dev-docbase', 'testuser', 'testpass');

            assert.ok(manager.hasNotebookConnection(notebookUri), 'Should have notebook connection');
            const conn = manager.getNotebookConnection(notebookUri);
            assert.ok(conn, 'Should retrieve connection');
            assert.strictEqual(conn!.config.name, 'dev-docbase');
            assert.strictEqual(conn!.username, 'testuser');
        });

        test('throws error for unknown connection name', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            await assert.rejects(
                async () => {
                    await manager.connectNotebook(
                        notebookUri,
                        'nonexistent-connection',
                        'user',
                        'pass'
                    );
                },
                /Connection "nonexistent-connection" not found/
            );
        });

        test('can connect multiple notebooks to same connection', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebook1 = 'file:///notebooks/test1.dctmbook';
            const notebook2 = 'file:///notebooks/test2.dctmbook';

            const session1 = await manager.connectNotebook(notebook1, 'dev-docbase', 'user1', 'pass1');
            const session2 = await manager.connectNotebook(notebook2, 'dev-docbase', 'user2', 'pass2');

            assert.ok(session1 !== session2, 'Sessions should be different');
            assert.ok(manager.hasNotebookConnection(notebook1));
            assert.ok(manager.hasNotebookConnection(notebook2));

            const conn1 = manager.getNotebookConnection(notebook1);
            const conn2 = manager.getNotebookConnection(notebook2);
            assert.strictEqual(conn1!.username, 'user1');
            assert.strictEqual(conn2!.username, 'user2');
        });

        test('can connect notebooks to different connections', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebook1 = 'file:///notebooks/dev.dctmbook';
            const notebook2 = 'file:///notebooks/prod.dctmbook';

            await manager.connectNotebook(notebook1, 'dev-docbase', 'devuser', 'pass');
            await manager.connectNotebook(notebook2, 'prod-docbase', 'produser', 'pass');

            const conn1 = manager.getNotebookConnection(notebook1);
            const conn2 = manager.getNotebookConnection(notebook2);

            assert.strictEqual(conn1!.config.name, 'dev-docbase');
            assert.strictEqual(conn2!.config.name, 'prod-docbase');
            assert.strictEqual(conn1!.config.repository, 'dev_repo');
            assert.strictEqual(conn2!.config.repository, 'prod_repo');
        });
    });

    suite('disconnectNotebook()', () => {
        test('removes notebook from connections map', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            await manager.connectNotebook(notebookUri, 'dev-docbase', 'user', 'pass');
            assert.ok(manager.hasNotebookConnection(notebookUri), 'Should be connected');

            await manager.disconnectNotebook(notebookUri);
            assert.ok(!manager.hasNotebookConnection(notebookUri), 'Should be disconnected');
        });

        test('disconnects session on bridge', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            const sessionId = await manager.connectNotebook(notebookUri, 'dev-docbase', 'user', 'pass');
            assert.ok(manager.getMockBridge().isSessionActive(sessionId), 'Session should be active');

            await manager.disconnectNotebook(notebookUri);
            assert.ok(!manager.getMockBridge().isSessionActive(sessionId), 'Session should be inactive');
        });

        test('handles disconnect of non-connected notebook gracefully', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/never-connected.dctmbook';

            // Should not throw
            await manager.disconnectNotebook(notebookUri);
            assert.ok(!manager.hasNotebookConnection(notebookUri));
        });

        test('does not affect other notebook connections', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebook1 = 'file:///notebooks/test1.dctmbook';
            const notebook2 = 'file:///notebooks/test2.dctmbook';

            await manager.connectNotebook(notebook1, 'dev-docbase', 'user1', 'pass');
            await manager.connectNotebook(notebook2, 'prod-docbase', 'user2', 'pass');

            await manager.disconnectNotebook(notebook1);

            assert.ok(!manager.hasNotebookConnection(notebook1), 'Notebook 1 should be disconnected');
            assert.ok(manager.hasNotebookConnection(notebook2), 'Notebook 2 should still be connected');
        });
    });

    suite('getEffectiveConnection()', () => {
        test('returns notebook connection when available', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            // Set up global connection
            const globalConn: ActiveConnection = {
                config: testConnections[0],
                sessionId: 'global-session',
                username: 'globaluser'
            };
            manager.setActiveConnection(globalConn);

            // Connect notebook
            await manager.connectNotebook(notebookUri, 'prod-docbase', 'notebookuser', 'pass');

            // Should return notebook connection, not global
            const effective = manager.getEffectiveConnection(notebookUri);
            assert.ok(effective);
            assert.strictEqual(effective!.config.name, 'prod-docbase');
            assert.strictEqual(effective!.username, 'notebookuser');
        });

        test('falls back to global connection when notebook not connected', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            // Set up global connection only
            const globalConn: ActiveConnection = {
                config: testConnections[0],
                sessionId: 'global-session',
                username: 'globaluser'
            };
            manager.setActiveConnection(globalConn);

            // No notebook connection - should fall back to global
            const effective = manager.getEffectiveConnection(notebookUri);
            assert.ok(effective);
            assert.strictEqual(effective!.config.name, 'dev-docbase');
            assert.strictEqual(effective!.username, 'globaluser');
        });

        test('returns global connection when notebookUri is undefined', () => {
            const manager = new TestableConnectionManager(testConnections);

            const globalConn: ActiveConnection = {
                config: testConnections[1],
                sessionId: 'global-session',
                username: 'globaluser'
            };
            manager.setActiveConnection(globalConn);

            const effective = manager.getEffectiveConnection(undefined);
            assert.ok(effective);
            assert.strictEqual(effective!.config.name, 'prod-docbase');
        });

        test('returns null when no connections exist', () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            const effective = manager.getEffectiveConnection(notebookUri);
            assert.strictEqual(effective, null);
        });

        test('returns null when global disconnected and notebook not connected', () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            manager.setActiveConnection(null);

            const effective = manager.getEffectiveConnection(notebookUri);
            assert.strictEqual(effective, null);
        });
    });

    suite('hasNotebookConnection()', () => {
        test('returns true for connected notebook', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            await manager.connectNotebook(notebookUri, 'dev-docbase', 'user', 'pass');

            assert.strictEqual(manager.hasNotebookConnection(notebookUri), true);
        });

        test('returns false for unconnected notebook', () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            assert.strictEqual(manager.hasNotebookConnection(notebookUri), false);
        });

        test('returns false after notebook is disconnected', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/test.dctmbook';

            await manager.connectNotebook(notebookUri, 'dev-docbase', 'user', 'pass');
            await manager.disconnectNotebook(notebookUri);

            assert.strictEqual(manager.hasNotebookConnection(notebookUri), false);
        });
    });

    suite('getAllNotebookConnections()', () => {
        test('returns empty map when no notebooks connected', () => {
            const manager = new TestableConnectionManager(testConnections);

            const all = manager.getAllNotebookConnections();
            assert.strictEqual(all.size, 0);
        });

        test('returns all connected notebooks', async () => {
            const manager = new TestableConnectionManager(testConnections);

            await manager.connectNotebook('file:///nb1.dctmbook', 'dev-docbase', 'u1', 'p');
            await manager.connectNotebook('file:///nb2.dctmbook', 'prod-docbase', 'u2', 'p');
            await manager.connectNotebook('file:///nb3.dctmbook', 'test-docbase', 'u3', 'p');

            const all = manager.getAllNotebookConnections();
            assert.strictEqual(all.size, 3);
            assert.ok(all.has('file:///nb1.dctmbook'));
            assert.ok(all.has('file:///nb2.dctmbook'));
            assert.ok(all.has('file:///nb3.dctmbook'));
        });

        test('returns copy of map (immutable)', async () => {
            const manager = new TestableConnectionManager(testConnections);

            await manager.connectNotebook('file:///nb1.dctmbook', 'dev-docbase', 'u1', 'p');

            const all = manager.getAllNotebookConnections();
            all.delete('file:///nb1.dctmbook'); // Modify the returned map

            // Original should still have the connection
            assert.ok(manager.hasNotebookConnection('file:///nb1.dctmbook'));
        });
    });

    suite('disconnectAllNotebooks()', () => {
        test('disconnects all notebook sessions', async () => {
            const manager = new TestableConnectionManager(testConnections);

            const session1 = await manager.connectNotebook('file:///nb1.dctmbook', 'dev-docbase', 'u1', 'p');
            const session2 = await manager.connectNotebook('file:///nb2.dctmbook', 'prod-docbase', 'u2', 'p');
            const session3 = await manager.connectNotebook('file:///nb3.dctmbook', 'test-docbase', 'u3', 'p');

            assert.strictEqual(manager.getMockBridge().getActiveSessionCount(), 3);

            await manager.disconnectAllNotebooks();

            assert.strictEqual(manager.getAllNotebookConnections().size, 0);
            assert.ok(!manager.getMockBridge().isSessionActive(session1));
            assert.ok(!manager.getMockBridge().isSessionActive(session2));
            assert.ok(!manager.getMockBridge().isSessionActive(session3));
        });

        test('handles empty notebook connections', async () => {
            const manager = new TestableConnectionManager(testConnections);

            // Should not throw
            await manager.disconnectAllNotebooks();
            assert.strictEqual(manager.getAllNotebookConnections().size, 0);
        });

        test('does not affect global connection', async () => {
            const manager = new TestableConnectionManager(testConnections);

            const globalConn: ActiveConnection = {
                config: testConnections[0],
                sessionId: 'global-session',
                username: 'globaluser'
            };
            manager.setActiveConnection(globalConn);

            await manager.connectNotebook('file:///nb1.dctmbook', 'dev-docbase', 'u1', 'p');
            await manager.disconnectAllNotebooks();

            // Global should still be connected
            assert.ok(manager.getActiveConnection());
            assert.strictEqual(manager.getActiveConnection()!.sessionId, 'global-session');
        });
    });

    suite('Multiple concurrent sessions', () => {
        test('each notebook gets unique session ID', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const sessions: string[] = [];

            for (let i = 0; i < 5; i++) {
                const session = await manager.connectNotebook(
                    `file:///nb${i}.dctmbook`,
                    'dev-docbase',
                    `user${i}`,
                    'pass'
                );
                sessions.push(session);
            }

            // All sessions should be unique
            const uniqueSessions = new Set(sessions);
            assert.strictEqual(uniqueSessions.size, 5, 'All session IDs should be unique');
        });

        test('notebooks can be connected and disconnected independently', async () => {
            const manager = new TestableConnectionManager(testConnections);

            // Connect 3 notebooks
            await manager.connectNotebook('file:///nb1.dctmbook', 'dev-docbase', 'u1', 'p');
            await manager.connectNotebook('file:///nb2.dctmbook', 'prod-docbase', 'u2', 'p');
            await manager.connectNotebook('file:///nb3.dctmbook', 'test-docbase', 'u3', 'p');

            // Disconnect middle one
            await manager.disconnectNotebook('file:///nb2.dctmbook');

            assert.ok(manager.hasNotebookConnection('file:///nb1.dctmbook'));
            assert.ok(!manager.hasNotebookConnection('file:///nb2.dctmbook'));
            assert.ok(manager.hasNotebookConnection('file:///nb3.dctmbook'));

            // Reconnect the disconnected one
            await manager.connectNotebook('file:///nb2.dctmbook', 'dev-docbase', 'u2new', 'p');

            const conn = manager.getNotebookConnection('file:///nb2.dctmbook');
            assert.strictEqual(conn!.username, 'u2new');
        });

        test('getEffectiveConnection returns correct connection for each notebook', async () => {
            const manager = new TestableConnectionManager(testConnections);

            // Set global
            manager.setActiveConnection({
                config: testConnections[0],
                sessionId: 'global',
                username: 'global-user'
            });

            // Connect some notebooks
            await manager.connectNotebook('file:///bound1.dctmbook', 'prod-docbase', 'bound-user1', 'p');
            await manager.connectNotebook('file:///bound2.dctmbook', 'test-docbase', 'bound-user2', 'p');

            // Notebook with its own connection
            const eff1 = manager.getEffectiveConnection('file:///bound1.dctmbook');
            assert.strictEqual(eff1!.config.name, 'prod-docbase');

            // Another notebook with its own connection
            const eff2 = manager.getEffectiveConnection('file:///bound2.dctmbook');
            assert.strictEqual(eff2!.config.name, 'test-docbase');

            // Unbound notebook falls back to global
            const eff3 = manager.getEffectiveConnection('file:///unbound.dctmbook');
            assert.strictEqual(eff3!.config.name, 'dev-docbase');
            assert.strictEqual(eff3!.username, 'global-user');
        });
    });

    suite('Notebook metadata connection binding', () => {
        // These tests verify the contract for metadata-based binding
        // The actual notebook metadata is managed by VS Code NotebookEdit API

        test('connection name can be retrieved from metadata structure', () => {
            // Simulating notebook metadata structure
            const notebookMetadata = {
                connection: 'dev-docbase'
            };

            const boundConnection = notebookMetadata.connection;
            assert.strictEqual(boundConnection, 'dev-docbase');
        });

        test('metadata without connection returns undefined', () => {
            const notebookMetadata: { connection?: string } = {};

            const boundConnection = notebookMetadata.connection;
            assert.strictEqual(boundConnection, undefined);
        });

        test('binding can be removed by deleting connection property', () => {
            const notebookMetadata: { connection?: string } = {
                connection: 'dev-docbase'
            };

            delete notebookMetadata.connection;
            assert.strictEqual(notebookMetadata.connection, undefined);
        });

        test('binding can be updated to different connection', () => {
            const notebookMetadata = {
                connection: 'dev-docbase'
            };

            notebookMetadata.connection = 'prod-docbase';
            assert.strictEqual(notebookMetadata.connection, 'prod-docbase');
        });
    });

    suite('REST vs DFC connection routing', () => {
        test('can connect notebook to REST connection', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/rest-test.dctmbook';

            const sessionId = await manager.connectNotebook(
                notebookUri,
                'rest-docbase',
                'restuser',
                'restpass'
            );

            assert.ok(sessionId, 'Should return session ID for REST connection');
            const conn = manager.getNotebookConnection(notebookUri);
            assert.strictEqual(conn!.config.type, 'rest');
            assert.strictEqual(conn!.config.endpoint, 'http://rest.example.com/dctm-rest');
        });

        test('can connect notebook to DFC connection', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/dfc-test.dctmbook';

            const sessionId = await manager.connectNotebook(
                notebookUri,
                'dev-docbase',
                'dfcuser',
                'dfcpass'
            );

            assert.ok(sessionId, 'Should return session ID for DFC connection');
            const conn = manager.getNotebookConnection(notebookUri);
            assert.strictEqual(conn!.config.type, 'dfc');
            assert.strictEqual(conn!.config.docbroker, 'devserver');
        });

        test('can connect multiple notebooks to different connection types', async () => {
            const manager = new TestableConnectionManager(testConnections);

            await manager.connectNotebook('file:///nb-dfc.dctmbook', 'dev-docbase', 'u1', 'p1');
            await manager.connectNotebook('file:///nb-rest.dctmbook', 'rest-docbase', 'u2', 'p2');

            const dfcConn = manager.getNotebookConnection('file:///nb-dfc.dctmbook');
            const restConn = manager.getNotebookConnection('file:///nb-rest.dctmbook');

            assert.strictEqual(dfcConn!.config.type, 'dfc');
            assert.strictEqual(restConn!.config.type, 'rest');
            assert.strictEqual(dfcConn!.config.docbroker, 'devserver');
            assert.strictEqual(restConn!.config.endpoint, 'http://rest.example.com/dctm-rest');
        });

        test('getEffectiveConnection returns correct type for REST connection', async () => {
            const manager = new TestableConnectionManager(testConnections);
            const notebookUri = 'file:///notebooks/rest-effective.dctmbook';

            await manager.connectNotebook(notebookUri, 'rest-docbase', 'user', 'pass');

            const effective = manager.getEffectiveConnection(notebookUri);
            assert.ok(effective);
            assert.strictEqual(effective!.config.type, 'rest');
            assert.strictEqual(effective!.config.endpoint, 'http://rest.example.com/dctm-rest');
            assert.strictEqual(effective!.config.docbroker, undefined);
        });

        test('REST connection does not have docbroker in config', async () => {
            const manager = new TestableConnectionManager(testConnections);

            await manager.connectNotebook('file:///nb.dctmbook', 'rest-docbase', 'user', 'pass');

            const conn = manager.getNotebookConnection('file:///nb.dctmbook');
            assert.strictEqual(conn!.config.type, 'rest');
            assert.strictEqual(conn!.config.endpoint, 'http://rest.example.com/dctm-rest');
            assert.strictEqual(conn!.config.docbroker, undefined);
            assert.strictEqual(conn!.config.port, undefined);
        });

        test('DFC connection does not have endpoint in config', async () => {
            const manager = new TestableConnectionManager(testConnections);

            await manager.connectNotebook('file:///nb.dctmbook', 'dev-docbase', 'user', 'pass');

            const conn = manager.getNotebookConnection('file:///nb.dctmbook');
            assert.strictEqual(conn!.config.type, 'dfc');
            assert.strictEqual(conn!.config.docbroker, 'devserver');
            assert.strictEqual(conn!.config.port, 1489);
            assert.strictEqual(conn!.config.endpoint, undefined);
        });
    });
});
