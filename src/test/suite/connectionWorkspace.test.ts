import * as assert from 'assert';
import * as vscode from 'vscode';
import { DocumentumConnection } from '../../connectionManager';
import { RepositoryConnection } from '../../repositoryConnection';
import {
    ConnectionWorkspaces,
    WorkspaceConnections,
    WorkspaceStateMessage
} from '../../workspace/connectionWorkspace';

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

    openNow(name: string): RepositoryConnection {
        const cache = { onRefresh: new vscode.EventEmitter<void>().event };
        const connection = {
            name,
            username: 'dmadmin',
            sessionId: `session-${name}`,
            typeCache: cache,
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

interface Harness {
    workspaces: ConnectionWorkspaces;
    connections: FakeConnections;
    panels: FakePanel[];
}

function harness(): Harness {
    const connections = new FakeConnections();
    const panels: FakePanel[] = [];
    const workspaces = new ConnectionWorkspaces(vscode.Uri.file('/extension'), connections, title => {
        const fake = fakePanel(title);
        panels.push(fake);
        return fake.panel;
    });
    return { workspaces, connections, panels };
}

function lastState(panel: FakePanel): WorkspaceStateMessage | undefined {
    return panel.posted
        .filter((message): message is WorkspaceStateMessage => (message as { type?: string }).type === 'state')
        .pop();
}

suite('ConnectionWorkspace Test Suite', () => {
    test('show reveals the existing workspace and creates no second panel', () => {
        const { workspaces, panels } = harness();

        const first = workspaces.show('conn1');
        const second = workspaces.show('conn1');

        assert.strictEqual(first, second);
        assert.strictEqual(panels.length, 1);
        assert.strictEqual(panels[0].reveals, 1);
    });

    test('two connections get two panels titled with their names', () => {
        const { workspaces, panels } = harness();

        workspaces.show('conn1');
        workspaces.show('conn2');

        assert.deepStrictEqual(panels.map(panel => panel.title()), ['conn1', 'conn2']);
    });

    test('a closed connection posts the disconnected state and keeps the workspace open', async () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        workspaces.show('conn1');
        await panels[0].send({ command: 'ready' });
        assert.strictEqual(lastState(panels[0])?.connected, true);

        connections.close('conn1');

        const state = lastState(panels[0]);
        assert.strictEqual(state?.connected, false);
        assert.strictEqual(state?.repository, 'repo1');
        assert.strictEqual(panels[0].disposed, false);
        assert.ok(workspaces.get('conn1'));
    });

    test('a reopened connection posts a new generation so the page reloads its trees', () => {
        const { workspaces, connections, panels } = harness();
        connections.openNow('conn1');
        workspaces.show('conn1');

        connections.close('conn1');
        connections.openNow('conn1');

        const state = lastState(panels[0]);
        assert.strictEqual(state?.connected, true);
        assert.strictEqual(state?.generation, 2);
    });

    test('Connect from the banner connects the workspace connection', async () => {
        const { workspaces, connections, panels } = harness();
        workspaces.show('conn1');

        await panels[0].send({ command: 'connect' });

        assert.ok(connections.getOpenConnection('conn1'));
        assert.strictEqual(lastState(panels[0])?.connected, true);
    });

    test('a connection removed from settings disposes its workspace', () => {
        const { workspaces, connections, panels } = harness();
        workspaces.show('conn1');
        workspaces.show('conn2');

        connections.setConnections(connections.connections.filter(c => c.name !== 'conn1'));

        assert.strictEqual(panels[0].disposed, true);
        assert.strictEqual(panels[1].disposed, false);
        assert.strictEqual(workspaces.get('conn1'), undefined);
    });

    test('a renamed connection disposes its workspace', () => {
        const { workspaces, connections, panels } = harness();
        workspaces.show('conn1');

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
        workspaces.show('conn1');

        await panels[0].send({ tab: 'users', command: 'open', name: 'jsmith' });

        assert.ok(panels[0].posted.some(message => JSON.stringify(message) === '{"type":"selectTab","tab":"dump"}'));
        const dump = panels[0].posted.filter(message => (message as { type?: string }).type === 'dump').pop();
        assert.strictEqual((dump as { kind?: string }).kind, 'user');
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
});
