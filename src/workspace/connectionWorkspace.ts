import * as vscode from 'vscode';
import { ConnectionManager } from '../connectionManager';
import { extractConnectionName } from '../apiPanel';
import { RepositoryConnection } from '../repositoryConnection';
import { webviewAssets, webviewResourceRoots, webviewStylesheet } from '../webviewHtml';
import { CabinetsRequest, CabinetsTab } from './cabinetsTab';
import { DumpTab, DumpTabRequest, DumpTarget } from './dumpTab';

export const WORKSPACE_VIEW_TYPE = 'dctmConnectionWorkspace';

export type WorkspaceTab = 'cabinets' | 'dump';

export interface WorkspacePageState {
    connectionName: string;
    activeTab?: WorkspaceTab;
}

export interface WorkspaceStateMessage {
    type: 'state';
    connectionName: string;
    repository: string;
    username: string;
    connected: boolean;
    generation: number;
    activeTab: WorkspaceTab;
}

type PageMessage =
    | { command: 'ready' }
    | { command: 'selectTab'; selected: WorkspaceTab }
    | { command: 'connect' }
    | ({ tab: 'dump' } & DumpTabRequest)
    | ({ tab: 'cabinets' } & CabinetsRequest);

export type WorkspaceConnections = Pick<
    ConnectionManager,
    'getOpenConnection' | 'getConnections' | 'onDidChangeOpenConnections' | 'onDidChangeConnections' | 'connect'
>;

export type PanelFactory = (title: string) => vscode.WebviewPanel;

export function isWorkspaceTab(value: unknown): value is WorkspaceTab {
    return value === 'cabinets' || value === 'dump';
}

