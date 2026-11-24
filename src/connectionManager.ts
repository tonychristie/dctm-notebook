import * as vscode from 'vscode';
import { describeConnection } from './connectionForm';
import { DctmBridge, DfcConnectParams } from './dctmBridge';
import { RepositoryConnection } from './repositoryConnection';

export interface DocumentumConnection {
    name: string;
    // Connection type - determines which backend the bridge uses
    type: 'dfc' | 'rest';
    // DFC backend properties (used when type is 'dfc')
    docbroker?: string;
    port?: number;
    // REST backend properties (used when type is 'rest')
    endpoint?: string;
    // Common properties
    repository: string;
    username?: string;
}

export interface Credentials {
    username: string;
    password: string;
}

export type StorageScope = 'user' | 'workspace';

interface ConnectionPickItem extends vscode.QuickPickItem {
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

function sameConnection(a: DocumentumConnection, b: DocumentumConnection): boolean {
    const left = a as unknown as Record<string, unknown>;
    const right = b as unknown as Record<string, unknown>;
    const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
    return [...keys].every(key => left[key] === right[key]);
}

export function openNewConnectionForm(): Thenable<unknown> {
    return vscode.commands.executeCommand('dctm.manageConnections', { newConnection: true });
}

export class ConnectionManager implements vscode.Disposable {
    private readonly dctmBridge: DctmBridge;
    private readonly openConnections = new Map<string, RepositoryConnection>();
    // Passwords live in memory only, so a restart prompts again.
    private readonly credentials = new Map<string, Credentials>();
    private readonly pendingOpens = new Map<string, Promise<RepositoryConnection | undefined>>();

    private readonly openConnectionsEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeOpenConnections: vscode.Event<void> = this.openConnectionsEmitter.event;

    private readonly connectionsEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeConnections: vscode.Event<void> = this.connectionsEmitter.event;

    private knownConnections: DocumentumConnection[];
    private readonly configurationListener: vscode.Disposable;

