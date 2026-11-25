import * as assert from 'assert';
import * as vscode from 'vscode';
import { ApiMethodRequest, ApiMethodResponse } from '../../apiExecutor';
import { DocumentumConnection } from '../../connectionManager';
import { DctmBridge } from '../../dctmBridge';
import { DqlResult } from '../../dqlExecutor';
import { RepositoryConnection } from '../../repositoryConnection';
import { TypeCache } from '../../typeCache';
import { ApiExecute } from '../../workspace/apiTab';
import {
    ConnectionWorkspaces,
    RestoredTabs,
    WorkspaceConnections,
    WorkspaceNotebooks,
    WorkspaceStateMessage
} from '../../workspace/connectionWorkspace';
import { DqlExecute } from '../../workspace/dqlTab';

interface FakePanel {
    panel: vscode.WebviewPanel;
    title(): string;
    posted: unknown[];
    reveals: number;
    disposed: boolean;
    send(message: unknown): Promise<void>;
}

function fakePanel(title: string): FakePanel {
    let receive: ((message: unknown) => Promise<void>) | undefined;
    const disposeListeners: Array<() => void> = [];
    const disposable = { dispose: () => undefined };
    const fake: FakePanel = {
        panel: undefined as unknown as vscode.WebviewPanel,
        title: () => panel.title,
        posted: [],
        reveals: 0,
        disposed: false,
        send: message => receive!(message)
    };
    const panel = {
        title,
        webview: {
            html: '',
            options: {},
            cspSource: 'vscode-resource:',
            asWebviewUri: (uri: vscode.Uri) => uri,
            postMessage: async (message: unknown) => {
                fake.posted.push(message);
                return true;
            },
            onDidReceiveMessage: (handler: (message: unknown) => Promise<void>) => {
                receive = handler;
                return disposable;
            }
        },
        reveal: () => {
            fake.reveals++;
        },
        onDidDispose: (listener: () => void) => {
            disposeListeners.push(listener);
            return disposable;
        },
        dispose: () => {
            if (!fake.disposed) {
                fake.disposed = true;
                disposeListeners.forEach(listener => listener());
            }
        }
    };
    fake.panel = panel as unknown as vscode.WebviewPanel;
    return fake;
}

class FakeConnections implements WorkspaceConnections {
    readonly open = new Map<string, RepositoryConnection>();
    connections: DocumentumConnection[] = [
        { name: 'conn1', type: 'dfc', repository: 'repo1', docbroker: 'host' },
        { name: 'conn2', type: 'rest', repository: 'repo2', endpoint: 'http://host' }
    ];
    private readonly openEmitter = new vscode.EventEmitter<void>();
    private readonly connectionsEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeOpenConnections = this.openEmitter.event;
    readonly onDidChangeConnections = this.connectionsEmitter.event;

    getOpenConnection(name: string): RepositoryConnection | undefined {
        return this.open.get(name);
    }

    getConnections(): DocumentumConnection[] {
        return this.connections;
    }

    async connect(name?: string): Promise<RepositoryConnection | undefined> {
        return name ? this.openNow(name) : undefined;
    }

    openNow(name: string, typeCache?: TypeCache): RepositoryConnection {
        const cache = { onRefresh: new vscode.EventEmitter<void>().event, getNames: () => [] };
        const connection = {
            name,
            username: 'dmadmin',
            sessionId: `session-${name}`,
            typeCache: typeCache ?? cache,
            userCache: cache,
            groupCache: cache
        } as unknown as RepositoryConnection;
        this.open.set(name, connection);
        this.openEmitter.fire();
        return connection;
    }

    close(name: string): void {
        this.open.delete(name);
        this.openEmitter.fire();
    }

    setConnections(connections: DocumentumConnection[]): void {
        this.connections = connections;
        this.connectionsEmitter.fire();
    }
}

