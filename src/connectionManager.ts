import * as vscode from 'vscode';
import { DctmBridge, DfcConnectParams } from './dctmBridge';
import { RepositoryConnection } from './repositoryConnection';

export interface DocumentumConnection {
    name: string;
    // Connection type - determines which backend the bridge uses
    type: 'dfc' | 'rest';
    // DFC backend properties (used when type is 'dfc')
    docbroker?: string;
    port?: number;
    dfcProfile?: string;
    // REST backend properties (used when type is 'rest')
    endpoint?: string;
    // Common properties
    repository: string;
    username?: string;
}

export interface DfcProfile {
    javaHome?: string;
    dfcPath: string;
    dfcProperties?: string;
}

export interface Credentials {
    username: string;
    password: string;
}

type ConnectionAction = 'connect' | 'add' | 'switchUser' | 'disconnect';

interface ConnectionPickItem extends vscode.QuickPickItem {
    action?: ConnectionAction;
    connectionName?: string;
}

function buildConnectParams(
    connection: DocumentumConnection,
    username: string,
    password: string
): DfcConnectParams {
    return connection.type === 'rest'
        ? {
            endpoint: connection.endpoint,
            repository: connection.repository,
            username,
            password
        }
        : {
            docbroker: connection.docbroker || '',
            port: connection.port || 1489,
            repository: connection.repository,
            username,
            password
        };
}

export function describeConnection(connection: DocumentumConnection): string {
    return connection.type === 'rest'
        ? connection.endpoint || 'REST'
        : connection.docbroker
            ? `${connection.docbroker}:${connection.port || 1489}`
            : 'DFC';
}

export function followSelectedCache(
    connectionManager: ConnectionManager,
    pickCache: (connection: RepositoryConnection) => { readonly onRefresh: vscode.Event<void> },
    listener: () => void
): vscode.Disposable {
    let cacheSubscription: vscode.Disposable | undefined;
    const follow = (connection: RepositoryConnection | undefined) => {
        cacheSubscription?.dispose();
        cacheSubscription = connection ? pickCache(connection).onRefresh(listener) : undefined;
    };

    follow(connectionManager.getSelectedConnection());
    const selectionSubscription = connectionManager.onDidChangeSelection(connection => {
        follow(connection);
        listener();
    });

    return new vscode.Disposable(() => {
        selectionSubscription.dispose();
        cacheSubscription?.dispose();
    });
}

export class ConnectionManager implements vscode.Disposable {
    private readonly dctmBridge: DctmBridge;
    private readonly openConnections = new Map<string, RepositoryConnection>();
    // Passwords live in memory only, so a restart prompts again.
    private readonly credentials = new Map<string, Credentials>();
    private readonly pendingOpens = new Map<string, Promise<RepositoryConnection | undefined>>();
    private selectedName: string | undefined;

    private readonly selectionEmitter = new vscode.EventEmitter<RepositoryConnection | undefined>();
    readonly onDidChangeSelection: vscode.Event<RepositoryConnection | undefined> = this.selectionEmitter.event;

    private readonly openConnectionsEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeOpenConnections: vscode.Event<void> = this.openConnectionsEmitter.event;

    constructor(dctmBridge: DctmBridge = new DctmBridge()) {
        this.dctmBridge = dctmBridge;
    }

    getConnections(): DocumentumConnection[] {
        const config = vscode.workspace.getConfiguration('documentum');
        return config.get<DocumentumConnection[]>('connections', []);
    }

    getDfcProfiles(): Record<string, DfcProfile> {
        const config = vscode.workspace.getConfiguration('documentum');
        return config.get<Record<string, DfcProfile>>('dfc.profiles', {});
    }

    getSelectedConnection(): RepositoryConnection | undefined {
        return this.selectedName ? this.openConnections.get(this.selectedName) : undefined;
    }

    getOpenConnection(name: string): RepositoryConnection | undefined {
        return this.openConnections.get(name);
    }

    openConnection(name: string): Promise<RepositoryConnection | undefined> {
        const open = this.openConnections.get(name);
        if (open) {
            return Promise.resolve(open);
        }

        let pending = this.pendingOpens.get(name);
        if (!pending) {
            pending = this.doOpen(name).finally(() => this.pendingOpens.delete(name));
            this.pendingOpens.set(name, pending);
        }
        return pending;
    }

