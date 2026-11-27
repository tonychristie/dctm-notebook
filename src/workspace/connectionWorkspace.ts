import * as vscode from 'vscode';
import { COMMON_DFC_METHODS, MethodInfo } from '../apiExecutor';
import { ConnectionManager } from '../connectionManager';
import { bindNotebook, boundConnectionName, openNotebookAction } from '../notebook/notebookConnection';
import { RepositoryConnection } from '../repositoryConnection';
import { webviewAssets, webviewResourceRoots, webviewStylesheet } from '../webviewHtml';
import { ApiExecute, ApiRequest, ApiTab } from './apiTab';
import { CabinetsRequest, CabinetsTab } from './cabinetsTab';
import { DqlExecute, DqlRequest, DqlTab } from './dqlTab';
import { DumpTab, DumpTabRequest, DumpTarget } from './dumpTab';
import { ENTITY_TABS, EntityRequest, EntityTab, EntityTabName, isEntityTabName } from './entityTab';
import { QueryDocuments, isEntityKind, openEntityQuery } from './entityQuery';

export const WORKSPACE_VIEW_TYPE = 'dctmConnectionWorkspace';

export type WorkspaceTab = 'cabinets' | EntityTabName | 'dql' | 'dump' | 'api';

const DEFAULT_TAB: WorkspaceTab = 'dql';

export interface WorkspacePageState {
    connectionName: string;
    activeTab?: WorkspaceTab;
    dqlQuery?: string;
}

export interface WorkspaceStateMessage {
    type: 'state';
    connectionName: string;
    repository: string;
    username: string;
    connected: boolean;
    generation: number;
    activeTab: WorkspaceTab;
    apiMethods: Record<string, MethodInfo[]>;
}

type PageMessage =
    | { command: 'ready' }
    | { command: 'selectTab'; selected: WorkspaceTab }
    | { command: 'connect' }
    | { command: 'newNotebook' }
    | { command: 'openNotebook' }
    | ({ tab: 'dump' } & DumpTabRequest)
    | ({ tab: 'cabinets' } & CabinetsRequest)
    | ({ tab: 'api' } & ApiRequest)
    | ({ tab: 'dql' } & DqlRequest)
    | ({ tab: EntityTabName } & EntityRequest);

export type WorkspaceConnections = Pick<
    ConnectionManager,
    'getOpenConnection' | 'getConnections' | 'onDidChangeOpenConnections' | 'onDidChangeConnections' | 'connect'
>;

export interface WorkspaceNotebooks {
    newNotebook(connectionName: string): Promise<void>;
    openNotebook(connectionName: string): Promise<void>;
}

export interface WorkspaceServices {
    apiExecutor: ApiExecute;
    dqlExecutor: DqlExecute;
    notebooks: WorkspaceNotebooks;
    documents: QueryDocuments;
}

export type PanelFactory = (title: string) => vscode.WebviewPanel;

export function isWorkspaceTab(value: unknown): value is WorkspaceTab {
    return value === 'cabinets' || value === 'dql' || value === 'dump' || value === 'api' || isEntityTabName(value);
}

export class ConnectionWorkspace {
    readonly dump: DumpTab;
    readonly cabinets: CabinetsTab;
    readonly entities: Record<EntityTabName, EntityTab>;
    readonly api: ApiTab;
    readonly dql: DqlTab;
    private activeTab: WorkspaceTab;
    private connection: RepositoryConnection | undefined;
    private generation = 0;
    private readonly disposables: vscode.Disposable[] = [];

