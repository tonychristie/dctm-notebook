import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConnectionManager } from '../../connectionManager';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from '../../dumpPanelBase';
import { ObjectDumpPanel } from '../../objectDumpPanel';
import { RepositoryConnection } from '../../repositoryConnection';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

interface FakePanel {
    panel: vscode.WebviewPanel;
    html(): string;
    send(message: DumpPanelMessage): Promise<void>;
}

function fakePanel(): FakePanel {
    let listener: ((message: DumpPanelMessage) => Promise<void>) | undefined;
    const disposable = { dispose: () => undefined };
    const webview = {
        html: '',
        cspSource: 'vscode-resource:',
        asWebviewUri: (uri: vscode.Uri) => uri,
        onDidReceiveMessage: (handler: (message: DumpPanelMessage) => Promise<void>) => {
            listener = handler;
            return disposable;
        }
    };
    const panel = {
        title: '',
        webview,
        onDidDispose: () => disposable,
        reveal: () => undefined,
        dispose: () => undefined
    };
    return {
        panel: panel as unknown as vscode.WebviewPanel,
        html: () => webview.html,
        send: message => listener!(message)
    };
}

function fakeConnectionManager(connection: object): ConnectionManager {
    return { getOpenConnection: () => connection } as unknown as ConnectionManager;
}

const extensionUri = vscode.Uri.file('/extension');

interface FetchCall {
    connectionName: string;
    key: string;
    refresh: boolean;
    result: Deferred<string>;
}

class TestDumpPanel extends DumpPanelBase<string, string> {
    readonly calls: FetchCall[] = [];

    static async open(config: DumpPanelConfig, key: string, created: TestDumpPanel[]): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, 'conn1', key, panel => {
            const testPanel = new TestDumpPanel(config, panel, key, true);
            created.push(testPanel);
            return testPanel;
        });
    }

    constructor(config: DumpPanelConfig, panel: vscode.WebviewPanel, key: string, private readonly resolveAtOnce = false) {
        super(config, panel, fakeConnectionManager({ name: 'conn1' }), 'conn1', key, extensionUri);
    }

    protected fetch(connection: RepositoryConnection, key: string, refresh: boolean): Promise<string> {
        const result = deferred<string>();
        this.calls.push({ connectionName: connection.name, key, refresh, result });
        if (this.resolveAtOnce) {
            result.resolve(key);
        }
        return result.promise;
    }

    protected renderContent(data: string): string {
        return `<p>result ${data}</p>`;
    }

    protected async handleMessage(): Promise<void> {
    }
}

function testConfig(viewType: string): DumpPanelConfig {
    return { viewType, entry: 'userDumpPanel', title: 'Test', noun: 'test' };
}

suite('DumpPanelBase Test Suite', () => {
    test('Refresh after an error reloads the current key on the current connection', async () => {
        const fake = fakePanel();
        const panel = new TestDumpPanel(testConfig('test.refresh'), fake.panel, 'a');

        const load = panel.load('a', 'conn1');
        panel.calls[0].result.reject(new Error('lost connection'));
        await load;
        assert.ok(fake.html().includes('lost connection'));

        const refresh = fake.send({ command: 'refresh' });
        assert.strictEqual(panel.calls.length, 2);
        assert.strictEqual(panel.calls[1].key, 'a');
        assert.strictEqual(panel.calls[1].connectionName, 'conn1');
        assert.strictEqual(panel.calls[1].refresh, true);
        panel.calls[1].result.resolve('a');
        await refresh;
    });

    suite('reuseWindow', () => {
        const settings = () => vscode.workspace.getConfiguration('documentum.panels');
        const created: TestDumpPanel[] = [];

        setup(async () => {
            await settings().update('reuseWindow', true, vscode.ConfigurationTarget.Global);
        });

        teardown(async () => {
            created.splice(0).forEach(panel => panel.dispose());
            await settings().update('reuseWindow', undefined, vscode.ConfigurationTarget.Global);
        });

        test('does not reuse the current panel of another view type', async () => {
            await TestDumpPanel.open(testConfig('test.reuseA'), 'a', created);
            await TestDumpPanel.open(testConfig('test.reuseB'), 'b', created);
            assert.strictEqual(created.length, 2);

            await TestDumpPanel.open(testConfig('test.reuseA'), 'c', created);
            assert.strictEqual(created.length, 2);
            assert.strictEqual(created[0].calls[1].key, 'c');
        });
    });

    suite('ObjectDumpPanel', () => {
        function objectConnection(pending: Map<string, Deferred<void>>): object {
            return {
                name: 'conn1',
                sessionId: 'session',
                bridge: {
                    getObject: async (_sessionId: string, objectId: string) => {
                        await pending.get(objectId)?.promise;
                        return { objectId, type: 'dm_document', name: `name ${objectId}`, attributes: {} };
                    }
                },
                typeCache: { getNearestStandardType: () => undefined }
            };
        }

        test('escapes the object id in the header', async () => {
            const fake = fakePanel();
            const connectionManager = fakeConnectionManager(objectConnection(new Map()));
            const panel = new ObjectDumpPanel(fake.panel, connectionManager, 'conn1', '09<b>', extensionUri);

            await panel.load('09<b>', 'conn1');

            assert.ok(fake.html().includes('<span class="object-id">09&lt;b&gt;</span>'));
            assert.ok(!fake.html().includes('09<b>'));
        });

        test('a stale response does not add a history entry', async () => {
            const fake = fakePanel();
            const pending = new Map([['a', deferred<void>()], ['b', deferred<void>()]]);
            const connectionManager = fakeConnectionManager(objectConnection(pending));
            const panel = new ObjectDumpPanel(fake.panel, connectionManager, 'conn1', 'a', extensionUri);

            const first = panel.load('a', 'conn1');
            const second = panel.load('b', 'conn1');
            pending.get('b')!.resolve();
            await second;
            pending.get('a')!.resolve();
            await first;

            await fake.send({ command: 'refresh' });
            assert.match(fake.html(), /data-action="goBack" disabled/);
            assert.ok(fake.html().includes('name b'));
        });
    });
});
