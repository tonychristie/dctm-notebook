import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import {
    ObjectBrowserItem,
    AnyNodeData,
    ConnectionNodeData,
    ContainerNodeData,
    CabinetNodeData,
    FolderNodeData,
    DocumentNodeData,
    createNodeId,
    createChildNodeId,
    isFolderObjectId,
    compareFolderContentNodes
} from './objectBrowserNodes';

/**
 * TreeDataProvider for the Documentum Object Browser
 *
 * Provides a hierarchical view of:
 * - Connections (connected/disconnected)
 *   - Cabinets
 *     - Folders
 *       - Documents
 *
 * Note: Types, Users, and Groups are now in separate browser views
 */
export class ObjectBrowserProvider implements vscode.TreeDataProvider<ObjectBrowserItem>, vscode.Disposable {
    private _onDidChangeTreeData: vscode.EventEmitter<ObjectBrowserItem | undefined | null | void> =
        new vscode.EventEmitter<ObjectBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ObjectBrowserItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private connectionManager: ConnectionManager;
    private readonly openConnectionsSubscription: vscode.Disposable;
    private readonly connectionsSubscription: vscode.Disposable;

    constructor(connectionManager: ConnectionManager) {
        this.connectionManager = connectionManager;
        this.openConnectionsSubscription = connectionManager.onDidChangeOpenConnections(() => this.refresh());
        this.connectionsSubscription = connectionManager.onDidChangeConnections(() => this.refresh());
    }

    dispose(): void {
        this.openConnectionsSubscription.dispose();
        this.connectionsSubscription.dispose();
        this._onDidChangeTreeData.dispose();
    }

    /**
     * Refresh the entire tree or a specific node
     */
    refresh(item?: ObjectBrowserItem): void {
        this._onDidChangeTreeData.fire(item);
    }

    /**
     * Get tree item for display
     */
    getTreeItem(element: ObjectBrowserItem): vscode.TreeItem {
        return element;
    }

    /**
     * Get children for a tree item
     */
    async getChildren(element?: ObjectBrowserItem): Promise<ObjectBrowserItem[]> {
        if (!element) {
            // Root level - show connections
            return this.getConnectionNodes();
        }

        // Get children based on node type
        switch (element.data.type) {
            case 'connection':
                return this.getConnectionChildren(element.data as ConnectionNodeData);
            case 'cabinets-container':
                return this.getCabinets(element.data as ContainerNodeData);
            case 'cabinet':
            case 'folder':
                return this.getFolderContents(element.data as CabinetNodeData | FolderNodeData);
            default:
                return [];
        }
    }

    /**
     * Get parent of an item (optional, enables reveal API).
     * Not currently implemented - returns null.
     */
    getParent(_element: ObjectBrowserItem): vscode.ProviderResult<ObjectBrowserItem> {
        return null;
    }

    /**
     * Get all configured connections as tree nodes
     */
    private getConnectionNodes(): ObjectBrowserItem[] {
        const connections = this.connectionManager.getConnections();

        return connections.map(conn => {
            const openConnection = this.connectionManager.getOpenConnection(conn.name);
            const isConnected = !!openConnection;
            const data: ConnectionNodeData = {
                // VS Code ignores a new collapsible state for an id it has seen, so an open node needs its own id.
                id: createNodeId(conn.name, 'connection', isConnected ? `${conn.name}::open` : conn.name),
                name: conn.name,
                type: 'connection',
                connectionName: conn.name,
                repository: conn.repository,
                connected: isConnected,
                username: openConnection?.username
            };

            return new ObjectBrowserItem(
                data,
                isConnected
                    ? vscode.TreeItemCollapsibleState.Expanded
                    : vscode.TreeItemCollapsibleState.None
            );
        });
    }

    /**
     * Get container nodes for a connected connection
     */
    private getConnectionChildren(data: ConnectionNodeData): ObjectBrowserItem[] {
        if (!data.connected) {
            return [];
        }

        const containers: ContainerNodeData[] = [
            {
                id: createNodeId(data.connectionName, 'cabinets-container', 'cabinets'),
                name: 'Cabinets',
                type: 'cabinets-container',
                connectionName: data.connectionName
            }
        ];

        return containers.map(c => new ObjectBrowserItem(c, vscode.TreeItemCollapsibleState.Collapsed));
    }