export class ConnectionWorkspace {
    readonly dump: DumpTab;
    readonly cabinets: CabinetsTab;
    private activeTab: WorkspaceTab;
    private connection: RepositoryConnection | undefined;
    private generation = 0;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        readonly panel: vscode.WebviewPanel,
        readonly connectionName: string,
        extensionUri: vscode.Uri,
        private readonly connections: WorkspaceConnections,
        activeTab: WorkspaceTab,
        onDispose: () => void
    ) {
        this.activeTab = activeTab;
        this.connection = connections.getOpenConnection(connectionName);
        if (this.connection) {
            this.generation++;
        }

        const post = (message: object) => void this.panel.webview.postMessage(message);
        this.dump = new DumpTab(connectionName, connections, post);
        this.cabinets = new CabinetsTab(connectionName, connections, post, target => this.showDump(target));

        panel.title = connectionName;
        panel.webview.html = this.html(extensionUri);
        panel.webview.onDidReceiveMessage((message: PageMessage) => this.onMessage(message), null, this.disposables);
        this.disposables.push(
            connections.onDidChangeOpenConnections(() => this.updateConnection()),
            connections.onDidChangeConnections(() => this.onConnectionsChanged())
        );
        panel.onDidDispose(() => {
            this.disposables.forEach(d => d.dispose());
            this.disposables.length = 0;
            onDispose();
        }, null, this.disposables);
    }

    selectTab(tab: WorkspaceTab): void {
        this.activeTab = tab;
        void this.panel.webview.postMessage({ type: 'selectTab', tab });
    }

    async showDump(target: DumpTarget): Promise<void> {
        this.selectTab('dump');
        await this.dump.show(target);
    }

    private async onMessage(message: PageMessage): Promise<void> {
        if ('tab' in message) {
            if (message.tab === 'dump') {
                await this.dump.handleMessage(message);
            } else {
                await this.cabinets.handleMessage(message);
            }
            return;
        }

        switch (message.command) {
            case 'ready':
                this.postState();
                this.dump.ready();
                break;
            case 'selectTab':
                this.activeTab = message.selected;
                break;
            case 'connect':
                await this.connections.connect(this.connectionName);
                break;
        }
    }

    private updateConnection(): void {
        const connection = this.connections.getOpenConnection(this.connectionName);
        if (connection === this.connection) {
            return;
        }
        this.connection = connection;
        if (connection) {
            this.generation++;
        }
        this.postState();
    }

    private onConnectionsChanged(): void {
        if (!this.connections.getConnections().some(c => c.name === this.connectionName)) {
            this.panel.dispose();
            return;
        }
        this.postState();
    }

    private postState(): void {
        const config = this.connections.getConnections().find(c => c.name === this.connectionName);
        const message: WorkspaceStateMessage = {
            type: 'state',
            connectionName: this.connectionName,
            repository: config?.repository ?? '',
            username: this.connection?.username ?? config?.username ?? '',
            connected: this.connection !== undefined,
            generation: this.generation,
            activeTab: this.activeTab
        };
        void this.panel.webview.postMessage(message);
    }

    private html(extensionUri: vscode.Uri): string {
        const webview = this.panel.webview;
        const assets = webviewAssets(webview, extensionUri, 'connectionWorkspace');
        return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    ${assets.csp}
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${webviewStylesheet(webview, extensionUri, 'connectionWorkspace')}
</head>
<body data-vscode-context='{"preventDefaultContextMenuItems": true}'>
    <div class="workspace">
        <header class="ws-header">
            <div class="ws-title"><span class="codicon codicon-database"></span><span id="wsName"></span></div>
            <div class="ws-info" id="wsInfo"></div>
        </header>
        <div class="ws-banner" id="wsBanner" hidden>
            <span class="codicon codicon-debug-disconnect"></span>
            <span>Disconnected</span>
            <button id="wsConnect">Connect</button>
        </div>
        <div class="ws-tabs" role="tablist">
            <button role="tab" id="tab-cabinets" data-tab="cabinets" aria-controls="panel-cabinets">Cabinets</button>
            <button role="tab" id="tab-dump" data-tab="dump" aria-controls="panel-dump">Dump</button>
        </div>
        <div class="ws-panels">
            <section class="ws-panel cabinets-tab" role="tabpanel" id="panel-cabinets" aria-labelledby="tab-cabinets">
                <div class="tab-toolbar">
                    <button data-action="refreshCabinets" title="Reload the cabinet list">
                        <span class="codicon codicon-refresh"></span> Refresh
                    </button>
                </div>
                <div class="tree-container" id="cabinetsTree" aria-label="Cabinets"></div>
            </section>
            <section class="ws-panel dump-tab" role="tabpanel" id="panel-dump" aria-labelledby="tab-dump" hidden>
                <div class="dump-tab-header">
                    <button data-action="goBack" id="dumpBack" title="Back" disabled>
                        <span class="codicon codicon-arrow-left"></span>
                    </button>
                    <button data-action="goForward" id="dumpForward" title="Forward" disabled>
                        <span class="codicon codicon-arrow-right"></span>
                    </button>
                    <input type="text" id="dumpObjectId" placeholder="Object ID" aria-label="Object ID" spellcheck="false">
                    <button data-action="dumpFromBox" class="primary">Dump</button>
                </div>
                <div class="dump-content" id="dumpContent">
                    <div class="dump-empty">Enter an object ID, or click a document in the Cabinets tab.</div>
                </div>
            </section>
        </div>
    </div>
    ${assets.script}
</body>
</html>`;
    }
}

function createWorkspacePanel(extensionUri: vscode.Uri): PanelFactory {
    return title => vscode.window.createWebviewPanel(
        WORKSPACE_VIEW_TYPE,
        title,
        vscode.ViewColumn.Active,
        workspacePanelOptions(extensionUri)
    );
}

function workspacePanelOptions(extensionUri: vscode.Uri): vscode.WebviewOptions {
    return { enableScripts: true, localResourceRoots: webviewResourceRoots(extensionUri) };
}

export class ConnectionWorkspaces implements vscode.Disposable {
    private readonly workspaces = new Map<string, ConnectionWorkspace>();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly connections: WorkspaceConnections,
        private readonly createPanel: PanelFactory = createWorkspacePanel(extensionUri)
    ) {
    }

    get(connectionName: string): ConnectionWorkspace | undefined {
        return this.workspaces.get(connectionName);
    }

    show(connectionName: string, tab?: WorkspaceTab): ConnectionWorkspace {
        let workspace = this.workspaces.get(connectionName);
        if (workspace) {
            workspace.panel.reveal(vscode.ViewColumn.Active);
        } else {
            workspace = this.add(this.createPanel(connectionName), connectionName, tab ?? 'cabinets');
        }
        if (tab) {
            workspace.selectTab(tab);
        }
        return workspace;
    }

    async showDump(connectionName: string, target: DumpTarget): Promise<void> {
        await this.show(connectionName).showDump(target);
    }

    revive(panel: vscode.WebviewPanel, state: WorkspacePageState | undefined): void {
        const name = state?.connectionName;
        const configured = name !== undefined && this.connections.getConnections().some(c => c.name === name);
        if (!configured || this.workspaces.has(name)) {
            panel.dispose();
            return;
        }
        panel.webview.options = workspacePanelOptions(this.extensionUri);
        const tab = state?.activeTab;
        this.add(panel, name, isWorkspaceTab(tab) ? tab : 'cabinets');
    }

    private add(panel: vscode.WebviewPanel, connectionName: string, tab: WorkspaceTab): ConnectionWorkspace {
        const workspace = new ConnectionWorkspace(panel, connectionName, this.extensionUri, this.connections, tab,
            () => this.workspaces.delete(connectionName));
        this.workspaces.set(connectionName, workspace);
        return workspace;
    }

    dispose(): void {
        [...this.workspaces.values()].forEach(workspace => workspace.panel.dispose());
    }
}

interface WorkspaceItemContext {
    connectionName?: string;
    objectId?: string;
    nodeId?: string;
}

export function registerConnectionWorkspace(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): ConnectionWorkspaces {
    const workspaces = new ConnectionWorkspaces(context.extensionUri, connectionManager);

    context.subscriptions.push(
        workspaces,
        vscode.window.registerWebviewPanelSerializer(WORKSPACE_VIEW_TYPE, {
            deserializeWebviewPanel: async (panel, state: WorkspacePageState | undefined) => {
                workspaces.revive(panel, state);
            }
        }),
        vscode.commands.registerCommand('dctm.openWorkspace', async (arg?: unknown) => {
            const name = typeof arg === 'string' ? arg : extractConnectionName(arg);
            const connection = await connectionManager.connect(name);
            if (connection) {
                workspaces.show(connection.name);
            }
        }),
        vscode.commands.registerCommand('dctm.workspace.dump', async (item?: WorkspaceItemContext) => {
            if (item?.connectionName && item.objectId) {
                await workspaces.showDump(item.connectionName, { kind: 'object', objectId: item.objectId });
            }
        }),
        vscode.commands.registerCommand('dctm.workspace.refreshFolder', (item?: WorkspaceItemContext) => {
            if (item?.connectionName && item.nodeId) {
                workspaces.get(item.connectionName)?.cabinets.refreshFolder(item.nodeId);
            }
        })
    );

    return workspaces;
}