class FakeApiExecutor implements ApiExecute {
    readonly calls: Array<{ request: ApiMethodRequest; connection: RepositoryConnection }> = [];

    async execute(request: ApiMethodRequest, connection: RepositoryConnection): Promise<ApiMethodResponse> {
        this.calls.push({ request, connection });
        return { result: `result of ${request.method}`, resultType: 'String', executionTimeMs: 5 };
    }
}

class FakeDqlExecutor implements DqlExecute {
    readonly calls: Array<{ query: string; connection: RepositoryConnection }> = [];

    async execute(query: string, connection: RepositoryConnection): Promise<DqlResult> {
        this.calls.push({ query, connection });
        if (query.includes('bad')) {
            throw new Error('[DM_QUERY_E_SYNTAX]error: syntax error');
        }
        return { columns: ['r_object_id'], rows: [{ r_object_id: '0c00000180000101' }], rowCount: 1, executionTime: 7, query };
    }
}

class FakeTypeBridge {
    detailCalls = 0;

    async getTypes() {
        return [
            { name: 'dm_document', superType: null, isInternal: false },
            { name: 'my_custom_type', superType: 'dm_document', isInternal: false }
        ];
    }

    async getTypeDetails(_sessionId: string, typeName: string) {
        this.detailCalls++;
        return {
            name: typeName,
            superType: null,
            isInternal: false,
            attributes: [{ name: 'custom_code', dataType: 'string', length: 32, isRepeating: false, isInherited: false }]
        };
    }
}

async function loadedTypeCache(bridge: FakeTypeBridge): Promise<TypeCache> {
    const cache = new TypeCache(bridge as unknown as DctmBridge, 'session-types');
    await cache.refresh();
    return cache;
}

class FakeNotebooks implements WorkspaceNotebooks {
    readonly calls: string[] = [];

    async newNotebook(connectionName: string): Promise<void> {
        this.calls.push(`new ${connectionName}`);
    }

    async openNotebook(connectionName: string): Promise<void> {
        this.calls.push(`open ${connectionName}`);
    }
}

interface Harness {
    workspaces: ConnectionWorkspaces;
    connections: FakeConnections;
    panels: FakePanel[];
    apiExecutor: FakeApiExecutor;
    dqlExecutor: FakeDqlExecutor;
    notebooks: FakeNotebooks;
}

function harness(restoredTabs: RestoredTabs = { activate: async () => false }): Harness {
    const connections = new FakeConnections();
    const panels: FakePanel[] = [];
    const apiExecutor = new FakeApiExecutor();
    const dqlExecutor = new FakeDqlExecutor();
    const notebooks = new FakeNotebooks();
    const services = { apiExecutor, dqlExecutor, notebooks, documents: { link: async () => undefined } };
    const workspaces = new ConnectionWorkspaces(vscode.Uri.file('/extension'), connections, services, title => {
        const fake = fakePanel(title);
        panels.push(fake);
        return fake.panel;
    }, restoredTabs);
    return { workspaces, connections, panels, apiExecutor, dqlExecutor, notebooks };
}

function postedOfType(panel: FakePanel, type: string): Array<Record<string, unknown>> {
    return panel.posted.filter(message => (message as { type?: string }).type === type) as Array<Record<string, unknown>>;
}

function lastState(panel: FakePanel): WorkspaceStateMessage | undefined {
    return panel.posted
        .filter((message): message is WorkspaceStateMessage => (message as { type?: string }).type === 'state')
        .pop();
}

