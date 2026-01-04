import * as vscode from 'vscode';
import { ConnectionManager, ActiveConnection } from './connectionManager';
import {
    ObjectBrowserItem,
    AnyNodeData,
    ConnectionNodeData,
    ContainerNodeData,
    CabinetNodeData,
    FolderNodeData,
    DocumentNodeData,
    createNodeId,
    escapeDqlString
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
export class ObjectBrowserProvider implements vscode.TreeDataProvider<ObjectBrowserItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ObjectBrowserItem | undefined | null | void> =
        new vscode.EventEmitter<ObjectBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ObjectBrowserItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private connectionManager: ConnectionManager;

    constructor(connectionManager: ConnectionManager) {
        this.connectionManager = connectionManager;

        // Refresh tree when connection changes
        connectionManager.onConnectionChange(() => {
            this.refresh();
        });
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
     * Get parent of an item (optional, enables reveal API)
     */
    getParent(_element: ObjectBrowserItem): vscode.ProviderResult<ObjectBrowserItem> {
        // TODO: Implement if needed for reveal functionality
        return null;
    }

    /**
     * Get all configured connections as tree nodes
     */
    private getConnectionNodes(): ObjectBrowserItem[] {
        const connections = this.connectionManager.getConnections();
        const activeConnection = this.connectionManager.getActiveConnection();

        return connections.map(conn => {
            const isConnected = activeConnection?.config.name === conn.name;
            const data: ConnectionNodeData = {
                id: createNodeId(conn.name, 'connection', conn.name),
                name: conn.name,
                type: 'connection',
                connectionName: conn.name,
                repository: conn.repository,
                connected: isConnected,
                username: isConnected ? activeConnection?.username : undefined
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
     * Only shows Cabinets - Types, Users, Groups are now in separate browser views
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
     * Fetch cabinets from the repository
     */
    private async getCabinets(data: ContainerNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [];
        }

        try {
            const query = "SELECT r_object_id, object_name FROM dm_cabinet ORDER BY object_name";
            const results = await this.executeDql(connection, query);

            return results.rows.map(row => {
                const cabinetData: CabinetNodeData = {
                    id: createNodeId(data.connectionName, 'cabinet', row.r_object_id as string),
                    name: row.object_name as string,
                    type: 'cabinet',
                    objectId: row.r_object_id as string,
                    path: '/' + (row.object_name as string),
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
     * Fetch folder contents (subfolders and documents)
     */
    private async getFolderContents(data: CabinetNodeData | FolderNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [];
        }

        try {
            const items: ObjectBrowserItem[] = [];

            // Get subfolders - escape path to prevent SQL injection
            const escapedPath = escapeDqlString(data.path);
            const folderQuery = `SELECT r_object_id, object_name FROM dm_folder WHERE folder('${escapedPath}') ORDER BY object_name`;
            const folderResults = await this.executeDql(connection, folderQuery);

            for (const row of folderResults.rows) {
                const folderData: FolderNodeData = {
                    id: createNodeId(data.connectionName, 'folder', row.r_object_id as string),
                    name: row.object_name as string,
                    type: 'folder',
                    objectId: row.r_object_id as string,
                    path: data.path + '/' + (row.object_name as string),
                    parentId: data.objectId,
                    connectionName: data.connectionName
                };
                items.push(new ObjectBrowserItem(folderData, vscode.TreeItemCollapsibleState.Collapsed));
            }

            // Get documents (non-folder sysobjects) - use same escaped path
            const docQuery = `SELECT r_object_id, object_name, r_object_type, a_content_type FROM dm_sysobject WHERE folder('${escapedPath}') AND r_object_type != 'dm_folder' ORDER BY object_name`;
            const docResults = await this.executeDql(connection, docQuery);

            for (const row of docResults.rows) {
                const docData: DocumentNodeData = {
                    id: createNodeId(data.connectionName, 'document', row.r_object_id as string),
                    name: row.object_name as string,
                    type: 'document',
                    objectId: row.r_object_id as string,
                    objectType: row.r_object_type as string,
                    format: row.a_content_type as string | undefined,
                    parentId: data.objectId,
                    connectionName: data.connectionName
                };
                items.push(new ObjectBrowserItem(docData, vscode.TreeItemCollapsibleState.None));
            }

            return items;
        } catch (error) {
            this.showError('Failed to fetch folder contents', error);
            return [];
        }
    }

    /**
     * Execute a DQL query via the bridge.
     * The bridge handles backend type (DFC or REST) internally.
     */
    private async executeDql(
        connection: ActiveConnection,
        query: string
    ): Promise<{ rows: Record<string, unknown>[] }> {
        const bridge = this.connectionManager.getDfcBridge();
        const result = await bridge.executeDql(connection.sessionId, query);
        return { rows: result.rows };
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
    context.subscriptions.push(treeView);

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
                await connectionManager.connect();
            }
        }
    );
    context.subscriptions.push(connectFromTreeCommand);

    // Register disconnect from tree command
    const disconnectFromTreeCommand = vscode.commands.registerCommand(
        'dctm.disconnectFromTree',
        async () => {
            await connectionManager.disconnect();
        }
    );
    context.subscriptions.push(disconnectFromTreeCommand);

    // Register switch user from tree command
    const switchUserFromTreeCommand = vscode.commands.registerCommand(
        'dctm.switchUserFromTree',
        async () => {
            await connectionManager.switchUser();
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
                await vscode.commands.executeCommand('dctm.dumpObject', data);
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
