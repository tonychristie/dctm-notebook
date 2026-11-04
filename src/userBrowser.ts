import * as vscode from 'vscode';
import { ConnectionManager, followSelectedCache } from './connectionManager';
import { UserDumpPanel } from './userDumpPanel';
import { buildUserQuery } from './dqlQueries';

/**
 * Tree item types for the User Browser
 */
type TreeItemType = 'user' | 'loading' | 'no-connection';

/**
 * Tree item for the User Browser
 */
class UserBrowserItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: TreeItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly userName?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.setIcon();
        this.setTooltip();

        // Set command to open user in panel when clicked
        if (this.itemType === 'user' && this.userName) {
            this.command = {
                command: 'dctm.openUserPanel',
                title: 'Open User',
                arguments: [this]
            };
        }
    }

    private setIcon(): void {
        switch (this.itemType) {
            case 'user':
                this.iconPath = new vscode.ThemeIcon('person');
                break;
            case 'loading':
                this.iconPath = new vscode.ThemeIcon('loading~spin');
                break;
            case 'no-connection':
                this.iconPath = new vscode.ThemeIcon('plug');
                break;
        }
    }

    private setTooltip(): void {
        switch (this.itemType) {
            case 'user':
                this.tooltip = `User: ${this.userName}\nClick to view details`;
                break;
        }
    }
}

/**
 * Tree data provider for the User Browser
 * Shows flat list of users - clicking a user opens it in a panel view
 */
export class UserBrowserProvider implements vscode.TreeDataProvider<UserBrowserItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<UserBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private searchFilter: string = '';
    private readonly cacheSubscription: vscode.Disposable;

    constructor(private readonly connectionManager: ConnectionManager) {
        this.cacheSubscription = followSelectedCache(
            connectionManager,
            connection => connection.userCache,
            () => this._onDidChangeTreeData.fire()
        );
    }

    dispose(): void {
        this.cacheSubscription.dispose();
        this._onDidChangeTreeData.dispose();
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setSearchFilter(filter: string): void {
        this.searchFilter = filter.toLowerCase();
        vscode.commands.executeCommand('setContext', 'dctm.userBrowserFiltered', this.searchFilter.length > 0);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: UserBrowserItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: UserBrowserItem): Promise<UserBrowserItem[]> {
        const userCache = this.connectionManager.getSelectedConnection()?.userCache;
        if (!userCache) {
            return [
                new UserBrowserItem(
                    'Connect to repository to browse users',
                    'no-connection',
                    vscode.TreeItemCollapsibleState.None
                )
            ];
        }

        // Root level - show users
        if (!element) {
            if (!userCache.hasData()) {
                // Try to refresh cache
                try {
                    await userCache.refresh();
                } catch {
                    return [
                        new UserBrowserItem(
                            'Unable to load users',
                            'no-connection',
                            vscode.TreeItemCollapsibleState.None
                        )
                    ];
                }
            }

            // Get users or search results
            let userNames: string[];
            if (this.searchFilter) {
                userNames = userCache.searchUsers(this.searchFilter);
            } else {
                userNames = userCache.getUserNames();
            }

            return userNames.map(name => {
                const user = userCache.getUser(name);
                return new UserBrowserItem(
                    user?.userName || name,
                    'user',
                    vscode.TreeItemCollapsibleState.None,
                    name
                );
            });
        }

        return [];
    }
}

/**
 * Register the User Browser view and commands
 */
export function registerUserBrowser(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): UserBrowserProvider {
    const provider = new UserBrowserProvider(connectionManager);

    const openUser = async (userName: string, connectionName?: string) => {
        const name = connectionName ?? connectionManager.getSelectedConnection()?.name;
        if (!name) {
            vscode.window.showErrorMessage('Not connected to Documentum. Use "Documentum: Connect" first.');
            return;
        }
        await UserDumpPanel.createOrShow(context.extensionUri, connectionManager, name, userName);
    };

    // Register tree view
    const treeView = vscode.window.createTreeView('documentumUserBrowser', {
        treeDataProvider: provider,
        showCollapseAll: false
    });

    // Open user in panel command (triggered by clicking on a user)
    const openUserPanelCommand = vscode.commands.registerCommand(
        'dctm.openUserPanel',
        async (item: UserBrowserItem) => {
            if (item.itemType !== 'user' || !item.userName) {
                return;
            }

            await openUser(item.userName);
        }
    );

    // Refresh command
    const refreshCommand = vscode.commands.registerCommand('dctm.refreshUserBrowser', async () => {
        const userCache = connectionManager.getSelectedConnection()?.userCache;
        if (!userCache) {
            vscode.window.showErrorMessage('Failed to refresh users: No active connection');
            return;
        }

        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Refreshing user cache...',
                cancellable: false
            }, async () => {
                await userCache.refresh();
            });
            vscode.window.showInformationMessage(
                `User cache refreshed: ${userCache.getStats().userCount} users loaded`
            );
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to refresh users: ${error.message}`);
            }
        }
    });

    // Search users command
    const searchUsersCommand = vscode.commands.registerCommand('dctm.searchUsers', async () => {
        const filter = await vscode.window.showInputBox({
            prompt: 'Enter user name pattern to search',
            placeHolder: 'e.g., admin, dmadmin'
        });

        if (filter !== undefined) {
            provider.setSearchFilter(filter);
            if (filter) {
                const results = connectionManager.getSelectedConnection()?.userCache.searchUsers(filter) ?? [];
                vscode.window.showInformationMessage(`Found ${results.length} matching users`);
            }
        }
    });

    // Clear search command
    const clearSearchCommand = vscode.commands.registerCommand('dctm.clearUserSearch', () => {
        provider.setSearchFilter('');
    });

    // Show user details command (opens panel - kept for context menu)
    const showUserDetailsCommand = vscode.commands.registerCommand(
        'dctm.showUserDetails',
        async (item: UserBrowserItem) => {
            if (item.itemType !== 'user' || !item.userName) {
                return;
            }

            await openUser(item.userName);
        }
    );

    // Generate DQL for user command
    const generateDqlCommand = vscode.commands.registerCommand(
        'dctm.generateUserQuery',
        async (item: UserBrowserItem) => {
            if (item.itemType !== 'user' || !item.userName) {
                return;
            }

            const doc = await vscode.workspace.openTextDocument({
                content: buildUserQuery(item.userName),
                language: 'dql'
            });
            await vscode.window.showTextDocument(doc);
        }
    );

    // Open user panel by name (for cross-panel navigation)
    const openUserByNameCommand = vscode.commands.registerCommand(
        'dctm.openUserByName',
        async (userName: string, connectionName?: string) => {
            if (!userName) {
                return;
            }
            await openUser(userName, connectionName);
        }
    );

    context.subscriptions.push(
        provider,
        treeView,
        openUserPanelCommand,
        refreshCommand,
        searchUsersCommand,
        clearSearchCommand,
        showUserDetailsCommand,
        generateDqlCommand,
        openUserByNameCommand
    );

    return provider;
}
