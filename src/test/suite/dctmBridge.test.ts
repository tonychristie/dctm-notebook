import * as assert from 'assert';
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
    });
});
