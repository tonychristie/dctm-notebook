import * as assert from 'assert';
import * as vscode from 'vscode';
import { DctmBridge } from '../../dctmBridge';
import { FakeAxiosClient, RecordedCall, Responder } from './fakeAxiosClient';

const bridgeResponder: Responder = (call: RecordedCall) => {
    if (call.url === '/api/v1/connect') {
        return { sessionId: (call.body as { endpoint?: string }).endpoint ? 'rest-session' : 'dfc-session' };
    }
    if (call.url === '/api/v1/dql') {
        return { columns: [], rows: [], rowCount: 0 };
    }
    return [];
};

const bridgeSettings = () => vscode.workspace.getConfiguration('documentum.bridge');

async function setBridgeSetting(key: string, value: number | undefined): Promise<void> {
    await bridgeSettings().update(key, value, vscode.ConfigurationTarget.Global);
}

suite('DctmBridge Test Suite', () => {
    let baseUrls: string[];
    let clients: FakeAxiosClient[];

    function createBridge(respond: Responder = bridgeResponder): DctmBridge {
        return new DctmBridge((baseUrl: string) => {
            baseUrls.push(baseUrl);
            const client = new FakeAxiosClient(respond);
            clients.push(client);
            return client.asAxios();
        });
    }

    setup(() => {
        baseUrls = [];
        clients = [];
    });

    teardown(async () => {
        await setBridgeSetting('port', undefined);
        await setBridgeSetting('queryTimeout', undefined);
    });

    suite('ensureRunning', () => {
        test('creates the REST client on the REST port', async () => {
            await createBridge().ensureRunning(undefined, 'rest');

            assert.deepStrictEqual(baseUrls, ['http://localhost:9877']);
        });

        test('creates the DFC client on the DFC port', async () => {
            await createBridge().ensureRunning(undefined, 'dfc');

            assert.deepStrictEqual(baseUrls, ['http://localhost:9876']);
        });

        test('reuses an existing client whose health check passes', async () => {
            const bridge = createBridge();

            await bridge.ensureRunning(undefined, 'dfc');
            await bridge.ensureRunning(undefined, 'dfc');

            assert.strictEqual(baseUrls.length, 1);
            assert.strictEqual(clients[0].callsTo('get', '/health').length, 2);
        });

        test('builds a new client when the configured port changes, even when the old client is healthy', async () => {
            const bridge = createBridge();
            await bridge.ensureRunning(undefined, 'dfc');

            await setBridgeSetting('port', 9999);
            await bridge.ensureRunning(undefined, 'dfc');

            assert.deepStrictEqual(baseUrls, ['http://localhost:9876', 'http://localhost:9999']);
        });

        test('throws when the health check fails', async () => {
            const bridge = createBridge(() => {
                throw new Error('connection refused');
            });

            await assert.rejects(bridge.ensureRunning(undefined, 'rest'));
        });
    });

    suite('connect', () => {
        function connectBody(client: FakeAxiosClient): unknown {
            return client.callsTo('post', '/api/v1/connect')[0].body;
        }

        test('posts a REST body with endpoint and no docbroker or port', async () => {
            const bridge = createBridge();
            await bridge.ensureRunning(undefined, 'rest');

            await bridge.connect({
                endpoint: 'http://dctm:8080/dctm-rest',
                docbroker: 'ignored',
                port: 1500,
                repository: 'repo',
                username: 'user',
                password: 'pass'
            });

            assert.deepStrictEqual(connectBody(clients[0]), {
                repository: 'repo',
                username: 'user',
                password: 'pass',
                endpoint: 'http://dctm:8080/dctm-rest'
            });
        });

        test('posts a DFC body with docbroker and port', async () => {
            const bridge = createBridge();
            await bridge.ensureRunning(undefined, 'dfc');

            await bridge.connect({ docbroker: 'broker', port: 1500, repository: 'repo', username: 'user', password: 'pass' });

            assert.deepStrictEqual(connectBody(clients[0]), {
                repository: 'repo',
                username: 'user',
                password: 'pass',
                docbroker: 'broker',
                port: 1500
            });
        });

        test('defaults the DFC docbroker to empty and the port to 1489', async () => {
            const bridge = createBridge();
            await bridge.ensureRunning(undefined, 'dfc');

            await bridge.connect({ repository: 'repo', username: 'user', password: 'pass' });

            const body = connectBody(clients[0]) as Record<string, unknown>;
            assert.strictEqual(body.docbroker, '');
            assert.strictEqual(body.port, 1489);
        });
    });

    suite('session routing', () => {
        async function connectBoth(bridge: DctmBridge) {
            await bridge.ensureRunning(undefined, 'rest');
            await bridge.ensureRunning(undefined, 'dfc');
            const restSession = await bridge.connect({
                endpoint: 'http://dctm:8080/dctm-rest',
                repository: 'repo',
                username: 'user',
                password: 'pass'
            });
            const dfcSession = await bridge.connect({ repository: 'repo', username: 'user', password: 'pass' });
            return { restClient: clients[0], dfcClient: clients[1], restSession, dfcSession };
        }

        test('isRestSession is true only for a session created with REST parameters', async () => {
            const bridge = createBridge();
            const { restSession, dfcSession } = await connectBoth(bridge);

            assert.strictEqual(bridge.isRestSession(restSession), true);
            assert.strictEqual(bridge.isRestSession(dfcSession), false);
            assert.strictEqual(bridge.isRestSession('unknown'), false);
        });

        test('disconnect removes the session when the bridge call fails', async () => {
            const bridge = createBridge((call: RecordedCall) => {
                if (call.url === '/api/v1/disconnect') {
                    throw new Error('session unknown');
                }
                return bridgeResponder(call);
            });
            const { restSession } = await connectBoth(bridge);

            await bridge.disconnect(restSession);

            assert.strictEqual(bridge.isRestSession(restSession), false);
            await assert.rejects(bridge.getCabinets(restSession));
        });

        test('a disconnected session is no longer routed', async () => {
            const bridge = createBridge();
            const { restSession } = await connectBoth(bridge);

            await bridge.disconnect(restSession);

            assert.strictEqual(bridge.isRestSession(restSession), false);
            await assert.rejects(bridge.getCabinets(restSession));
        });

        test('getCabinets on a REST session calls the REST endpoint', async () => {
            const bridge = createBridge();
            const { restClient, dfcClient, restSession } = await connectBoth(bridge);

            await bridge.getCabinets(restSession);

            assert.strictEqual(restClient.callsTo('get', '/api/v1/cabinets').length, 1);
            assert.strictEqual(dfcClient.callsTo('post', '/api/v1/dql').length, 0);
        });

        test('getCabinets on a DFC session runs DQL through the DFC client', async () => {
            const bridge = createBridge();
            const { restClient, dfcClient, dfcSession } = await connectBoth(bridge);

            await bridge.getCabinets(dfcSession);

            assert.strictEqual(dfcClient.callsTo('post', '/api/v1/dql').length, 1);
            assert.strictEqual(restClient.callsTo('get', '/api/v1/cabinets').length, 0);
        });

        test('executeDmApi with a value posts the value to /api/v1/dmapi', async () => {
            const bridge = createBridge();
            const { dfcClient, dfcSession } = await connectBoth(bridge);

            await bridge.executeDmApi(dfcSession, 'set', 'set,c,0900000180001234,title', 'Smith, John');

            const [call] = dfcClient.callsTo('post', '/api/v1/dmapi');
            assert.strictEqual((call.body as { value?: string }).value, 'Smith, John');
        });
    });

    suite('bridge change with an open session', () => {
        test('every call on the session goes to the client it was created with', async () => {
            const bridge = createBridge();
            await bridge.ensureRunning(undefined, 'dfc');
            const session = await bridge.connect({ repository: 'repo', username: 'user', password: 'pass' });

            await setBridgeSetting('port', 9999);
            await bridge.ensureRunning(undefined, 'dfc');

            await bridge.executeDql(session, 'SELECT 1 FROM dm_server_config');
            await bridge.executeApi(session, '', 'getSessionId', {});
            await bridge.executeDmApi(session, 'get', 'getservermap,session');
            await bridge.getCabinets(session);
            await bridge.disconnect(session);

            const [original, replacement] = clients;
            assert.strictEqual(original.callsTo('post', '/api/v1/dql').length, 2);
            assert.strictEqual(original.callsTo('post', '/api/v1/api').length, 1);
            assert.strictEqual(original.callsTo('post', '/api/v1/dmapi').length, 1);
            assert.strictEqual(original.callsTo('post', '/api/v1/disconnect').length, 1);
            assert.deepStrictEqual(replacement.calls.map(c => c.url), ['/health']);
        });

        test('a new connection goes to the new client', async () => {
            const bridge = createBridge();
            await bridge.ensureRunning(undefined, 'dfc');

            await setBridgeSetting('port', 9999);
            await bridge.ensureRunning(undefined, 'dfc');
            await bridge.connect({ repository: 'repo', username: 'user', password: 'pass' });

            assert.strictEqual(clients[0].callsTo('post', '/api/v1/connect').length, 0);
            assert.strictEqual(clients[1].callsTo('post', '/api/v1/connect').length, 1);
        });
    });

    suite('query timeout', () => {
        async function connectDfc(bridge: DctmBridge) {
            await bridge.ensureRunning(undefined, 'dfc');
            const session = await bridge.connect({ repository: 'repo', username: 'user', password: 'pass' });
            return { client: clients[0], session };
        }

        async function runUserCalls(bridge: DctmBridge, session: string) {
            await bridge.executeDql(session, 'SELECT 1 FROM dm_server_config');
            await bridge.executeApi(session, '', 'getSessionId', {});
            await bridge.executeDmApi(session, 'get', 'getservermap,session');
        }

        function userCallTimeouts(client: FakeAxiosClient): (number | undefined)[] {
            return ['/api/v1/dql', '/api/v1/api', '/api/v1/dmapi'].map(url => client.callsTo('post', url)[0].timeout);
        }

        test('DQL, API and dmAPI calls send the configured timeout in milliseconds', async () => {
            await setBridgeSetting('queryTimeout', 45);
            const bridge = createBridge();
            const { client, session } = await connectDfc(bridge);

            await runUserCalls(bridge, session);

            assert.deepStrictEqual(userCallTimeouts(client), [45000, 45000, 45000]);
        });

        test('a timeout of 0 is sent as 0', async () => {
            await setBridgeSetting('queryTimeout', 0);
            const bridge = createBridge();
            const { client, session } = await connectDfc(bridge);

            await runUserCalls(bridge, session);

            assert.deepStrictEqual(userCallTimeouts(client), [0, 0, 0]);
        });

        test('getCabinets on a DFC session sends no request timeout', async () => {
            await setBridgeSetting('queryTimeout', 45);
            const bridge = createBridge();
            const { client, session } = await connectDfc(bridge);

            await bridge.getCabinets(session);

            assert.strictEqual(client.callsTo('post', '/api/v1/dql')[0].timeout, undefined);
        });
    });
});