    private async doOpen(name: string): Promise<RepositoryConnection | undefined> {
        const config = this.getConnections().find(c => c.name === name);
        if (!config) {
            throw new Error(`Connection "${name}" not found`);
        }

        const profiles = this.getDfcProfiles();
        const profileName = config.dfcProfile;
        if (profileName && !profiles[profileName]) {
            throw new Error(`DFC profile "${profileName}" not found. Configure it in settings.`);
        }

        const credentials = this.credentials.get(name) ?? await this.promptCredentials(config);
        if (!credentials) {
            return undefined;
        }

        let sessionId: string;
        try {
            sessionId = await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Connecting to ${config.name}...`,
                cancellable: false
            }, async () => {
                await this.dctmBridge.ensureRunning(
                    profileName ? profiles[profileName] : undefined,
                    config.type
                );
                return this.dctmBridge.connect(
                    buildConnectParams(config, credentials.username, credentials.password)
                );
            });
        } catch (error) {
            this.credentials.delete(name);
            throw error;
        }

        const connection = new RepositoryConnection(config, credentials.username, sessionId, this.dctmBridge);
        this.credentials.set(name, credentials);
        this.openConnections.set(name, connection);
        this.openConnectionsEmitter.fire();
        void connection.refreshCaches();

        vscode.window.showInformationMessage(`Connected to ${config.name} as ${credentials.username}`);
        return connection;
    }

    protected async promptCredentials(
        config: DocumentumConnection,
        askUsername = false
    ): Promise<Credentials | undefined> {
        const username = (!askUsername && config.username) || await vscode.window.showInputBox({
            prompt: `Enter username for ${config.name}`,
            placeHolder: 'dmadmin'
        });
        if (!username) {
            return undefined;
        }

        const password = await vscode.window.showInputBox({
            prompt: `Enter password for ${config.name}`,
            password: true
        });
        if (!password) {
            return undefined;
        }

        return { username, password };
    }

    async connect(name?: string): Promise<void> {
        const target = name ?? await this.pickConnection();
        if (!target) {
            return;
        }

        try {
            const connection = await this.openConnection(target);
            if (connection) {
                this.select(connection.name);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Connection failed: ${message}`);
        }
    }

    private async pickConnection(): Promise<string | undefined> {
        const connections = this.getConnections();

        if (connections.length === 0) {
            const action = await vscode.window.showWarningMessage(
                'No Documentum connections configured. Would you like to add one?',
                'Open Settings'
            );
            if (action === 'Open Settings') {
                vscode.commands.executeCommand(
                    'workbench.action.openSettings',
                    'documentum.connections'
                );
            }
            return undefined;
        }

        const selected = await vscode.window.showQuickPick(
            connections.map(c => ({
                label: c.name,
                description: describeConnection(c),
                detail: c.repository
            })),
            { placeHolder: 'Select a Documentum connection' }
        );
        return selected?.label;
    }

    private select(name: string): void {
        if (this.selectedName === name) {
            return;
        }
        this.selectedName = name;
        this.selectionEmitter.fire(this.getSelectedConnection());
    }

    async disconnect(name: string | undefined = this.selectedName): Promise<void> {
        const connection = name ? this.openConnections.get(name) : undefined;
        if (!connection) {
            return;
        }

        await this.close(connection);
        vscode.window.showInformationMessage(`Disconnected from ${connection.name}`);
    }

    private async close(connection: RepositoryConnection): Promise<void> {
        this.openConnections.delete(connection.name);
        connection.dispose();

        try {
            await this.dctmBridge.disconnect(connection.sessionId);
        } catch (error) {
            console.error('Error disconnecting:', error);
        }

        this.openConnectionsEmitter.fire();
        if (this.selectedName === connection.name) {
            this.selectedName = undefined;
            this.selectionEmitter.fire(undefined);
        }
    }

    async switchUser(name: string | undefined = this.selectedName): Promise<void> {
        const connection = name ? this.openConnections.get(name) : undefined;
        if (!connection) {
            vscode.window.showWarningMessage('No active connection to switch user');
            return;
        }

        const credentials = await this.promptCredentials(connection.config, true);
        if (!credentials) {
            return;
        }

        const wasSelected = this.selectedName === connection.name;
        await this.close(connection);
        this.credentials.set(connection.name, credentials);

        try {
            const reopened = await this.openConnection(connection.name);
            if (reopened && wasSelected) {
                this.select(reopened.name);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Connection failed: ${message}`);
        }
    }

    async disconnectAll(): Promise<void> {
        await Promise.all(Array.from(this.openConnections.values()).map(c => this.close(c)));
    }

    async showConnections(): Promise<void> {
        const selected = this.getSelectedConnection();

        const items: ConnectionPickItem[] = this.getConnections().map(c => ({
            label: c.name === selected?.name ? `$(check) ${c.name}` : c.name,
            description: describeConnection(c),
            detail: c.repository,
            action: 'connect',
            connectionName: c.name
        }));

        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(add) Add New Connection...', description: 'Open settings', action: 'add' });

        if (selected) {
            items.push({
                label: '$(account) Switch User...',
                description: `Login as different user to ${selected.name}`,
                action: 'switchUser',
                connectionName: selected.name
            });
            items.push({
                label: '$(debug-disconnect) Disconnect',
                description: selected.name,
                action: 'disconnect',
                connectionName: selected.name
            });
        }

        const choice = await vscode.window.showQuickPick(items, {
            placeHolder: selected ? `Connected to: ${selected.name}` : 'No active connection'
        });

        switch (choice?.action) {
            case 'add':
                vscode.commands.executeCommand('workbench.action.openSettings', 'documentum.connections');
                break;
            case 'switchUser':
                await this.switchUser(choice.connectionName);
                break;
            case 'disconnect':
                await this.disconnect(choice.connectionName);
                break;
            case 'connect':
                await this.connect(choice.connectionName);
                break;
        }
    }

    dispose(): void {
        this.selectionEmitter.dispose();
        this.openConnectionsEmitter.dispose();
    }
}