    /**
     * Fetch cabinets from the repository.
     * The bridge handles REST vs DQL routing internally.
     */
    private async getCabinets(data: ContainerNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getOpenConnection(data.connectionName);
        if (!connection) {
            return [];
        }

        try {
            const cabinets = await connection.bridge.getCabinets(connection.sessionId);

            return cabinets.map(cabinet => {
                const cabinetData: CabinetNodeData = {
                    id: createNodeId(data.connectionName, 'cabinet', cabinet.objectId),
                    name: cabinet.name,
                    type: 'cabinet',
                    objectId: cabinet.objectId,
                    path: '/' + cabinet.name,
                    connectionName: data.connectionName
                };
                return new ObjectBrowserItem(cabinetData, vscode.TreeItemCollapsibleState.Collapsed);
            });
        } catch (error) {
            this.showError('Failed to fetch cabinets', error);
            return [];
        }
    }

    /**
     * Fetch folder contents (subfolders and documents).
     * The bridge handles REST vs DQL routing internally.
     */
    private async getFolderContents(data: CabinetNodeData | FolderNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getOpenConnection(data.connectionName);
        if (!connection) {
            return [];
        }

        try {
            // Pass the path for DFC sessions (required for DQL queries)
            const contents = await connection.bridge.getFolderContents(connection.sessionId, data.objectId, data.path);
            const items: ObjectBrowserItem[] = [];

            for (const item of contents) {
                if (isFolderObjectId(item.objectId)) {
                    const folderData: FolderNodeData = {
                        id: createChildNodeId(data.id, item.objectId),
                        name: item.name,
                        type: 'folder',
                        objectId: item.objectId,
                        path: data.path + '/' + item.name,
                        parentId: data.objectId,
                        connectionName: data.connectionName
                    };
                    items.push(new ObjectBrowserItem(folderData, vscode.TreeItemCollapsibleState.Collapsed));
                } else {
                    const docData: DocumentNodeData = {
                        id: createChildNodeId(data.id, item.objectId),
                        name: item.name,
                        type: 'document',
                        objectId: item.objectId,
                        objectType: item.type,
                        format: item.attributes?.a_content_type as string | undefined,
                        parentId: data.objectId,
                        connectionName: data.connectionName
                    };
                    items.push(new ObjectBrowserItem(docData, vscode.TreeItemCollapsibleState.None));
                }
            }

            return items.sort((a, b) => compareFolderContentNodes(a.data, b.data));
        } catch (error) {
            this.showError('Failed to fetch folder contents', error);
            return [];
        }
    }

    /**
     * Show error message to user
     */
    private showError(message: string, error: unknown): void {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${message}: ${errorMessage}`);
    }
}

/**
 * Register the Object Browser tree view and related commands
 */
export function registerObjectBrowser(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): ObjectBrowserProvider {
    const provider = new ObjectBrowserProvider(connectionManager);

    // Register tree data provider
    const treeView = vscode.window.createTreeView('documentumExplorer', {
        treeDataProvider: provider,
        showCollapseAll: true
    });
    context.subscriptions.push(provider, treeView);

    // Register refresh command
    const refreshCommand = vscode.commands.registerCommand('dctm.refreshObjectBrowser', () => {
        provider.refresh();
    });
    context.subscriptions.push(refreshCommand);

    // Register connect from tree command
    const connectFromTreeCommand = vscode.commands.registerCommand(
        'dctm.connectFromTree',
        async (item: ObjectBrowserItem) => {
            if (item.data.type === 'connection') {
                await connectionManager.connect(item.data.connectionName);
            }
        }
    );
    context.subscriptions.push(connectFromTreeCommand);

    // Register disconnect from tree command
    const disconnectFromTreeCommand = vscode.commands.registerCommand(
        'dctm.disconnectFromTree',
        async (item?: ObjectBrowserItem) => {
            await connectionManager.disconnect(item?.data.connectionName);
        }
    );
    context.subscriptions.push(disconnectFromTreeCommand);

    // Register switch user from tree command
    const switchUserFromTreeCommand = vscode.commands.registerCommand(
        'dctm.switchUserFromTree',
        async (item?: ObjectBrowserItem) => {
            await connectionManager.switchUser(item?.data.connectionName);
        }
    );
    context.subscriptions.push(switchUserFromTreeCommand);

    // Register show properties command - delegates to dumpObject to show Object Dump panel
    const showPropertiesCommand = vscode.commands.registerCommand(
        'dctm.showObjectProperties',
        async (item: ObjectBrowserItem | AnyNodeData) => {
            // Handle both ObjectBrowserItem (from context menu) and AnyNodeData (from click command)
            const data = 'data' in item ? item.data : item;
            if ('objectId' in data) {
                await vscode.commands.executeCommand('dctm.dumpObject', data.objectId, data.connectionName);
            }
        }
    );
    context.subscriptions.push(showPropertiesCommand);

    // Register folder refresh command
    const refreshFolderCommand = vscode.commands.registerCommand(
        'dctm.refreshFolder',
        (item: ObjectBrowserItem) => {
            provider.refresh(item);
        }
    );
    context.subscriptions.push(refreshFolderCommand);

    return provider;
}