    constructor(dctmBridge: DctmBridge = new DctmBridge()) {
        this.dctmBridge = dctmBridge;
        this.knownConnections = this.getConnections();
        this.configurationListener = vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('documentum.connections')) {
                void this.updateConnections(this.getConnections());
            }
        });
    }

    getConnections(): DocumentumConnection[] {
        const config = vscode.workspace.getConfiguration('documentum');
        return config.get<DocumentumConnection[]>('connections', []);
    }

    storageScope(): StorageScope {
        const inspected = vscode.workspace.getConfiguration('documentum').inspect('connections');
        return inspected?.workspaceValue !== undefined ? 'workspace' : 'user';
    }

    storedConnections(): DocumentumConnection[] {
        const inspected = vscode.workspace.getConfiguration('documentum')
            .inspect<DocumentumConnection[]>('connections');
        const stored = this.storageScope() === 'workspace' ? inspected?.workspaceValue : inspected?.globalValue;
        return stored ?? [];
    }

    async saveConnections(connections: DocumentumConnection[]): Promise<void> {
        const target = this.storageScope() === 'workspace'
            ? vscode.ConfigurationTarget.Workspace
            : vscode.ConfigurationTarget.Global;
        await vscode.workspace.getConfiguration('documentum').update('connections', connections, target);
    }

    async updateConnections(connections: DocumentumConnection[]): Promise<void> {
        const previous = this.knownConnections;
        this.knownConnections = connections;

        const changed = previous
            .filter(old => {
                const current = connections.find(c => c.name === old.name);
                return !current || !sameConnection(old, current);
            })
            .map(old => old.name);

        for (const name of changed) {
            this.credentials.delete(name);
            const open = this.openConnections.get(name);
            if (open) {
                await this.close(open);
                vscode.window.showInformationMessage(
                    `Connection "${name}" was changed in settings and has been disconnected. ` +
                    'Connect again to use the new settings.'
                );
            }
        }

        this.connectionsEmitter.fire();
    }

    async testConnection(config: DocumentumConnection, credentials: Credentials): Promise<void> {
        await this.dctmBridge.ensureRunning(config.type);
        const sessionId = await this.dctmBridge.connect(
            buildConnectParams(config, credentials.username, credentials.password)
        );
        await this.dctmBridge.disconnect(sessionId);
    }

    requestCredentials(config: DocumentumConnection): Promise<Credentials | undefined> {
        return this.promptCredentials(config);
    }

    getOpenConnections(): RepositoryConnection[] {
        return [...this.openConnections.values()];
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
                await this.dctmBridge.ensureRunning(config.type);
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

    protected async promptCredentials(config: DocumentumConnection): Promise<Credentials | undefined> {
        const username = config.username || await vscode.window.showInputBox({
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

    protected showQuickPick<T extends vscode.QuickPickItem>(
        items: T[],
        options: vscode.QuickPickOptions
    ): Thenable<T | undefined> {
        return vscode.window.showQuickPick(items, options);
    }

    async connect(name?: string): Promise<RepositoryConnection | undefined> {
        const target = name ?? await this.chooseConnection();
        if (!target) {
            return undefined;
        }

        try {
            return await this.openConnection(target);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Connection failed: ${message}`);
            return undefined;
        }
    }

    async pickConnection(): Promise<RepositoryConnection | undefined> {
        const open = this.getOpenConnections();
        return open.length === 1 ? open[0] : this.connect();
    }

    private async chooseConnection(): Promise<string | undefined> {
        const connections = this.getConnections();

        if (connections.length === 0) {
            const action = await vscode.window.showWarningMessage(
                'No Documentum connections configured. Would you like to add one?',
                'Manage Connections'
            );
            if (action === 'Manage Connections') {
                void openNewConnectionForm();
            }
            return undefined;
        }

        const isOpen = (c: DocumentumConnection) => this.openConnections.has(c.name);
        const ordered = [...connections.filter(isOpen), ...connections.filter(c => !isOpen(c))];
        const picked = await this.showQuickPick<ConnectionPickItem>(
            ordered.map(c => ({
                label: c.name,
                description: isOpen(c) ? 'connected' : describeConnection(c),
                detail: c.repository,
                connectionName: c.name
            })),
            { placeHolder: 'Select a Documentum connection' }
        );
        return picked?.connectionName;
    }

    async disconnect(name?: string): Promise<void> {
        const connection = name ? this.openConnections.get(name) : await this.chooseOpenConnection();
        if (!connection) {
            return;
        }

        await this.close(connection);
        vscode.window.showInformationMessage(`Disconnected from ${connection.name}`);
    }

    private async chooseOpenConnection(): Promise<RepositoryConnection | undefined> {
        const open = this.getOpenConnections();
        if (open.length === 0) {
            vscode.window.showInformationMessage('No open connections.');
            return undefined;
        }
        if (open.length === 1) {
            return open[0];
        }

        const picked = await this.showQuickPick<ConnectionPickItem>(
            open.map(c => ({
                label: c.name,
                description: describeConnection(c.config),
                detail: c.config.repository,
                connectionName: c.name
            })),
            { placeHolder: 'Select a connection to disconnect' }
        );
        return picked?.connectionName ? this.openConnections.get(picked.connectionName) : undefined;
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
    }

    async disconnectAll(): Promise<void> {
        await Promise.all(Array.from(this.openConnections.values()).map(c => this.close(c)));
    }

    async showConnections(): Promise<void> {
        const items: ConnectionPickItem[] = this.getConnections().map(c => ({
            label: `${this.openConnections.has(c.name) ? '$(database)' : '$(debug-disconnect)'} ${c.name}`,
            description: describeConnection(c),
            detail: c.repository,
            connectionName: c.name
        }));

        const addItem: ConnectionPickItem = { label: '$(add) Add New Connection...', description: 'Open connection manager' };
        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator }, addItem);

        const choice = await this.showQuickPick(items, { placeHolder: 'Select a connection to open its workspace' });

        if (choice === addItem) {
            void openNewConnectionForm();
        } else if (choice?.connectionName) {
            await vscode.commands.executeCommand('dctm.openWorkspace', choice.connectionName);
        }
    }

    dispose(): void {
        this.configurationListener.dispose();
        this.openConnectionsEmitter.dispose();
        this.connectionsEmitter.dispose();
    }
}

