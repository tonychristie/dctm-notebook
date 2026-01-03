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
    TypeNodeData,
    UserNodeData,
    GroupNodeData,
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
 *   - Types
 *   - Users
 *   - Groups
 */
export class ObjectBrowserProvider implements vscode.TreeDataProvider<ObjectBrowserItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ObjectBrowserItem | undefined | null | void> =
        new vscode.EventEmitter<ObjectBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ObjectBrowserItem | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private connectionManager: ConnectionManager;
    private expandedNodes: Set<string> = new Set();

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
            case 'types-container':
                return this.getTypes(element.data as ContainerNodeData);
            case 'users-container':
                return this.getUsers(element.data as ContainerNodeData);
            case 'groups-container':
                return this.getGroups(element.data as ContainerNodeData);
            case 'cabinet':
            case 'folder':
                return this.getFolderContents(element.data as CabinetNodeData | FolderNodeData);
            case 'type':
                return this.getSubtypes(element.data as TypeNodeData);
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
            },
            {
                id: createNodeId(data.connectionName, 'types-container', 'types'),
                name: 'Types',
                type: 'types-container',
                connectionName: data.connectionName
            },
            {
                id: createNodeId(data.connectionName, 'users-container', 'users'),
                name: 'Users',
                type: 'users-container',
                connectionName: data.connectionName
            },
            {
                id: createNodeId(data.connectionName, 'groups-container', 'groups'),
                name: 'Groups',
                type: 'groups-container',
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
     * Fetch top-level types
     */
    private async getTypes(data: ContainerNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [];
        }

        try {
            // Get root types (dm_sysobject and its immediate subtypes)
            const query = "SELECT name, super_name FROM dm_type WHERE super_name = 'dm_sysobject' ORDER BY name";
            await this.executeDql(connection, query);

            const items: ObjectBrowserItem[] = [];

            // Add dm_sysobject as root
            const sysObjectData: TypeNodeData = {
                id: createNodeId(data.connectionName, 'type', 'dm_sysobject'),
                name: 'dm_sysobject',
                type: 'type',
                typeName: 'dm_sysobject',
                superType: 'dm_persistent',
                isSystemType: true,
                connectionName: data.connectionName
            };
            items.push(new ObjectBrowserItem(sysObjectData, vscode.TreeItemCollapsibleState.Collapsed));

            return items;
        } catch (error) {
            this.showError('Failed to fetch types', error);
            return [];
        }
    }

    /**
     * Fetch subtypes of a type
     */
    private async getSubtypes(data: TypeNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [];
        }

        try {
            // Escape type name to prevent SQL injection
            const escapedTypeName = escapeDqlString(data.typeName);
            const query = `SELECT name, super_name FROM dm_type WHERE super_name = '${escapedTypeName}' ORDER BY name`;
            const results = await this.executeDql(connection, query);

            return results.rows.map(row => {
                const typeName = row.name as string;
                const typeData: TypeNodeData = {
                    id: createNodeId(data.connectionName, 'type', typeName),
                    name: typeName,
                    type: 'type',
                    typeName: typeName,
                    superType: data.typeName,
                    isSystemType: typeName.startsWith('dm_') || typeName.startsWith('dmi_'),
                    connectionName: data.connectionName
                };
                return new ObjectBrowserItem(typeData, vscode.TreeItemCollapsibleState.Collapsed);
            });
        } catch (error) {
            this.showError('Failed to fetch subtypes', error);
            return [];
        }
    }

    /**
     * Fetch users
     */
    private async getUsers(data: ContainerNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [];
        }

        try {
            const query = "SELECT user_name, user_login_name FROM dm_user WHERE user_state = 0 AND r_is_group = false ORDER BY user_name ENABLE (RETURN_TOP 100)";
            const results = await this.executeDql(connection, query);

            return results.rows.map(row => {
                const userName = row.user_name as string;
                const userData: UserNodeData = {
                    id: createNodeId(data.connectionName, 'user', userName),
                    name: userName,
                    type: 'user',
                    userName: userName,
                    userLoginName: row.user_login_name as string,
                    connectionName: data.connectionName
                };
                return new ObjectBrowserItem(userData, vscode.TreeItemCollapsibleState.None);
            });
        } catch (error) {
            this.showError('Failed to fetch users', error);
            return [];
        }
    }

    /**
     * Fetch groups
     */
    private async getGroups(data: ContainerNodeData): Promise<ObjectBrowserItem[]> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [];
        }

        try {
            const query = "SELECT group_name FROM dm_group ORDER BY group_name ENABLE (RETURN_TOP 100)";
            const results = await this.executeDql(connection, query);

            return results.rows.map(row => {
                const groupName = row.group_name as string;
                const groupData: GroupNodeData = {
                    id: createNodeId(data.connectionName, 'group', groupName),
                    name: groupName,
                    type: 'group',
                    groupName: groupName,
                    connectionName: data.connectionName
                };
                return new ObjectBrowserItem(groupData, vscode.TreeItemCollapsibleState.None);
            });
        } catch (error) {
            this.showError('Failed to fetch groups', error);
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

    // Register query type command
    const queryTypeCommand = vscode.commands.registerCommand(
        'dctm.queryType',
        async (item: ObjectBrowserItem) => {
            if (item.data.type === 'type') {
                const typeData = item.data as TypeNodeData;
                const query = `SELECT r_object_id, object_name, r_modify_date FROM ${typeData.typeName} ENABLE (RETURN_TOP 100)`;

                // Create a new DQL file with the query
                const doc = await vscode.workspace.openTextDocument({
                    language: 'dql',
                    content: query
                });
                await vscode.window.showTextDocument(doc);
            }
        }
    );
    context.subscriptions.push(queryTypeCommand);

    return provider;
}
