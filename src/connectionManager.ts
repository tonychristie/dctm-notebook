import * as vscode from 'vscode';
import { DctmBridge } from './dctmBridge';

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

export interface ActiveConnection {
    config: DocumentumConnection;
    sessionId: string;
    username: string;
}

type ConnectionChangeCallback = (connected: boolean, name?: string, username?: string) => void;

/**
 * Callback type for notebook connection changes.
 * Called when a notebook's bound connection is established or disconnected.
 */
type NotebookConnectionChangeCallback = (
    notebookUri: string,
    connected: boolean,
    connectionName?: string,
    username?: string
) => void;

/**
 * Manages Documentum connections via the DFC Bridge.
 *
 * The bridge handles the underlying connection type (DFC or REST) based on its
 * configuration. The extension always talks to the bridge - it doesn't need to
 * know about the backend type.
 *
 * Supports two types of connections:
 * 1. Global active connection - used by default for all operations
 * 2. Notebook-bound connections - per-notebook sessions identified by notebook URI
 */
export class ConnectionManager {
    private context: vscode.ExtensionContext;
    private activeConnection: ActiveConnection | null = null;
    private connectionChangeCallbacks: ConnectionChangeCallback[] = [];
    private notebookConnectionCallbacks: NotebookConnectionChangeCallback[] = [];
    private dctmBridge: DctmBridge;

