import * as vscode from 'vscode';
import { DfcBridge } from './dfcBridge';

export interface DocumentumConnection {
    name: string;
    // Connection via bridge - bridge handles backend type (DFC or REST)
    // DFC backend properties (used if bridge is configured for DFC)
    docbroker?: string;
    port?: number;
    dfcProfile?: string;
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
 * Manages Documentum connections via the DFC Bridge.
 *
 * The bridge handles the underlying connection type (DFC or REST) based on its
 * configuration. The extension always talks to the bridge - it doesn't need to
 * know about the backend type.
 */
export class ConnectionManager {
    private context: vscode.ExtensionContext;
    private activeConnection: ActiveConnection | null = null;
    private connectionChangeCallbacks: ConnectionChangeCallback[] = [];
    private dfcBridge: DfcBridge;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.dfcBridge = new DfcBridge(context);
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
            description: c.docbroker
                ? `${c.docbroker}:${c.port || 1489}`
                : 'Bridge connection',
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
                // Ensure bridge is running
                await this.dfcBridge.ensureRunning(profileName ? profiles[profileName] : undefined);

                // Connect via bridge - bridge handles DFC vs REST internally
                const sessionId = await this.dfcBridge.connect({
                    docbroker: connection.docbroker || '',
                    port: connection.port || 1489,
                    repository: connection.repository,
                    username,
                    password
                });

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
                await this.dfcBridge.disconnect(this.activeConnection.sessionId);
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
            description: c.docbroker
                ? `${c.docbroker}:${c.port || 1489}`
                : 'Bridge connection',
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

    getDfcBridge(): DfcBridge {
        return this.dfcBridge;
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
}
