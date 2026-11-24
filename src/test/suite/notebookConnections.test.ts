import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConnectionManager, Credentials, DocumentumConnection } from '../../connectionManager';
import { describeConnection } from '../../connectionForm';
import { DctmBridge, DfcConnectParams } from '../../dctmBridge';
import { RepositoryConnection } from '../../repositoryConnection';
import { bindNotebook, openNotebookAction, resolveNotebookConnection } from '../../notebook/notebookConnection';
import { dumpFromNotebook } from '../../notebook';
import { DumpTarget } from '../../workspace/dumpTab';

class FakeBridge {
    ensureRunningCalls: ('dfc' | 'rest')[] = [];
    connectCalls: DfcConnectParams[] = [];
    disconnectCalls: string[] = [];
    failConnect = false;
    failDisconnect = false;

    async ensureRunning(connectionType: 'dfc' | 'rest'): Promise<void> {
        this.ensureRunningCalls.push(connectionType);
    }

    async connect(params: DfcConnectParams): Promise<string> {
        this.connectCalls.push(params);
        if (this.failConnect) {
            throw new Error('authentication failed');
        }
        return `session-${this.connectCalls.length}`;
    }

    async disconnect(sessionId: string): Promise<void> {
        this.disconnectCalls.push(sessionId);
        if (this.failDisconnect) {
            throw new Error('bridge unavailable');
        }
    }

    async getTypes(): Promise<unknown[]> {
        return [];
    }

    async getUsers(): Promise<unknown[]> {
        return [];
    }

    async getGroups(): Promise<unknown[]> {
        return [];
    }
}

class TestConnectionManager extends ConnectionManager {
    prompts: { name: string; askUsername: boolean }[] = [];
    answers: (Credentials | undefined)[] = [];

    constructor(bridge: FakeBridge, private connections: DocumentumConnection[]) {
        super(bridge as unknown as DctmBridge);
        void this.updateConnections(connections);
    }

    // The base constructor reads the list before this.connections is assigned.
    getConnections(): DocumentumConnection[] {
        return this.connections ?? [];
    }

    async changeConnections(connections: DocumentumConnection[]): Promise<void> {
        this.connections = connections;
        await this.updateConnections(connections);
    }