    constructor(
        readonly panel: vscode.WebviewPanel,
        readonly connectionName: string,
        extensionUri: vscode.Uri,
        private readonly connections: WorkspaceConnections,
        private readonly services: WorkspaceServices,
        activeTab: WorkspaceTab,
        onDispose: () => void
    ) {
        this.activeTab = activeTab;
        this.connection = connections.getOpenConnection(connectionName);
        if (this.connection) {
            this.generation++;
        }

        const post = (message: object) => void this.panel.webview.postMessage(message);
        this.dump = new DumpTab(connectionName, connections, post, services.documents);
        this.cabinets = new CabinetsTab(connectionName, connections, post, target => this.showDump(target));
        const entityTab = (tab: EntityTabName) =>
            new EntityTab(connectionName, connections, ENTITY_TABS[tab], post, target => this.showDump(target));
        this.entities = { types: entityTab('types'), users: entityTab('users'), groups: entityTab('groups') };
        this.api = new ApiTab(connectionName, connections, services.apiExecutor, post, target => this.showDump(target));
        this.dql = new DqlTab(connectionName, connections, services.dqlExecutor, post, target => this.showDump(target));
        this.watchCaches();

        panel.title = connectionName;
        panel.webview.html = this.html(extensionUri);
        panel.webview.onDidReceiveMessage((message: PageMessage) => this.onMessage(message), null, this.disposables);
        this.disposables.push(
            connections.onDidChangeOpenConnections(() => this.updateConnection()),
            connections.onDidChangeConnections(() => this.onConnectionsChanged())
        );
        panel.onDidDispose(() => {
            Object.values(this.entities).forEach(tab => tab.dispose());
            this.dql.dispose();
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

    showApi(objectId?: string): void {
        this.selectTab('api');
        if (objectId) {
            this.api.setObjectId(objectId);
        }
    }

    private async onMessage(message: PageMessage): Promise<void> {
        if ('tab' in message) {
            if (message.tab === 'dump') {
                await this.dump.handleMessage(message);
            } else if (message.tab === 'cabinets') {
                await this.cabinets.handleMessage(message);
            } else if (message.tab === 'api') {
                await this.api.handleMessage(message);
            } else if (message.tab === 'dql') {
                await this.dql.handleMessage(message);
            } else {
                await this.entities[message.tab].handleMessage(message);
            }
            return;
        }

        switch (message.command) {
            case 'ready':
                this.postState();
                this.dump.ready();
                this.api.ready();
                this.dql.ready();
                break;
            case 'selectTab':
                this.activeTab = message.selected;
                break;
            case 'connect':
                await this.connections.connect(this.connectionName);
                break;
            case 'newNotebook':
                await this.services.notebooks.newNotebook(this.connectionName);
                break;
            case 'openNotebook':
                await this.services.notebooks.openNotebook(this.connectionName);
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
        this.watchCaches();
        this.postState();
    }

    private watchCaches(): void {
        Object.values(this.entities).forEach(tab => tab.watch(this.connection));
        this.dql.watch(this.connection);
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
            activeTab: this.activeTab,
            apiMethods: COMMON_DFC_METHODS
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
            <div class="ws-heading">
                <div class="ws-title"><span class="codicon codicon-database"></span><span id="wsName"></span></div>
                <div class="ws-info" id="wsInfo"></div>
            </div>
            <div class="ws-actions">
                <button id="wsNewNotebook" title="Open a new notebook bound to this connection">
                    <span class="codicon codicon-new-file"></span> New DQL notebook
                </button>
                <button id="wsOpenNotebook" title="Open a notebook and bind it to this connection">
                    <span class="codicon codicon-notebook"></span> Open notebook
                </button>
            </div>
        </header>
        <div class="ws-banner" id="wsBanner" hidden>
            <span class="codicon codicon-debug-disconnect"></span>
            <span>Disconnected</span>
            <button id="wsConnect">Connect</button>
        </div>
        <div class="ws-tabs" role="tablist">
            <button role="tab" id="tab-dql" data-tab="dql" aria-controls="panel-dql">DQL</button>
            <button role="tab" id="tab-api" data-tab="api" aria-controls="panel-api">API</button>
            <button role="tab" id="tab-dump" data-tab="dump" aria-controls="panel-dump">Dump</button>
            <button role="tab" id="tab-cabinets" data-tab="cabinets" aria-controls="panel-cabinets">Cabinets</button>
            <button role="tab" id="tab-types" data-tab="types" aria-controls="panel-types">Types</button>
            <button role="tab" id="tab-users" data-tab="users" aria-controls="panel-users">Users</button>
            <button role="tab" id="tab-groups" data-tab="groups" aria-controls="panel-groups">Groups</button>
        </div>
        <div class="ws-panels">
            <section class="ws-panel cabinets-tab" role="tabpanel" id="panel-cabinets" aria-labelledby="tab-cabinets" hidden>
                <div class="tab-toolbar">
                    <button data-action="refreshCabinets" title="Reload the cabinet list">
                        <span class="codicon codicon-refresh"></span> Refresh
                    </button>
                </div>
                <div class="tree-container" id="cabinetsTree" aria-label="Cabinets"></div>
            </section>
            ${entityPanel('types', 'Types')}
            ${entityPanel('users', 'Users')}
            ${entityPanel('groups', 'Groups')}
            ${DQL_PANEL}
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
            ${API_PANEL}
        </div>
    </div>
    ${assets.script}
</body>
</html>`;
    }
}

function entityPanel(tab: EntityTabName, label: string): string {
    const plural = ENTITY_TABS[tab].plural;
    return `<section class="ws-panel entity-tab" role="tabpanel" id="panel-${tab}" aria-labelledby="tab-${tab}" hidden>
                <div class="tab-toolbar">
                    <input type="search" class="entity-search" id="${tab}Search" placeholder="Search ${plural}"
                        aria-label="Search ${plural}" spellcheck="false">
                    <button data-action="refreshEntities" title="Reload the ${plural}">
                        <span class="codicon codicon-refresh"></span> Refresh
                    </button>
                    <span class="entity-count" aria-live="polite"></span>
                </div>
                <div class="tree-container" aria-label="${label}"></div>
            </section>`;
}

const DQL_PANEL = `<section class="ws-panel dql-tab" role="tabpanel" id="panel-dql" aria-labelledby="tab-dql">
                <div class="tab-toolbar">
                    <button class="primary" data-action="runQuery" title="Run the selection, or the whole query (Ctrl+Enter)">
                        <span class="codicon codicon-play"></span> Run
                    </button>
                </div>
                <div class="dql-editor" aria-label="DQL query"></div>
                <div class="dql-results"></div>
                <div class="dql-history" hidden>
                    <h3>Query History</h3>
                    <div class="dql-history-list"></div>
                </div>
            </section>`;

const API_PANEL = `<section class="ws-panel api-tab" role="tabpanel" id="panel-api" aria-labelledby="tab-api" hidden>
                <div class="api-section">
                    <label for="apiObjectId">Object ID (r_object_id)</label>
                    <input type="text" id="apiObjectId" placeholder="0900000180001234" spellcheck="false">
                    <span class="api-info">Leave empty for session-level operations. Execute API Method on an item in the Cabinets tab fills it in.</span>
                </div>
                <div class="api-section">
                    <h3>Method</h3>
                    <label for="apiMethodSearch">Search Methods</label>
                    <input type="text" id="apiMethodSearch" placeholder="Type to search methods..." spellcheck="false">
                    <div class="api-categories"></div>
                    <div class="api-method-list"></div>
                </div>
                <div class="api-section api-parameters" hidden>
                    <h3>Parameters</h3>
                    <div class="api-parameter-inputs"></div>
                </div>
                <div class="api-actions">
                    <button class="api-execute" data-action="execute" disabled>Execute</button>
                    <button class="secondary" data-action="clearForm">Clear</button>
                </div>
                <div class="api-result" hidden>
                    <div class="api-result-header">
                        <span>Result</span>
                        <span class="api-info api-execution-time"></span>
                    </div>
                    <div class="api-result-content"></div>
                </div>
                <div class="api-history" hidden>
                    <h3>Execution History</h3>
                    <div class="api-history-list"></div>
                </div>
            </section>`;

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

export interface RestoredTabs {
    // Activates the restored workspace tab of the connection, so VS Code revives it; false when there is none.
    activate(connectionName: string): Promise<boolean>;
}

const FOCUS_GROUP_COMMANDS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth']
    .map(position => `workbench.action.focus${position}EditorGroup`);

export function restoredWorkspaceTabs(): RestoredTabs {
    return {
        async activate(connectionName: string): Promise<boolean> {
            for (const group of vscode.window.tabGroups.all) {
                const index = group.tabs.findIndex(tab =>
                    tab.input instanceof vscode.TabInputWebview &&
                    // VS Code prefixes the view type of an extension webview.
                    tab.input.viewType.endsWith(WORKSPACE_VIEW_TYPE) &&
                    tab.label === connectionName
                );
                const focusGroup = FOCUS_GROUP_COMMANDS[group.viewColumn - 1];
                if (index >= 0 && focusGroup) {
                    await vscode.commands.executeCommand(focusGroup);
                    await vscode.commands.executeCommand('workbench.action.openEditorAtIndex', index);
                    return true;
                }
            }
            return false;
        }
    };
}

const REVIVE_TIMEOUT_MS = 3000;

export class ConnectionWorkspaces implements vscode.Disposable {
    private readonly workspaces = new Map<string, ConnectionWorkspace>();
    private readonly pendingRevivals = new Map<string, (workspace: ConnectionWorkspace | undefined) => void>();
    private readonly pendingShows = new Map<string, Promise<ConnectionWorkspace>>();

    constructor(
        private readonly extensionUri: vscode.Uri,
        private readonly connections: WorkspaceConnections,
        private readonly services: WorkspaceServices,
        private readonly createPanel: PanelFactory = createWorkspacePanel(extensionUri),
        private readonly restoredTabs: RestoredTabs = restoredWorkspaceTabs()
    ) {
    }

    get(connectionName: string): ConnectionWorkspace | undefined {
        return this.workspaces.get(connectionName);
    }

    async show(connectionName: string, tab?: WorkspaceTab): Promise<ConnectionWorkspace> {
        let pending = this.pendingShows.get(connectionName);
        if (!pending) {
            pending = this.findOrCreate(connectionName, tab ?? DEFAULT_TAB)
                .finally(() => this.pendingShows.delete(connectionName));
            this.pendingShows.set(connectionName, pending);
        }
        const workspace = await pending;
        if (tab) {
            workspace.selectTab(tab);
        }
        return workspace;
    }

    private async findOrCreate(connectionName: string, initialTab: WorkspaceTab): Promise<ConnectionWorkspace> {
        const workspace = this.workspaces.get(connectionName) ?? await this.reviveRestored(connectionName);
        if (workspace) {
            workspace.panel.reveal(vscode.ViewColumn.Active);
            return workspace;
        }
        return this.add(this.createPanel(connectionName), connectionName, initialTab);
    }

    async showDump(connectionName: string, target: DumpTarget): Promise<void> {
        await (await this.show(connectionName)).showDump(target);
    }

    async showApi(connectionName: string, objectId?: string): Promise<void> {
        (await this.show(connectionName)).showApi(objectId);
    }

    // After a window reload VS Code revives a workspace tab only when it is first shown.
    private async reviveRestored(connectionName: string): Promise<ConnectionWorkspace | undefined> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const revived = new Promise<ConnectionWorkspace | undefined>(resolve => {
            this.pendingRevivals.set(connectionName, resolve);
            timer = setTimeout(() => resolve(undefined), REVIVE_TIMEOUT_MS);
        });

        try {
            if (!await this.restoredTabs.activate(connectionName)) {
                return undefined;
            }
            return await revived ?? this.workspaces.get(connectionName);
        } finally {
            clearTimeout(timer);
            this.pendingRevivals.delete(connectionName);
        }
    }

    revive(panel: vscode.WebviewPanel, state: WorkspacePageState | undefined): void {
        const name = state?.connectionName;
        const configured = name !== undefined && this.connections.getConnections().some(c => c.name === name);
        if (!configured || this.workspaces.has(name)) {
            panel.dispose();
            if (name !== undefined) {
                this.pendingRevivals.get(name)?.(this.workspaces.get(name));
            }
            return;
        }
        panel.webview.options = workspacePanelOptions(this.extensionUri);
        const tab = state?.activeTab;
        const workspace = this.add(panel, name, isWorkspaceTab(tab) ? tab : DEFAULT_TAB);
        this.pendingRevivals.get(name)?.(workspace);
    }

    private add(panel: vscode.WebviewPanel, connectionName: string, tab: WorkspaceTab): ConnectionWorkspace {
        const workspace = new ConnectionWorkspace(panel, connectionName, this.extensionUri, this.connections,
            this.services, tab, () => {
                if (this.workspaces.get(connectionName) === workspace) {
                    this.workspaces.delete(connectionName);
                }
            });
        this.workspaces.set(connectionName, workspace);
        return workspace;
    }

    dispose(): void {
        [...this.workspaces.values()].forEach(workspace => workspace.panel.dispose());
    }
}

interface WorkspaceItemContext {
    webviewSection?: string;
    connectionName?: string;
    objectId?: string;
    nodeId?: string;
    name?: string;
}

async function newDqlNotebook(connectionName: string): Promise<void> {
    const data = new vscode.NotebookData([
        new vscode.NotebookCellData(vscode.NotebookCellKind.Code, '', 'dql')
    ]);
    data.metadata = { connection: connectionName };
    const notebook = await vscode.workspace.openNotebookDocument('dctmbook', data);
    await vscode.window.showNotebookDocument(notebook);
}

async function openNotebookFor(connectionName: string): Promise<void> {
    const uris = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Documentum Notebook': ['dctmbook'] },
        openLabel: 'Open notebook'
    });
    if (!uris || uris.length === 0) {
        return;
    }

    const notebook = await vscode.workspace.openNotebookDocument(uris[0]);
    const boundName = boundConnectionName(notebook.metadata);
    const action = openNotebookAction(boundName, connectionName);
    if (action === 'ask') {
        const choice = await vscode.window.showWarningMessage(
            `Notebook is bound to "${boundName}". Bind it to "${connectionName}"?`,
            { modal: true },
            'Bind',
            'Open as is'
        );
        if (!choice) {
            return;
        }
        if (choice === 'Bind') {
            await bindNotebook(notebook, connectionName);
        }
    } else if (action === 'bind') {
        await bindNotebook(notebook, connectionName);
    }
    await vscode.window.showNotebookDocument(notebook);
}

export function registerConnectionWorkspace(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    apiExecutor: ApiExecute,
    dqlExecutor: DqlExecute,
    documents: QueryDocuments
): ConnectionWorkspaces {
    const workspaces = new ConnectionWorkspaces(context.extensionUri, connectionManager, {
        apiExecutor,
        dqlExecutor,
        notebooks: { newNotebook: newDqlNotebook, openNotebook: openNotebookFor },
        documents
    });

    context.subscriptions.push(
        workspaces,
        vscode.window.registerWebviewPanelSerializer(WORKSPACE_VIEW_TYPE, {
            deserializeWebviewPanel: async (panel, state: WorkspacePageState | undefined) => {
                workspaces.revive(panel, state);
            }
        }),
        vscode.commands.registerCommand('dctm.openWorkspace', async (arg?: unknown) => {
            const connection = await connectionManager.connect(typeof arg === 'string' ? arg : undefined);
            if (connection) {
                await workspaces.show(connection.name);
            }
        }),
        vscode.commands.registerCommand('dctm.workspace.dump', async (item?: WorkspaceItemContext) => {
            if (!item?.connectionName) {
                return;
            }
            if (isEntityKind(item.webviewSection) && item.name) {
                await workspaces.showDump(item.connectionName, { kind: item.webviewSection, name: item.name });
            } else if (item.objectId) {
                await workspaces.showDump(item.connectionName, { kind: 'object', objectId: item.objectId });
            }
        }),
        vscode.commands.registerCommand('dctm.workspace.generateQuery', async (item?: WorkspaceItemContext) => {
            if (item?.connectionName && isEntityKind(item.webviewSection) && item.name) {
                const connection = connectionManager.getOpenConnection(item.connectionName);
                await openEntityQuery(connection, item.connectionName, item.webviewSection, item.name, documents);
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
