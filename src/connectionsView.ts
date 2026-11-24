import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { ConnectionItem } from './objectBrowserNodes';

export type ConnectionsViewSource = Pick<
    ConnectionManager,
    'getConnections' | 'getOpenConnection' | 'onDidChangeOpenConnections' | 'onDidChangeConnections'
>;

export class ConnectionsViewProvider implements vscode.TreeDataProvider<ConnectionItem>, vscode.Disposable {
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<void>();
    readonly onDidChangeTreeData: vscode.Event<void> = this._onDidChangeTreeData.event;

    private readonly subscriptions: vscode.Disposable[];

    constructor(private readonly connectionManager: ConnectionsViewSource) {
        this.subscriptions = [
            connectionManager.onDidChangeOpenConnections(() => this.refresh()),
            connectionManager.onDidChangeConnections(() => this.refresh())
        ];
    }

    dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this._onDidChangeTreeData.dispose();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConnectionItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConnectionItem): ConnectionItem[] {
        if (element) {
            return [];
        }
        return this.connectionManager.getConnections().map(conn => {
            const openConnection = this.connectionManager.getOpenConnection(conn.name);
            return new ConnectionItem({
                connectionName: conn.name,
                repository: conn.repository,
                connected: !!openConnection,
                username: openConnection?.username
            });
        });
    }
}

export function registerConnectionsView(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): ConnectionsViewProvider {
    const provider = new ConnectionsViewProvider(connectionManager);
    const treeView = vscode.window.createTreeView('documentumConnections', { treeDataProvider: provider });

    context.subscriptions.push(
        provider,
        treeView,
        vscode.commands.registerCommand('dctm.refreshConnections', () => provider.refresh()),
        vscode.commands.registerCommand('dctm.connectFromTree', async (item: ConnectionItem) => {
            await connectionManager.connect(item.data.connectionName);
        }),
        vscode.commands.registerCommand('dctm.disconnectFromTree', async (item?: ConnectionItem) => {
            await connectionManager.disconnect(item?.data.connectionName);
        }),
        vscode.commands.registerCommand('dctm.switchUserFromTree', async (item?: ConnectionItem) => {
            await connectionManager.switchUser(item?.data.connectionName);
        })
    );

    return provider;
}
