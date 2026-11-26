import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { ConnectionManager, Credentials, DocumentumConnection } from '../../connectionManager';
import { describeConnection } from '../../connectionForm';
import { DctmBridge, DfcConnectParams } from '../../dctmBridge';
import {
    NOT_BOUND_MESSAGE,
    bindNotebook,
    openNotebookAction,
    resolveNotebookConnection
} from '../../notebook/notebookConnection';
import { dumpFromNotebook } from '../../notebook';
import { executeCells } from '../../notebook/notebookController';
import { DumpTarget } from '../../workspace/dumpTab';
import { DocumentConnections } from '../../documentConnections';
import { documentConnection } from '../../executeDql';

class FakeBridge {
    ensureRunningCalls: ('dfc' | 'rest')[] = [];
    connectCalls: DfcConnectParams[] = [];
    disconnectCalls: string[] = [];
    failConnect = false;
    failDisconnect = false;
    connectGate: Promise<void> | undefined;

    async ensureRunning(connectionType: 'dfc' | 'rest'): Promise<void> {
        this.ensureRunningCalls.push(connectionType);
    }

    async connect(params: DfcConnectParams): Promise<string> {
        this.connectCalls.push(params);
        await this.connectGate;
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

interface PickCall {
    labels: string[];
    descriptions: (string | undefined)[];
}

class TestConnectionManager extends ConnectionManager {
    prompts: { name: string }[] = [];
    answers: (Credentials | undefined)[] = [];
    pickCalls: PickCall[] = [];
    pickAnswers: (string | undefined)[] = [];

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

    protected async promptCredentials(config: DocumentumConnection): Promise<Credentials | undefined> {
        this.prompts.push({ name: config.name });
        return this.answers.length > 0 ? this.answers.shift() : { username: 'user', password: 'pass' };
    }

    protected showQuickPick<T extends vscode.QuickPickItem>(items: T[]): Thenable<T | undefined> {
        this.pickCalls.push({ labels: items.map(i => i.label), descriptions: items.map(i => i.description) });
        const answer = this.pickAnswers.shift();
        return Promise.resolve(items.find(item => (item as { connectionName?: string }).connectionName === answer));
    }
}

class FakeMemento implements vscode.Memento {
    private readonly values = new Map<string, unknown>();

    keys(): readonly string[] {
        return [...this.values.keys()];
    }

    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.values.has(key) ? this.values.get(key) as T : defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.values.set(key, value);
    }
}

async function notebookWith(metadata: { [key: string]: unknown }): Promise<vscode.NotebookDocument> {
    const data = new vscode.NotebookData([
        new vscode.NotebookCellData(vscode.NotebookCellKind.Code, 'select 1 from dm_server_config', 'dql')
    ]);
    data.metadata = metadata;
    return vscode.workspace.openNotebookDocument('dctmbook', data);
}

function fileDocument(path: string): vscode.TextDocument {
    return { uri: vscode.Uri.file(path) } as vscode.TextDocument;
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
    let openConnectionsEvents: number;
    let connectionsEvents: number;

    setup(() => {
        bridge = new FakeBridge();
        manager = new TestConnectionManager(bridge, [restConnection, dfcConnection, defaultsConnection]);
        openConnectionsEvents = 0;
        connectionsEvents = 0;
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
        test('opens the named connection without the pick and fires the open connections event', async () => {
            const connection = await manager.connect('Rest');

            assert.strictEqual(connection, manager.getOpenConnection('Rest'));
            assert.strictEqual(openConnectionsEvents, 1);
            assert.deepStrictEqual(manager.pickCalls, []);
        });

        test('connecting an open connection makes no bridge call', async () => {
            await manager.connect('Rest');
            await manager.connect('Dfc');

            await manager.connect('Rest');

            assert.strictEqual(bridge.connectCalls.length, 2);
            assert.strictEqual(manager.prompts.length, 2);
        });

        test('connecting a second connection leaves the first one open', async () => {
            await manager.connect('Rest');
            await manager.connect('Dfc');

            assert.deepStrictEqual(manager.getOpenConnections().map(c => c.name), ['Rest', 'Dfc']);
            assert.deepStrictEqual(bridge.disconnectCalls, []);
        });

        test('with no name shows every connection with the open ones first, while one is open', async () => {
            await manager.connect('Dfc');
            manager.pickAnswers = ['Rest'];

            const connection = await manager.connect();

            assert.strictEqual(connection?.name, 'Rest');
            assert.deepStrictEqual(manager.pickCalls, [{
                labels: ['Dfc', 'Rest', 'Defaults'],
                descriptions: ['connected', 'http://dctm:8080/dctm-rest', 'DFC']
            }]);
        });
    });

    suite('pickConnection', () => {
        test('returns the only open connection without showing the pick', async () => {
            const open = await manager.connect('Dfc');

            assert.strictEqual(await manager.pickConnection(), open);
            assert.deepStrictEqual(manager.pickCalls, []);
        });

        test('with two open connections shows the pick with the open ones first', async () => {
            await manager.connect('Dfc');
            await manager.connect('Defaults');
            manager.pickAnswers = ['Defaults'];

            const connection = await manager.pickConnection();

            assert.strictEqual(connection, manager.getOpenConnection('Defaults'));
            assert.deepStrictEqual(manager.pickCalls[0].labels, ['Dfc', 'Defaults', 'Rest']);
        });

        test('with no open connection shows the pick and connects the one picked', async () => {
            manager.pickAnswers = ['Rest'];

            const connection = await manager.pickConnection();

            assert.strictEqual(connection, manager.getOpenConnection('Rest'));
            assert.deepStrictEqual(manager.pickCalls[0].labels, ['Rest', 'Dfc', 'Defaults']);
        });

        test('a cancelled pick connects nothing', async () => {
            manager.pickAnswers = [undefined];

            assert.strictEqual(await manager.pickConnection(), undefined);
            assert.deepStrictEqual(bridge.connectCalls, []);
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

        test('closes only the named session and fires the open connections event', async () => {
            await manager.connect('Rest');
            await manager.connect('Dfc');
            const dfcSession = manager.getOpenConnection('Dfc')?.sessionId;
            openConnectionsEvents = 0;

            await manager.disconnect('Dfc');

            assert.deepStrictEqual(bridge.disconnectCalls, [dfcSession]);
            assert.ok(manager.getOpenConnection('Rest'));
            assert.strictEqual(manager.getOpenConnection('Dfc'), undefined);
            assert.strictEqual(openConnectionsEvents, 1);
        });

        test('with no name and one open connection disconnects it without the pick', async () => {
            await manager.connect('Rest');

            await manager.disconnect();

            assert.strictEqual(manager.getOpenConnection('Rest'), undefined);
            assert.deepStrictEqual(manager.pickCalls, []);
        });

        test('with no name and two open connections asks which open connection to disconnect', async () => {
            await manager.connect('Rest');
            await manager.connect('Defaults');
            manager.pickAnswers = ['Defaults'];

            await manager.disconnect();

            assert.deepStrictEqual(manager.pickCalls[0].labels, ['Rest', 'Defaults']);
            assert.ok(manager.getOpenConnection('Rest'));
            assert.strictEqual(manager.getOpenConnection('Defaults'), undefined);
        });

        test('with no name and no open connection shows no pick and disconnects nothing', async () => {
            await manager.disconnect();

            assert.deepStrictEqual(manager.pickCalls, []);
            assert.deepStrictEqual(bridge.disconnectCalls, []);
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

    suite('settings change while a connect is in progress', () => {
        const changedMessage = 'Connection "Rest" was changed in settings. Connect again to use the new settings.';

        async function heldOpen(): Promise<{ opening: Promise<unknown>; release: () => void }> {
            let release: () => void = () => undefined;
            bridge.connectGate = new Promise<void>(resolve => {
                release = resolve;
            });
            const opening = manager.openConnection('Rest');
            while (bridge.connectCalls.length === 0) {
                await new Promise(resolve => setTimeout(resolve, 0));
            }
            return { opening, release };
        }

        test('a changed connection makes the open reject, disconnects the session and keeps no credentials', async () => {
            const { opening, release } = await heldOpen();

            await manager.changeConnections([{ ...restConnection, repository: 'other' }, dfcConnection, defaultsConnection]);
            release();

            await assert.rejects(opening, { message: changedMessage });
            assert.deepStrictEqual(bridge.disconnectCalls, ['session-1']);
            assert.strictEqual(manager.getOpenConnection('Rest'), undefined);
            bridge.connectGate = undefined;
            await manager.openConnection('Rest');
            assert.deepStrictEqual(manager.prompts.map(p => p.name), ['Rest', 'Rest']);
        });

        test('a removed connection makes the open reject, disconnects the session and keeps no credentials', async () => {
            const { opening, release } = await heldOpen();

            await manager.changeConnections([dfcConnection, defaultsConnection]);
            release();

            await assert.rejects(opening, { message: changedMessage });
            assert.deepStrictEqual(bridge.disconnectCalls, ['session-1']);
            assert.strictEqual(manager.getOpenConnection('Rest'), undefined);
            bridge.connectGate = undefined;
            await manager.changeConnections([restConnection, dfcConnection, defaultsConnection]);
            await manager.openConnection('Rest');
            assert.deepStrictEqual(manager.prompts.map(p => p.name), ['Rest', 'Rest']);
        });

        test('a failed disconnect of the unused session still rejects with the settings error', async () => {
            const { opening, release } = await heldOpen();
            bridge.failDisconnect = true;

            await manager.changeConnections([dfcConnection, defaultsConnection]);
            release();

            await assert.rejects(opening, { message: changedMessage });
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

    setup(async () => {
        bridge = new FakeBridge();
        manager = new TestConnectionManager(bridge, [restConnection, dfcConnection]);
        await manager.connect('Dfc');
    });

    teardown(() => {
        manager.dispose();
    });

    test('a bound notebook resolves to its bound connection while another connection is open', async () => {
        const notebook = await notebookWith({ connection: 'Rest' });

        const { connection } = await resolveNotebookConnection(manager, notebook);

        assert.strictEqual(connection, manager.getOpenConnection('Rest'));
    });

    test('a bound notebook whose prompt is cancelled resolves to no connection', async () => {
        const notebook = await notebookWith({ connection: 'Rest' });
        manager.answers = [undefined];

        const { connection, error } = await resolveNotebookConnection(manager, notebook);

        assert.strictEqual(connection, undefined);
        assert.ok(error);
        assert.deepStrictEqual(manager.prompts.map(p => p.name), ['Dfc', 'Rest']);
    });

    test('an unbound notebook binds the picked connection and resolves to it', async () => {
        const notebook = await notebookWith({ author: 'test' });
        const offered: (string | undefined)[] = [];

        const { connection } = await resolveNotebookConnection(manager, notebook, async current => {
            offered.push(current);
            return 'Rest';
        });

        assert.deepStrictEqual(offered, [undefined]);
        assert.strictEqual(connection, manager.getOpenConnection('Rest'));
        assert.strictEqual(notebook.metadata.connection, 'Rest');
        assert.strictEqual(notebook.metadata.author, 'test');
    });

    test('an unbound notebook whose picker is cancelled reports that it is not bound', async () => {
        const notebook = await notebookWith({});

        const { connection, error } = await resolveNotebookConnection(manager, notebook, async () => undefined);

        assert.strictEqual(connection, undefined);
        assert.strictEqual(error, NOT_BOUND_MESSAGE);
        assert.strictEqual(notebook.metadata.connection, undefined);
    });

    test('Run All on an unbound notebook asks once and ends every cell with the not-bound error', async () => {
        const data = new vscode.NotebookData(['select 1', 'select 2', 'select 3'].map(query =>
            new vscode.NotebookCellData(vscode.NotebookCellKind.Code, query, 'dql')
        ));
        const notebook = await vscode.workspace.openNotebookDocument('dctmbook', data);
        let picks = 0;
        const executed: number[] = [];
        const failed: [number, string][] = [];

        await executeCells(
            notebook.getCells(),
            () => resolveNotebookConnection(manager, notebook, async () => { picks++; return undefined; }),
            async cell => { executed.push(cell.index); },
            (cell, message) => failed.push([cell.index, message])
        );

        assert.strictEqual(picks, 1);
        assert.deepStrictEqual(executed, []);
        assert.deepStrictEqual(failed, [[0, NOT_BOUND_MESSAGE], [1, NOT_BOUND_MESSAGE], [2, NOT_BOUND_MESSAGE]]);
    });

    test('Run All on an unbound notebook binds once and runs every cell on the picked connection', async () => {
        const data = new vscode.NotebookData(['select 1', 'select 2'].map(query =>
            new vscode.NotebookCellData(vscode.NotebookCellKind.Code, query, 'dql')
        ));
        const notebook = await vscode.workspace.openNotebookDocument('dctmbook', data);
        let picks = 0;
        const executed: [number, string][] = [];

        await executeCells(
            notebook.getCells(),
            () => resolveNotebookConnection(manager, notebook, async () => { picks++; return 'Rest'; }),
            async (cell, connection) => { executed.push([cell.index, connection.name]); },
            () => assert.fail('no cell should fail')
        );

        assert.strictEqual(picks, 1);
        assert.deepStrictEqual(executed, [[0, 'Rest'], [1, 'Rest']]);
        assert.strictEqual(notebook.metadata.connection, 'Rest');
    });

    test('a binding that is not in the configured connections is reported as not found', async () => {
        const notebook = await notebookWith({ connection: 'Missing' });

        const { connection, error } = await resolveNotebookConnection(manager, notebook);

        assert.strictEqual(connection, undefined);
        assert.ok(error);
        assert.strictEqual(manager.prompts.length, 1);
        assert.strictEqual(bridge.connectCalls.length, 1);
    });

    test('an object ID clicked in a bound notebook opens the Dump tab of the bound connection', async () => {
        const dumps: [string, DumpTarget][] = [];
        const workspaces = { showDump: async (name: string, target: DumpTarget) => { dumps.push([name, target]); } };
        const notebook = await notebookWith({ connection: 'Rest' });

        await dumpFromNotebook(manager, workspaces, notebook, '0900000180000001');

        assert.deepStrictEqual(dumps, [['Rest', { kind: 'object', objectId: '0900000180000001' }]]);
    });
});

suite('DQL Document Connection Test Suite', () => {
    let bridge: FakeBridge;
    let manager: TestConnectionManager;
    let documents: DocumentConnections;

    setup(() => {
        bridge = new FakeBridge();
        manager = new TestConnectionManager(bridge, [restConnection, dfcConnection]);
        documents = new DocumentConnections(new FakeMemento());
    });

    teardown(() => {
        documents.dispose();
        manager.dispose();
    });

    test('a document with no link gets the picked connection as its link, and the next run uses the link', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'select 1' });
        manager.pickAnswers = ['Rest'];

        const first = await documentConnection(manager, documents, document);
        const second = await documentConnection(manager, documents, document);

        assert.strictEqual(first, manager.getOpenConnection('Rest'));
        assert.strictEqual(second, first);
        assert.strictEqual(documents.connectionName(document), 'Rest');
        assert.strictEqual(manager.pickCalls.length, 1);
    });

    test('a linked connection that is not open is connected', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'select 1' });
        await documents.link(document, 'Dfc');

        const connection = await documentConnection(manager, documents, document);

        assert.strictEqual(connection, manager.getOpenConnection('Dfc'));
        assert.deepStrictEqual(manager.pickCalls, []);
    });

    test('a link to a connection that is no longer configured asks again', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'select 1' });
        await documents.link(document, 'Missing');
        manager.pickAnswers = ['Dfc'];

        const connection = await documentConnection(manager, documents, document);

        assert.strictEqual(connection?.name, 'Dfc');
        assert.strictEqual(documents.connectionName(document), 'Dfc');
        assert.strictEqual(manager.pickCalls.length, 1);
    });

    test('with one open connection a document with no link uses it without asking', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'select 1' });
        const open = await manager.connect('Dfc');

        const connection = await documentConnection(manager, documents, document);

        assert.strictEqual(connection, open);
        assert.strictEqual(documents.connectionName(document), 'Dfc');
        assert.deepStrictEqual(manager.pickCalls, []);
    });

    test('a cancelled pick returns no connection and stores no link', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'select 1' });
        manager.pickAnswers = [undefined];

        const connection = await documentConnection(manager, documents, document);

        assert.strictEqual(connection, undefined);
        assert.strictEqual(documents.connectionName(document), undefined);
        assert.strictEqual(manager.pickCalls.length, 1);
    });
});

