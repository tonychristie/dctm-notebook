import * as assert from 'assert';
import * as vscode from 'vscode';
import {
    ActiveConnection,
    ConnectionManager,
    DfcProfile,
    DocumentumConnection,
    describeConnection
} from '../../connectionManager';
import { DctmBridge, DfcConnectParams } from '../../dctmBridge';

const context = {} as vscode.ExtensionContext;

class FakeBridge {
    ensureRunningCalls: { profile?: DfcProfile; connectionType?: 'dfc' | 'rest' }[] = [];
    connectCalls: DfcConnectParams[] = [];
    disconnectCalls: string[] = [];
    failDisconnect = false;

    async ensureRunning(profile?: DfcProfile, connectionType?: 'dfc' | 'rest'): Promise<void> {
        this.ensureRunningCalls.push({ profile, connectionType });
    }

    async connect(params: DfcConnectParams): Promise<string> {
        this.connectCalls.push(params);
        return `session-${this.connectCalls.length}`;
    }

    async disconnect(sessionId: string): Promise<void> {
        this.disconnectCalls.push(sessionId);
        if (this.failDisconnect) {
            throw new Error('bridge unavailable');
        }
    }
}

class TestConnectionManager extends ConnectionManager {
    constructor(
        bridge: FakeBridge,
        private connections: DocumentumConnection[],
        private profiles: Record<string, DfcProfile> = {}
    ) {
        super(context, bridge as unknown as DctmBridge);
    }

    getConnections(): DocumentumConnection[] {
        return this.connections;
    }

    getDfcProfiles(): Record<string, DfcProfile> {
        return this.profiles;
    }
}

const restConnection: DocumentumConnection = {
    name: 'Rest',
    type: 'rest',
    endpoint: 'http://dctm:8080/dctm-rest',
    repository: 'repo'
};

const dfcConnection: DocumentumConnection = {
    name: 'Dfc',
    type: 'dfc',
    docbroker: 'broker',
    port: 1500,
    repository: 'repo',
    dfcProfile: 'dfc22'
};

const defaultsConnection: DocumentumConnection = {
    name: 'Defaults',
    type: 'dfc',
    repository: 'repo'
};

const profile: DfcProfile = { dfcPath: '/opt/dfc' };