    protected async promptCredentials(
        config: DocumentumConnection,
        askUsername = false
    ): Promise<Credentials | undefined> {
        this.prompts.push({ name: config.name, askUsername });
        return this.answers.length > 0 ? this.answers.shift() : { username: 'user', password: 'pass' };
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
    repository: 'repo'
};

const defaultsConnection: DocumentumConnection = {
    name: 'Defaults',
    type: 'dfc',
    repository: 'repo'
};

suite('Connection Manager Test Suite', () => {
    let bridge: FakeBridge;
    let manager: TestConnectionManager;
    let selectionEvents: (string | undefined)[];
    let openConnectionsEvents: number;
    let connectionsEvents: number;

    setup(() => {
        bridge = new FakeBridge();
        manager = new TestConnectionManager(bridge, [restConnection, dfcConnection, defaultsConnection]);
        selectionEvents = [];
        openConnectionsEvents = 0;
        connectionsEvents = 0;
        manager.onDidChangeSelection(connection => selectionEvents.push(connection?.name));
        manager.onDidChangeOpenConnections(() => openConnectionsEvents++);
        manager.onDidChangeConnections(() => connectionsEvents++);
    });

    teardown(() => {
        manager.dispose();
    });

    suite('openConnection', () => {
        test('rejects for an unknown connection', async () => {
            await assert.rejects(manager.openConnection('Missing'));
            assert.strictEqual(bridge.connectCalls.length, 0);
        });

        test('ensures the bridge for the connection type is running', async () => {
            await manager.openConnection('Rest');
            await manager.openConnection('Dfc');

            assert.deepStrictEqual(bridge.ensureRunningCalls, ['rest', 'dfc']);
        });

        test('passes REST parameters to connect', async () => {
            await manager.openConnection('Rest');

            assert.deepStrictEqual(bridge.connectCalls[0], {
                endpoint: 'http://dctm:8080/dctm-rest',
                repository: 'repo',
                username: 'user',
                password: 'pass'
            });
        });

        test('passes DFC parameters to connect', async () => {
            await manager.openConnection('Dfc');

            assert.deepStrictEqual(bridge.connectCalls[0], {
                docbroker: 'broker',
                port: 1500,
                repository: 'repo',
                username: 'user',
                password: 'pass'
            });
        });

        test('defaults the DFC docbroker to empty and the port to 1489', async () => {
            await manager.openConnection('Defaults');

            assert.strictEqual(bridge.connectCalls[0].docbroker, '');
            assert.strictEqual(bridge.connectCalls[0].port, 1489);
        });

        test('two sequential calls make one bridge connect and one prompt, and return the same connection', async () => {
            const first = await manager.openConnection('Rest');
            const second = await manager.openConnection('Rest');

            assert.strictEqual(bridge.connectCalls.length, 1);
            assert.strictEqual(manager.prompts.length, 1);
            assert.ok(first);
            assert.strictEqual(second, first);
        });

        test('two concurrent calls make one bridge connect and one prompt, and return the same connection', async () => {
            const [first, second] = await Promise.all([
                manager.openConnection('Rest'),
                manager.openConnection('Rest')
            ]);

            assert.strictEqual(bridge.connectCalls.length, 1);
            assert.strictEqual(manager.prompts.length, 1);
            assert.ok(first);
            assert.strictEqual(second, first);
        });

        test('resolves to undefined and makes no bridge call when the prompt is cancelled', async () => {
            manager.answers = [undefined];

            const connection = await manager.openConnection('Rest');

            assert.strictEqual(connection, undefined);
            assert.strictEqual(bridge.connectCalls.length, 0);
            assert.strictEqual(bridge.ensureRunningCalls.length, 0);
        });

        test('prompts again when a connect with stored credentials fails', async () => {
            await manager.openConnection('Rest');
            await manager.disconnect('Rest');
            bridge.failConnect = true;

            await assert.rejects(manager.openConnection('Rest'));
            assert.strictEqual(manager.prompts.length, 1);

            bridge.failConnect = false;
            await manager.openConnection('Rest');

            assert.strictEqual(manager.prompts.length, 2);
        });
    });

    suite('connect', () => {
        test('selects the named connection without the picker', async () => {
            await manager.connect('Rest');

            assert.strictEqual(manager.getSelectedConnection()?.name, 'Rest');
            assert.deepStrictEqual(selectionEvents, ['Rest']);
        });

        test('selecting an open connection makes no bridge call', async () => {
            await manager.connect('Rest');
            await manager.connect('Dfc');

            await manager.connect('Rest');

            assert.strictEqual(bridge.connectCalls.length, 2);
            assert.strictEqual(manager.prompts.length, 2);
            assert.strictEqual(manager.getSelectedConnection()?.name, 'Rest');
        });

        test('selecting a second connection leaves the first one open', async () => {
            await manager.connect('Rest');
            await manager.connect('Dfc');

            assert.ok(manager.getOpenConnection('Rest'));
            assert.strictEqual(manager.getSelectedConnection()?.name, 'Dfc');
            assert.deepStrictEqual(bridge.disconnectCalls, []);
        });
    });

    suite('disconnect', () => {
        test('reconnects with the stored credentials and does not prompt on the next open', async () => {
            await manager.openConnection('Rest');
            await manager.disconnect('Rest');

            const reopened = await manager.openConnection('Rest');

            assert.ok(reopened);
            assert.strictEqual(manager.prompts.length, 1);
            assert.strictEqual(bridge.connectCalls.length, 2);
        });

        test('closes only the named session, fires both events and clears the selection when it was selected', async () => {
            await manager.connect('Rest');
            await manager.connect('Dfc');
            const dfcSession = manager.getOpenConnection('Dfc')?.sessionId;
            selectionEvents = [];
            openConnectionsEvents = 0;

            await manager.disconnect('Dfc');

            assert.deepStrictEqual(bridge.disconnectCalls, [dfcSession]);
            assert.ok(manager.getOpenConnection('Rest'));
            assert.strictEqual(manager.getOpenConnection('Dfc'), undefined);
            assert.strictEqual(manager.getSelectedConnection(), undefined);
            assert.deepStrictEqual(selectionEvents, [undefined]);
            assert.strictEqual(openConnectionsEvents, 1);
        });

        test('keeps the selection when the disconnected connection is not selected', async () => {
            await manager.connect('Rest');
            await manager.connect('Dfc');
            selectionEvents = [];
            openConnectionsEvents = 0;

            await manager.disconnect('Rest');

            assert.strictEqual(manager.getSelectedConnection()?.name, 'Dfc');
            assert.deepStrictEqual(selectionEvents, []);
            assert.strictEqual(openConnectionsEvents, 1);
        });

        test('removes the connection when the bridge disconnect fails', async () => {
            await manager.openConnection('Rest');
            bridge.failDisconnect = true;

            await manager.disconnect('Rest');

            assert.strictEqual(manager.getOpenConnection('Rest'), undefined);
        });

        test('disconnectAll closes every open session', async () => {
            const first = await manager.openConnection('Rest');
            const second = await manager.openConnection('Dfc');

            await manager.disconnectAll();

            assert.deepStrictEqual(bridge.disconnectCalls.sort(), [first?.sessionId, second?.sessionId].sort());
            assert.strictEqual(manager.getOpenConnection('Rest'), undefined);
            assert.strictEqual(manager.getOpenConnection('Dfc'), undefined);
        });
    });

    suite('switchUser', () => {
        test('closes the old session, opens a new one and replaces the stored credentials', async () => {
            await manager.connect('Rest');
            const oldSession = manager.getOpenConnection('Rest')?.sessionId;
            manager.answers = [{ username: 'other', password: 'secret' }];

            await manager.switchUser('Rest');

            const switched = manager.getOpenConnection('Rest');
            assert.deepStrictEqual(bridge.disconnectCalls, [oldSession]);
            assert.strictEqual(switched?.username, 'other');
            assert.notStrictEqual(switched?.sessionId, oldSession);
            assert.strictEqual(manager.getSelectedConnection(), switched);
            assert.deepStrictEqual(manager.prompts[1], { name: 'Rest', askUsername: true });

            await manager.disconnect('Rest');
            await manager.openConnection('Rest');

            assert.strictEqual(manager.prompts.length, 2);
            assert.strictEqual(bridge.connectCalls[bridge.connectCalls.length - 1].username, 'other');
        });
    });

    suite('settings change', () => {
        test('closes removed and changed open connections, leaves an unchanged one open and fires the event', async () => {
            await manager.openConnection('Rest');
            await manager.openConnection('Dfc');
            const defaults = await manager.openConnection('Defaults');
            const restSession = manager.getOpenConnection('Rest')?.sessionId;
            const dfcSession = manager.getOpenConnection('Dfc')?.sessionId;

            await manager.changeConnections([{ ...dfcConnection, docbroker: 'other' }, defaultsConnection]);

            assert.deepStrictEqual(bridge.disconnectCalls.sort(), [restSession, dfcSession].sort());
            assert.strictEqual(manager.getOpenConnection('Rest'), undefined);
            assert.strictEqual(manager.getOpenConnection('Dfc'), undefined);
            assert.strictEqual(manager.getOpenConnection('Defaults'), defaults);
            assert.strictEqual(connectionsEvents, 1);
        });

        test('clears the credentials of a changed connection that is not open, and keeps those of an unchanged one', async () => {
            await manager.openConnection('Rest');
            await manager.openConnection('Dfc');
            await manager.disconnectAll();

            await manager.changeConnections([{ ...restConnection, username: 'other' }, dfcConnection, defaultsConnection]);
            await manager.openConnection('Rest');
            await manager.openConnection('Dfc');

            assert.deepStrictEqual(manager.prompts.map(p => p.name), ['Rest', 'Dfc', 'Rest']);
        });
    });

    suite('testConnection', () => {
        test('connects with the given values and disconnects, leaving no open connection', async () => {
            await manager.testConnection(dfcConnection, { username: 'tester', password: 'secret' });

            assert.deepStrictEqual(bridge.ensureRunningCalls, ['dfc']);
            assert.deepStrictEqual(bridge.connectCalls, [{
                docbroker: 'broker',
                port: 1500,
                repository: 'repo',
                username: 'tester',
                password: 'secret'
            }]);
            assert.deepStrictEqual(bridge.disconnectCalls, ['session-1']);
            assert.strictEqual(manager.getOpenConnection('Dfc'), undefined);
            assert.deepStrictEqual(selectionEvents, []);
            assert.strictEqual(openConnectionsEvents, 0);
        });

        test('rejects with the bridge error and does not disconnect when connect fails', async () => {
            bridge.failConnect = true;

            await assert.rejects(
                manager.testConnection(restConnection, { username: 'tester', password: 'secret' }),
                /authentication failed/
            );
            assert.deepStrictEqual(bridge.disconnectCalls, []);
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

suite('Notebook Connection Resolution Test Suite', () => {
    let bridge: FakeBridge;
    let manager: TestConnectionManager;
    let selected: RepositoryConnection | undefined;

    setup(async () => {
        bridge = new FakeBridge();
        manager = new TestConnectionManager(bridge, [restConnection, dfcConnection]);
        await manager.connect('Dfc');
        selected = manager.getSelectedConnection();
        assert.ok(selected);
    });

    teardown(() => {
        manager.dispose();
    });

    test('a bound notebook resolves to its bound connection while another connection is selected', async () => {
        const { connection } = await resolveNotebookConnection(manager, { connection: 'Rest' });

        assert.strictEqual(connection?.name, 'Rest');
        assert.strictEqual(manager.getSelectedConnection(), selected);
    });

    test('a bound notebook whose prompt is cancelled resolves to no connection', async () => {
        manager.answers = [undefined];

        const { connection, error } = await resolveNotebookConnection(manager, { connection: 'Rest' });

        assert.strictEqual(connection, undefined);
        assert.ok(error);
        assert.deepStrictEqual(manager.prompts.map(p => p.name), ['Dfc', 'Rest']);
    });

    test('an unbound notebook resolves to the selected connection', async () => {
        const { connection } = await resolveNotebookConnection(manager, {});

        assert.strictEqual(connection, selected);
    });

    test('a binding that is not in the configured connections is reported as not found', async () => {
        const { connection, error } = await resolveNotebookConnection(manager, { connection: 'Missing' });

        assert.strictEqual(connection, undefined);
        assert.ok(error);
        assert.strictEqual(manager.prompts.length, 1);
        assert.strictEqual(bridge.connectCalls.length, 1);
    });

    test('an object ID clicked in a bound notebook opens the Dump tab of the bound connection', async () => {
        const dumps: [string, DumpTarget][] = [];
        const workspaces = { showDump: async (name: string, target: DumpTarget) => { dumps.push([name, target]); } };

        await dumpFromNotebook(manager, workspaces, { connection: 'Rest' }, '0900000180000001');

        assert.deepStrictEqual(dumps, [['Rest', { kind: 'object', objectId: '0900000180000001' }]]);
    });
});

suite('Notebook Binding Test Suite', () => {
    test('Open notebook binds an unbound notebook, opens one bound to this connection and asks for another', () => {
        assert.strictEqual(openNotebookAction(undefined, 'conn1'), 'bind');
        assert.strictEqual(openNotebookAction('conn1', 'conn1'), 'open');
        assert.strictEqual(openNotebookAction('conn2', 'conn1'), 'ask');
    });

    test('bindNotebook writes the connection name and keeps the other metadata', async () => {
        const data = new vscode.NotebookData([
            new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'select 1 from dm_server_config', 'dql')
        ]);
        data.metadata = { connection: 'conn2', author: 'test' };
        const notebook = await vscode.workspace.openNotebookDocument('dctmbook', data);

        assert.strictEqual(await bindNotebook(notebook, 'conn1'), true);

        assert.strictEqual(notebook.metadata.connection, 'conn1');
        assert.strictEqual(notebook.metadata.author, 'test');
    });
});