    /**
     * Notebook-bound connections: Map from notebook URI to ActiveConnection.
     * Allows multiple notebooks to have their own independent sessions.
     */
    private notebookConnections: Map<string, ActiveConnection> = new Map();

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.dctmBridge = new DctmBridge(context);
    }

    onConnectionChange(callback: ConnectionChangeCallback): void {
        this.connectionChangeCallbacks.push(callback);
    }

    private notifyConnectionChange(connected: boolean, name?: string, username?: string): void {
        this.connectionChangeCallbacks.forEach(cb => cb(connected, name, username));
    }

    getConnections(): DocumentumConnection[] {
        const config = vscode.workspace.getConfiguration('documentum');
        return config.get<DocumentumConnection[]>('connections', []);
    }

    getDfcProfiles(): Record<string, DfcProfile> {
        const config = vscode.workspace.getConfiguration('documentum');
        return config.get<Record<string, DfcProfile>>('dfc.profiles', {});
    }

    async connect(): Promise<void> {
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
            return;
        }

        // Let user pick a connection
        const items = connections.map(c => ({
            label: c.name,
            description: c.type === 'rest'
                ? c.endpoint || 'REST'
                : c.docbroker
                    ? `${c.docbroker}:${c.port || 1489}`
                    : 'DFC',
            detail: c.repository,
            connection: c
        }));

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: 'Select a Documentum connection'
        });

        if (!selected) {
            return;
        }

        const connection = selected.connection;

        // Get credentials
        const username = connection.username || await vscode.window.showInputBox({
            prompt: 'Enter username',
            placeHolder: 'dmadmin'
        });

        if (!username) {
            return;
        }

        const password = await vscode.window.showInputBox({
            prompt: 'Enter password',
            password: true
        });

        if (!password) {
            return;
        }

        await this.connectToBridge(connection, username, password);
    }

    private async connectToBridge(
        connection: DocumentumConnection,
        username: string,
        password: string
    ): Promise<void> {
        // Validate DFC profile exists if specified
        const profiles = this.getDfcProfiles();
        const profileName = connection.dfcProfile;

        if (profileName && !profiles[profileName]) {
            vscode.window.showErrorMessage(
                `DFC profile "${profileName}" not found. Configure it in settings.`
            );
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Connecting to ${connection.name}...`,
                cancellable: false
            }, async () => {
                // Ensure bridge is running - route to appropriate bridge based on connection type
                await this.dctmBridge.ensureRunning(
                    profileName ? profiles[profileName] : undefined,
                    connection.type
                );

                // Connect via bridge - route to DFC or REST based on connection type
                const sessionId = await this.dctmBridge.connect(
                    connection.type === 'rest'
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
                        }
                );

                this.activeConnection = {
                    config: connection,
                    sessionId,
                    username
                };

                this.notifyConnectionChange(true, connection.name, username);
                vscode.window.showInformationMessage(
                    `Connected to ${connection.name} as ${username}`
                );
            });
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Connection failed: ${error.message}`);
            }
        }
    }

    async disconnect(): Promise<void> {
        if (this.activeConnection) {
            const name = this.activeConnection.config.name;

            try {
                await this.dctmBridge.disconnect(this.activeConnection.sessionId);
            } catch (error) {
                // Log but don't fail
                console.error('Error disconnecting:', error);
            }

            this.activeConnection = null;
            this.notifyConnectionChange(false);
            vscode.window.showInformationMessage(`Disconnected from ${name}`);
        }
    }

    async showConnections(): Promise<void> {
        const connections = this.getConnections();
        const currentName = this.activeConnection?.config.name;

        const items: vscode.QuickPickItem[] = connections.map(c => ({
            label: c.name === currentName ? `$(check) ${c.name}` : c.name,
            description: c.type === 'rest'
                ? c.endpoint || 'REST'
                : c.docbroker
                    ? `${c.docbroker}:${c.port || 1489}`
                    : 'DFC',
            detail: c.repository
        }));

        items.push({ label: '', kind: vscode.QuickPickItemKind.Separator });
        items.push({ label: '$(add) Add New Connection...', description: 'Open settings' });

        if (this.activeConnection) {
            items.push({ label: '$(account) Switch User...', description: `Login as different user to ${currentName}` });
            items.push({ label: '$(debug-disconnect) Disconnect', description: currentName });
        }

        const selected = await vscode.window.showQuickPick(items, {
            placeHolder: currentName
                ? `Connected to: ${currentName}`
                : 'No active connection'
        });

        if (!selected) {
            return;
        }

        if (selected.label.includes('Add New Connection')) {
            vscode.commands.executeCommand(
                'workbench.action.openSettings',
                'documentum.connections'
            );
        } else if (selected.label.includes('Switch User')) {
            await this.switchUser();
        } else if (selected.label.includes('Disconnect')) {
            await this.disconnect();
        } else {
            await this.connect();
        }
    }

    getActiveConnection(): ActiveConnection | null {
        return this.activeConnection;
    }

    getDctmBridge(): DctmBridge {
        return this.dctmBridge;
    }

    isConnected(): boolean {
        return this.activeConnection !== null;
    }

    /**
     * Get the current session ID
     */
    getSessionId(): string | undefined {
        return this.activeConnection?.sessionId;
    }

    /**
     * Get the current username
     */
    getUsername(): string | undefined {
        return this.activeConnection?.username;
    }

    /**
     * Switch user - disconnect from current session and prompt for new credentials
     * on the same connection configuration
     */
    async switchUser(): Promise<void> {
        if (!this.activeConnection) {
            vscode.window.showWarningMessage('No active connection to switch user');
            return;
        }

        const connection = this.activeConnection.config;

        // Disconnect first
        await this.disconnect();

        // Prompt for new credentials
        const username = await vscode.window.showInputBox({
            prompt: `Enter username for ${connection.name}`,
            placeHolder: 'dmadmin'
        });

        if (!username) {
            return;
        }

        const password = await vscode.window.showInputBox({
            prompt: 'Enter password',
            password: true
        });

        if (!password) {
            return;
        }

        await this.connectToBridge(connection, username, password);
    }

    // =========================================================================
    // Notebook-bound connection management
    // =========================================================================

    /**
     * Register a callback for notebook connection changes.
     */
    onNotebookConnectionChange(callback: NotebookConnectionChangeCallback): void {
        this.notebookConnectionCallbacks.push(callback);
    }

    private notifyNotebookConnectionChange(
        notebookUri: string,
        connected: boolean,
        connectionName?: string,
        username?: string
    ): void {
        this.notebookConnectionCallbacks.forEach(cb =>
            cb(notebookUri, connected, connectionName, username)
        );
    }

    /**
     * Connect a notebook to a specific connection configuration.
     * Creates an independent session for the notebook.
     *
     * @param notebookUri The notebook's URI (used as the key)
     * @param connectionName Name of the connection configuration to use
     * @param username Username for authentication
     * @param password Password for authentication
     * @returns The session ID for the new connection
     */
    async connectNotebook(
        notebookUri: string,
        connectionName: string,
        username: string,
        password: string
    ): Promise<string> {
        const connections = this.getConnections();
        const connection = connections.find(c => c.name === connectionName);

        if (!connection) {
            throw new Error(`Connection "${connectionName}" not found`);
        }

        // Validate DFC profile exists if specified
        const profiles = this.getDfcProfiles();
        const profileName = connection.dfcProfile;

        if (profileName && !profiles[profileName]) {
            throw new Error(`DFC profile "${profileName}" not found`);
        }

        // Ensure bridge is running - route to appropriate bridge based on connection type
        await this.dctmBridge.ensureRunning(
            profileName ? profiles[profileName] : undefined,
            connection.type
        );

        // Connect via bridge - route to DFC or REST based on connection type
        const sessionId = await this.dctmBridge.connect(
            connection.type === 'rest'
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
                }
        );

        const activeConnection: ActiveConnection = {
            config: connection,
            sessionId,
            username
        };

        // Store the notebook connection
        this.notebookConnections.set(notebookUri, activeConnection);
        this.notifyNotebookConnectionChange(notebookUri, true, connectionName, username);

        return sessionId;
    }

    /**
     * Disconnect a notebook's bound connection.
     *
     * @param notebookUri The notebook's URI
     */
    async disconnectNotebook(notebookUri: string): Promise<void> {
        const connection = this.notebookConnections.get(notebookUri);
        if (connection) {
            try {
                await this.dctmBridge.disconnect(connection.sessionId);
            } catch (error) {
                console.error('Error disconnecting notebook session:', error);
            }

            this.notebookConnections.delete(notebookUri);
            this.notifyNotebookConnectionChange(notebookUri, false);
        }
    }

    /**
     * Get the connection for a specific notebook.
     * Returns null if the notebook doesn't have a bound connection.
     *
     * @param notebookUri The notebook's URI
     */
    getNotebookConnection(notebookUri: string): ActiveConnection | null {
        return this.notebookConnections.get(notebookUri) || null;
    }

    /**
     * Check if a notebook has a bound connection.
     *
     * @param notebookUri The notebook's URI
     */
    hasNotebookConnection(notebookUri: string): boolean {
        return this.notebookConnections.has(notebookUri);
    }

    /**
     * Get the effective connection for a notebook.
     * Returns the notebook's bound connection if it exists,
     * otherwise falls back to the global active connection.
     *
     * @param notebookUri The notebook's URI (optional)
     */
    getEffectiveConnection(notebookUri?: string): ActiveConnection | null {
        if (notebookUri) {
            const notebookConnection = this.notebookConnections.get(notebookUri);
            if (notebookConnection) {
                return notebookConnection;
            }
        }
        return this.activeConnection;
    }

    /**
     * Get all active notebook connections.
     * Returns a map of notebook URI to connection info.
     */
    getAllNotebookConnections(): Map<string, ActiveConnection> {
        return new Map(this.notebookConnections);
    }

    /**
     * Disconnect all notebook connections.
     * Called during extension deactivation.
     */
    async disconnectAllNotebooks(): Promise<void> {
        const uris = Array.from(this.notebookConnections.keys());
        await Promise.all(uris.map(uri => this.disconnectNotebook(uri)));
    }
}