suite('Notebook Connections Test Suite', () => {
    let bridge: FakeBridge;
    let manager: TestConnectionManager;
    let notifications: { uri: string; connected: boolean; name?: string; username?: string }[];

    setup(() => {
        bridge = new FakeBridge();
        manager = new TestConnectionManager(
            bridge,
            [restConnection, dfcConnection, defaultsConnection],
            { dfc22: profile }
        );
        notifications = [];
        manager.onNotebookConnectionChange((uri, connected, name, username) => {
            notifications.push({ uri, connected, name, username });
        });
    });

    suite('connectNotebook', () => {
        test('throws for an unknown connection', async () => {
            await assert.rejects(manager.connectNotebook('nb1', 'Missing', 'user', 'pass'));
            assert.strictEqual(bridge.connectCalls.length, 0);
        });

        test('throws for a missing DFC profile', async () => {
            const noProfiles = new TestConnectionManager(bridge, [dfcConnection]);

            await assert.rejects(noProfiles.connectNotebook('nb1', 'Dfc', 'user', 'pass'));
            assert.strictEqual(bridge.ensureRunningCalls.length, 0);
        });

        test('ensures the bridge for the connection type is running', async () => {
            await manager.connectNotebook('nb1', 'Rest', 'user', 'pass');
            await manager.connectNotebook('nb2', 'Dfc', 'user', 'pass');

            assert.deepStrictEqual(bridge.ensureRunningCalls, [
                { profile: undefined, connectionType: 'rest' },
                { profile, connectionType: 'dfc' }
            ]);
        });

        test('passes REST parameters to connect', async () => {
            await manager.connectNotebook('nb1', 'Rest', 'user', 'pass');

            assert.deepStrictEqual(bridge.connectCalls[0], {
                endpoint: 'http://dctm:8080/dctm-rest',
                repository: 'repo',
                username: 'user',
                password: 'pass'
            });
        });

        test('passes DFC parameters to connect', async () => {
            await manager.connectNotebook('nb1', 'Dfc', 'user', 'pass');

            assert.deepStrictEqual(bridge.connectCalls[0], {
                docbroker: 'broker',
                port: 1500,
                repository: 'repo',
                username: 'user',
                password: 'pass'
            });
        });

        test('defaults the DFC docbroker to empty and the port to 1489', async () => {
            await manager.connectNotebook('nb1', 'Defaults', 'user', 'pass');

            assert.strictEqual(bridge.connectCalls[0].docbroker, '');
            assert.strictEqual(bridge.connectCalls[0].port, 1489);
        });

        test('stores the connection and notifies the notebook callbacks', async () => {
            const sessionId = await manager.connectNotebook('nb1', 'Rest', 'user', 'pass');

            assert.deepStrictEqual(manager.getNotebookConnection('nb1'), {
                config: restConnection,
                sessionId,
                username: 'user'
            });
            assert.deepStrictEqual(notifications, [
                { uri: 'nb1', connected: true, name: 'Rest', username: 'user' }
            ]);
        });
    });

    suite('disconnectNotebook', () => {
        test('disconnects the session, removes the binding and notifies', async () => {
            const sessionId = await manager.connectNotebook('nb1', 'Rest', 'user', 'pass');

            await manager.disconnectNotebook('nb1');

            assert.deepStrictEqual(bridge.disconnectCalls, [sessionId]);
            assert.strictEqual(manager.hasNotebookConnection('nb1'), false);
            assert.deepStrictEqual(notifications[1], { uri: 'nb1', connected: false, name: undefined, username: undefined });
        });

        test('removes the binding and notifies when the bridge disconnect fails', async () => {
            await manager.connectNotebook('nb1', 'Rest', 'user', 'pass');
            bridge.failDisconnect = true;

            await manager.disconnectNotebook('nb1');

            assert.strictEqual(manager.hasNotebookConnection('nb1'), false);
            assert.strictEqual(notifications[1].connected, false);
        });

        test('disconnectAllNotebooks disconnects every bound notebook', async () => {
            const first = await manager.connectNotebook('nb1', 'Rest', 'user', 'pass');
            const second = await manager.connectNotebook('nb2', 'Dfc', 'user', 'pass');

            await manager.disconnectAllNotebooks();

            assert.deepStrictEqual(bridge.disconnectCalls.sort(), [first, second].sort());
            assert.strictEqual(manager.getAllNotebookConnections().size, 0);
        });
    });

    suite('getEffectiveConnection', () => {
        const globalConnection: ActiveConnection = { config: dfcConnection, sessionId: 'global', username: 'admin' };

        setup(() => {
            // The global connection is only set through the interactive connect() flow.
            (manager as unknown as { activeConnection: ActiveConnection }).activeConnection = globalConnection;
        });

        test('returns the notebook connection when the notebook has one', async () => {
            await manager.connectNotebook('nb1', 'Rest', 'user', 'pass');

            assert.strictEqual(manager.getEffectiveConnection('nb1')?.config, restConnection);
        });

        test('returns the global connection otherwise', () => {
            assert.strictEqual(manager.getEffectiveConnection('nb1'), globalConnection);
            assert.strictEqual(manager.getEffectiveConnection(), globalConnection);
        });
    });

    suite('describeConnection', () => {
        test('returns the endpoint for a REST connection', () => {
            assert.strictEqual(describeConnection(restConnection), 'http://dctm:8080/dctm-rest');
        });

        test('returns REST for a REST connection without an endpoint', () => {
            assert.strictEqual(describeConnection({ ...restConnection, endpoint: undefined }), 'REST');
        });

        test('returns docbroker:port for a DFC connection', () => {
            assert.strictEqual(describeConnection(dfcConnection), 'broker:1500');
        });

        test('defaults the port to 1489 for a DFC connection without a port', () => {
            assert.strictEqual(describeConnection({ ...dfcConnection, port: undefined }), 'broker:1489');
        });

        test('returns DFC for a DFC connection without a docbroker', () => {
            assert.strictEqual(describeConnection(defaultsConnection), 'DFC');
        });
    });
});