suite('Document Connections Test Suite', () => {
    let state: FakeMemento;
    let documents: DocumentConnections;

    setup(() => {
        state = new FakeMemento();
        documents = new DocumentConnections(state);
    });

    teardown(() => {
        documents.dispose();
    });

    test('a link survives a new DocumentConnections built on the same workspace state', async () => {
        await documents.link(fileDocument('/work/query.dql'), 'Rest');

        const reloaded = new DocumentConnections(state);

        assert.strictEqual(reloaded.connectionName(fileDocument('/work/query.dql')), 'Rest');
        reloaded.dispose();
    });

    test('an untitled document link is kept in memory only', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'select 1' });

        await documents.link(document, 'Rest');

        assert.strictEqual(documents.connectionName(document), 'Rest');
        assert.deepStrictEqual(state.keys(), []);
    });

    test('a renamed file keeps its link under the new URI, and so does a file in a renamed folder', async () => {
        await documents.link(fileDocument('/work/query.dql'), 'Rest');
        await documents.link(fileDocument('/work/dql/users.dql'), 'Dfc');

        await documents.moveLinks([
            { oldUri: vscode.Uri.file('/work/query.dql'), newUri: vscode.Uri.file('/work/renamed.dql') },
            { oldUri: vscode.Uri.file('/work/dql'), newUri: vscode.Uri.file('/work/queries') }
        ]);

        assert.strictEqual(documents.connectionName(fileDocument('/work/query.dql')), undefined);
        assert.strictEqual(documents.connectionName(fileDocument('/work/renamed.dql')), 'Rest');
        assert.strictEqual(documents.connectionName(fileDocument('/work/queries/users.dql')), 'Dfc');
    });

    test('a deleted file loses its link and other links stay', async () => {
        await documents.link(fileDocument('/work/query.dql'), 'Rest');
        await documents.link(fileDocument('/work/other.dql'), 'Dfc');

        await documents.removeLinks([vscode.Uri.file('/work/query.dql')]);

        assert.strictEqual(documents.connectionName(fileDocument('/work/query.dql')), undefined);
        assert.strictEqual(documents.connectionName(fileDocument('/work/other.dql')), 'Dfc');
    });

    suite('an untitled document saved to a file', () => {
        let folder: string;

        setup(() => {
            folder = fs.mkdtempSync(path.join(os.tmpdir(), 'dctm-links-'));
        });

        teardown(async () => {
            await vscode.commands.executeCommand('workbench.action.closeAllEditors');
            fs.rmSync(folder, { recursive: true, force: true });
        });

        async function untitledAt(name: string, text: string): Promise<vscode.TextDocument> {
            const document = await vscode.workspace.openTextDocument(
                vscode.Uri.file(path.join(folder, name)).with({ scheme: 'untitled' }));
            const edit = new vscode.WorkspaceEdit();
            edit.insert(document.uri, new vscode.Position(0, 0), text);
            await vscode.workspace.applyEdit(edit);
            return document;
        }

        // The link is stored from the save event, after save() has resolved.
        async function settle(): Promise<void> {
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        test('gives the saved file the link of the untitled document in the workspace state', async () => {
            const untitled = await untitledAt('saved.dql', 'select object_name from dm_cabinet');
            await documents.link(untitled, 'Rest');

            await untitled.save();
            await settle();

            const saved = vscode.Uri.file(path.join(folder, 'saved.dql')).toString();
            assert.deepStrictEqual(state.get('dctm.documentLinks'), { [saved]: 'Rest' });
        });

        test('a saved file that already has a link keeps it', async () => {
            await documents.link(fileDocument(path.join(folder, 'linked.dql')), 'Dfc');
            const untitled = await untitledAt('linked.dql', 'select object_name from dm_cabinet');
            await documents.link(untitled, 'Rest');

            await untitled.save();
            await settle();

            assert.strictEqual(documents.connectionName(fileDocument(path.join(folder, 'linked.dql'))), 'Dfc');
        });

        test('two open untitled documents with the same text and different links give the saved file no link', async () => {
            const untitled = await untitledAt('shared.dql', 'select object_name from dm_cabinet');
            await documents.link(untitled, 'Rest');
            const other = await vscode.workspace.openTextDocument({ language: 'dql', content: 'select object_name from dm_cabinet' });
            await documents.link(other, 'Dfc');

            await untitled.save();
            await settle();

            assert.strictEqual(documents.connectionName(fileDocument(path.join(folder, 'shared.dql'))), undefined);
        });
    });

    test('the connection of a notebook cell is its notebook binding', async () => {
        const notebook = await notebookWith({ connection: 'Rest' });

        assert.strictEqual(documents.connectionName(notebook.cellAt(0).document), 'Rest');
    });

    test('linking a notebook cell binds its notebook', async () => {
        const notebook = await notebookWith({});

        await documents.link(notebook.cellAt(0).document, 'Dfc');

        assert.strictEqual(notebook.metadata.connection, 'Dfc');
        assert.deepStrictEqual(state.keys(), []);
    });

    test('fires the change event when a link changes and when a notebook binding changes', async () => {
        const notebook = await notebookWith({});
        let fired = 0;
        documents.onDidChange(() => fired++);

        await documents.link(fileDocument('/work/query.dql'), 'Rest');
        await bindNotebook(notebook, 'Dfc');

        assert.strictEqual(fired, 2);
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