suite('ConnectionWorkspace Test Suite', () => {
    test('show reveals the existing workspace and creates no second panel', async () => {
        const { workspaces, panels } = harness();

        const first = await workspaces.show('conn1');
        const second = await workspaces.show('conn1');

        assert.strictEqual(first, second);
        assert.strictEqual(panels.length, 1);
        assert.strictEqual(panels[0].reveals, 1);
    });

    test('show of a restored tab that is not yet revived reveals the revived workspace and creates no panel', async () => {
        const restored = fakePanel('conn1');
        const activated: string[] = [];
        const { workspaces, panels } = harness({
            activate: async (connectionName: string) => {
                activated.push(connectionName);
                // VS Code revives the tab through the serializer after the tab is shown.
                setTimeout(() => workspaces.revive(restored.panel, { connectionName, activeTab: 'dump' }), 0);
                return true;
            }
        });

        const workspace = await workspaces.show('conn1');

        assert.deepStrictEqual(activated, ['conn1']);
        assert.strictEqual(panels.length, 0);
        assert.strictEqual(workspace.panel, restored.panel);
        assert.strictEqual(workspaces.get('conn1'), workspace);
        assert.strictEqual(restored.reveals, 1);
    });

    test('show with no restored tab creates a panel', async () => {
        const activated: string[] = [];
        const { workspaces, panels } = harness({
            activate: async (connectionName: string) => {
                activated.push(connectionName);
                return false;
            }
        });

        await workspaces.show('conn1');

        assert.deepStrictEqual(activated, ['conn1']);
        assert.strictEqual(panels.length, 1);
    });

    test('two connections get two panels titled with their names', async () => {
        const { workspaces, panels } = harness();

        await workspaces.show('conn1');
        await workspaces.show('conn2');

        assert.deepStrictEqual(panels.map(panel => panel.title()), ['conn1', 'conn2']);
    });

    test('a closed connection posts the disconnected state and keeps the workspace open', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');
        await panels[0].send({ command: 'ready' });
        assert.strictEqual(lastState(panels[0])?.connected, true);

        connections.close('conn1');

        const state = lastState(panels[0]);
        assert.strictEqual(state?.connected, false);
        assert.strictEqual(state?.repository, 'repo1');
        assert.strictEqual(panels[0].disposed, false);
        assert.ok(workspaces.get('conn1'));
    });

    test('a reopened connection posts a new generation so the page reloads its trees', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');

        connections.close('conn1');
        connections.openNow('conn1');

        const state = lastState(panels[0]);
        assert.strictEqual(state?.connected, true);
        assert.strictEqual(state?.generation, 2);
    });

    test('Connect from the banner connects the workspace connection', async () => {
        const { workspaces, connections, panels } = harness();
        await workspaces.show('conn1');

        await panels[0].send({ command: 'connect' });

        assert.ok(connections.getOpenConnection('conn1'));
        assert.strictEqual(lastState(panels[0])?.connected, true);
    });

    test('a connection removed from settings disposes its workspace', async () => {
        const { workspaces, connections, panels } = harness();
        await workspaces.show('conn1');
        await workspaces.show('conn2');

        connections.setConnections(connections.connections.filter(c => c.name !== 'conn1'));

        assert.strictEqual(panels[0].disposed, true);
        assert.strictEqual(panels[1].disposed, false);
        assert.strictEqual(workspaces.get('conn1'), undefined);
    });

    test('a renamed connection disposes its workspace', async () => {
        const { workspaces, connections, panels } = harness();
        await workspaces.show('conn1');

        connections.setConnections(connections.connections.map(c => c.name === 'conn1' ? { ...c, name: 'renamed' } : c));

        assert.strictEqual(panels[0].disposed, true);
    });

    test('showDump selects the Dump tab and remembers it for the next ready', async () => {
        const { workspaces, panels } = harness();
        await workspaces.showDump('conn1', { kind: 'object', objectId: '0900000180000001' });

        assert.ok(panels[0].posted.some(message => JSON.stringify(message) === '{"type":"selectTab","tab":"dump"}'));
        await panels[0].send({ command: 'ready' });
        assert.strictEqual(lastState(panels[0])?.activeTab, 'dump');
    });

    test('opening a user from the Users tab shows its dump in the Dump tab', async () => {
        const { workspaces, panels } = harness();
        await workspaces.show('conn1');

        await panels[0].send({ tab: 'users', command: 'open', name: 'jsmith' });

        assert.ok(panels[0].posted.some(message => JSON.stringify(message) === '{"type":"selectTab","tab":"dump"}'));
        const dump = panels[0].posted.filter(message => (message as { type?: string }).type === 'dump').pop();
        assert.strictEqual((dump as { kind?: string }).kind, 'user');
    });

    test('the API tab executes against the workspace connection', async () => {
        const { workspaces, connections, panels, apiExecutor } = harness();
        connections.openNow('conn1');
        const conn2 = connections.openNow('conn2');
        await workspaces.show('conn2');

        await panels[0].send({ tab: 'api', command: 'execute', method: 'getSessionId' });

        assert.strictEqual(apiExecutor.calls.length, 1);
        assert.strictEqual(apiExecutor.calls[0].connection, conn2);
        assert.deepStrictEqual(apiExecutor.calls[0].request, { objectId: undefined, method: 'getSessionId', args: undefined });
        assert.deepStrictEqual(postedOfType(panels[0], 'apiExecuting'), [{ type: 'apiExecuting', method: 'getSessionId' }]);
        const [result] = postedOfType(panels[0], 'apiResult');
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.result, 'result of getSessionId');
        assert.strictEqual(result.resultType, 'String');
        assert.strictEqual(result.executionTimeMs, 5);
    });

    test('a session method runs on the session even with an object ID in the box', async () => {
        const { workspaces, connections, panels, apiExecutor } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');

        await panels[0].send({ tab: 'api', command: 'execute', objectId: '0900000180000001', method: 'getLoginTicket' });
        await panels[0].send({ tab: 'api', command: 'execute', objectId: '0900000180000001', method: 'getObjectName' });

        assert.deepStrictEqual(apiExecutor.calls.map(call => call.request.objectId), [undefined, '0900000180000001']);
    });

    test('the API history survives a page reload', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');
        await panels[0].send({ tab: 'api', command: 'execute', method: 'getObjectName', objectId: '0900000180000001' });
        await panels[0].send({ tab: 'api', command: 'execute', method: 'save' });

        await panels[0].send({ command: 'ready' });

        const history = postedOfType(panels[0], 'apiHistory').pop()?.history as Array<Record<string, unknown>>;
        assert.deepStrictEqual(history.map(entry => [entry.method, entry.result, entry.success]), [
            ['save', 'result of save', true],
            ['getObjectName', 'result of getObjectName', true]
        ]);
    });

    test('the API tab reports Not connected when the connection is closed', async () => {
        const { workspaces, panels, apiExecutor } = harness();
        await workspaces.show('conn1');

        await panels[0].send({ tab: 'api', command: 'execute', objectId: '0900000180000001', method: 'save' });

        assert.strictEqual(apiExecutor.calls.length, 0);
        const [result] = postedOfType(panels[0], 'apiResult');
        assert.strictEqual(result.success, false);
        assert.strictEqual(result.error, 'Not connected to conn1');
    });

    test('an object ID clicked in an API result shows in the Dump tab of the same workspace', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');

        await panels[0].send({ tab: 'api', command: 'dumpObject', objectId: '0900000180000001' });

        assert.ok(panels[0].posted.some(message => JSON.stringify(message) === '{"type":"selectTab","tab":"dump"}'));
        assert.strictEqual(postedOfType(panels[0], 'dump').pop()?.objectId, '0900000180000001');
    });

    test('showApi selects the API tab and fills in the object ID, again when the page loads', async () => {
        const { workspaces, panels } = harness();

        await workspaces.showApi('conn1', '0900000180000001');

        assert.ok(panels[0].posted.some(message => JSON.stringify(message) === '{"type":"selectTab","tab":"api"}'));
        assert.deepStrictEqual(postedOfType(panels[0], 'apiObjectId'), [{ type: 'apiObjectId', objectId: '0900000180000001' }]);

        await panels[0].send({ command: 'ready' });
        assert.strictEqual(lastState(panels[0])?.activeTab, 'api');
        assert.strictEqual(postedOfType(panels[0], 'apiObjectId').length, 2);

        await panels[0].send({ command: 'ready' });
        assert.strictEqual(postedOfType(panels[0], 'apiObjectId').length, 2);
    });

    test('the state message carries the API method list', async () => {
        const { workspaces, panels } = harness();
        await workspaces.show('conn1');

        await panels[0].send({ command: 'ready' });

        assert.ok(Object.keys(lastState(panels[0])?.apiMethods ?? {}).length > 0);
    });

    test('the notebook buttons act on the workspace connection', async () => {
        const { workspaces, panels, notebooks } = harness();
        await workspaces.show('conn2');

        await panels[0].send({ command: 'newNotebook' });
        await panels[0].send({ command: 'openNotebook' });

        assert.deepStrictEqual(notebooks.calls, ['new conn2', 'open conn2']);
    });

    test('a restored panel for a configured connection becomes its workspace', () => {
        const { workspaces } = harness();
        const restored = fakePanel('conn2');

        workspaces.revive(restored.panel, { connectionName: 'conn2', activeTab: 'dump' });

        assert.strictEqual(workspaces.get('conn2')?.panel, restored.panel);
        assert.strictEqual(restored.disposed, false);
    });

    test('a restored panel for a connection that is gone is disposed', () => {
        const { workspaces } = harness();
        const restored = fakePanel('old');

        workspaces.revive(restored.panel, { connectionName: 'old' });

        assert.strictEqual(restored.disposed, true);
        assert.strictEqual(workspaces.get('old'), undefined);
    });

    test('a DQL tab run executes on the workspace connection and sends the result', async () => {
        const { workspaces, connections, panels, dqlExecutor } = harness();
        connections.openNow('conn1');
        const conn2 = connections.openNow('conn2');
        await workspaces.show('conn2');

        await panels[0].send({ tab: 'dql', command: 'run', query: 'select r_object_id from dm_cabinet' });

        assert.deepStrictEqual(dqlExecutor.calls.map(call => [call.query, call.connection]),
            [['select r_object_id from dm_cabinet', conn2]]);
        assert.strictEqual(postedOfType(panels[0], 'dqlRunning').length, 1);
        const [result] = postedOfType(panels[0], 'dqlResult');
        assert.deepStrictEqual(result.outcome, {
            result: { columns: ['r_object_id'], rows: [{ r_object_id: '0c00000180000101' }], rowCount: 1, executionTime: 7 }
        });
        const [entry] = result.history as Array<Record<string, unknown>>;
        assert.deepStrictEqual([entry.query, entry.rowCount, entry.error], ['select r_object_id from dm_cabinet', 1, false]);
    });

    test('a failed DQL tab run sends DQL Error with the message and an error history entry', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');

        await panels[0].send({ tab: 'dql', command: 'run', query: 'select bad syntax' });

        const [result] = postedOfType(panels[0], 'dqlResult');
        assert.deepStrictEqual(result.outcome, { error: 'DQL Error: [DM_QUERY_E_SYNTAX]error: syntax error' });
        assert.strictEqual((result.history as Array<{ error: boolean }>)[0].error, true);
    });

    test('a DQL tab run on a closed connection sends DQL Error', async () => {
        const { workspaces, panels, dqlExecutor } = harness();
        await workspaces.show('conn1');

        await panels[0].send({ tab: 'dql', command: 'run', query: 'select * from dm_cabinet' });

        assert.strictEqual(dqlExecutor.calls.length, 0);
        assert.deepStrictEqual(postedOfType(panels[0], 'dqlResult')[0].outcome, { error: 'DQL Error: Not connected to conn1' });
    });

    test('the DQL history keeps the last 10 runs, newest first', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');

        for (let i = 1; i <= 12; i++) {
            await panels[0].send({ tab: 'dql', command: 'run', query: `select ${i}` });
        }

        const history = postedOfType(panels[0], 'dqlResult').pop()?.history as Array<{ query: string }>;
        assert.deepStrictEqual(history.map(entry => entry.query),
            ['select 12', 'select 11', 'select 10', 'select 9', 'select 8', 'select 7', 'select 6', 'select 5', 'select 4', 'select 3']);
    });

    test('ready sends the DQL history and the last result', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');
        await panels[0].send({ tab: 'dql', command: 'run', query: 'select 1' });
        await panels[0].send({ tab: 'dql', command: 'run', query: 'select bad' });

        await panels[0].send({ command: 'ready' });

        const state = postedOfType(panels[0], 'dqlState').pop()!;
        assert.strictEqual(state.running, false);
        assert.deepStrictEqual(state.outcome, { error: 'DQL Error: [DM_QUERY_E_SYNTAX]error: syntax error' });
        assert.deepStrictEqual((state.history as Array<{ query: string }>).map(entry => entry.query), ['select bad', 'select 1']);
    });

    test('an object ID clicked in a DQL tab result shows in the Dump tab of the same workspace', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        await workspaces.show('conn1');

        await panels[0].send({ tab: 'dql', command: 'dumpObject', objectId: '0c00000180000101' });

        assert.ok(panels[0].posted.some(message => JSON.stringify(message) === '{"type":"selectTab","tab":"dump"}'));
    });

    test('the DQL tab gets the type names on ready and when the type cache refreshes', async () => {
        const { workspaces, connections, panels } = harness();
        const typeCache = await loadedTypeCache(new FakeTypeBridge());
        connections.openNow('conn1', typeCache);
        await workspaces.show('conn1');

        await panels[0].send({ command: 'ready' });
        const onReady = postedOfType(panels[0], 'dqlTypeNames').length;
        await typeCache.refresh();

        const posted = postedOfType(panels[0], 'dqlTypeNames');
        assert.deepStrictEqual(posted.pop()?.names, ['dm_document', 'my_custom_type']);
        assert.strictEqual(posted.length, onReady);
    });

    test('DQL tab completion answers with the request id and fetches a type\'s attributes once', async () => {
        const { workspaces, connections, panels } = harness();
        const bridge = new FakeTypeBridge();
        connections.openNow('conn1', await loadedTypeCache(bridge));
        await workspaces.show('conn1');
        const text = 'select * from my_custom_type d where d.';

        await panels[0].send({ tab: 'dql', command: 'complete', requestId: 4, text, offset: text.length });
        await panels[0].send({ tab: 'dql', command: 'complete', requestId: 5, text, offset: text.length });

        const answers = postedOfType(panels[0], 'dqlCompletion');
        assert.deepStrictEqual(answers.map(answer => answer.requestId), [4, 5]);
        assert.deepStrictEqual((answers[1].result as { items: Array<{ label: string }> }).items.map(item => item.label), ['custom_code']);
        assert.strictEqual(bridge.detailCalls, 1);
    });

    test('DQL tab completion offers the vocabulary only when the connection is closed', async () => {
        const { workspaces, panels } = harness();
        await workspaces.show('conn1');
        const text = 'select * from dm_';

        await panels[0].send({ tab: 'dql', command: 'complete', requestId: 1, text, offset: text.length });
        await panels[0].send({ tab: 'dql', command: 'complete', requestId: 2, text: 'sel', offset: 3 });

        const answers = postedOfType(panels[0], 'dqlCompletion');
        assert.deepStrictEqual((answers[0].result as { items: unknown[] }).items, []);
        assert.ok((answers[1].result as { items: Array<{ label: string }> }).items.some(item => item.label === 'SELECT'));
    });
});
