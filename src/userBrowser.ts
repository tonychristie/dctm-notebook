import * as vscode from 'vscode';
import { UserCache } from './userCache';
import { ConnectionManager } from './connectionManager';
import { UserDumpPanel } from './userDumpPanel';

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
export class UserBrowserProvider implements vscode.TreeDataProvider<UserBrowserItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<UserBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private userCache: UserCache;
    private connectionManager: ConnectionManager;
    private searchFilter: string = '';

    constructor(userCache: UserCache, connectionManager: ConnectionManager) {
        this.userCache = userCache;
        this.connectionManager = connectionManager;

        // Refresh tree when cache is updated
        this.userCache.onRefresh(() => {
            this._onDidChangeTreeData.fire();
        });

        // Refresh tree when connection changes
        this.connectionManager.onConnectionChange(() => {
            this._onDidChangeTreeData.fire();
        });
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    setSearchFilter(filter: string): void {
        this.searchFilter = filter.toLowerCase();
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: UserBrowserItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: UserBrowserItem): Promise<UserBrowserItem[]> {
        // Check connection
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
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
            if (!this.userCache.hasData()) {
                // Try to refresh cache
                try {
                    await this.userCache.refresh();
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
                userNames = this.userCache.searchUsers(this.searchFilter);
            } else {
                userNames = this.userCache.getUserNames();
            }

            return userNames.map(name => {
                const user = this.userCache.getUser(name);
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
    userCache: UserCache,
    connectionManager: ConnectionManager
): UserBrowserProvider {
    const provider = new UserBrowserProvider(userCache, connectionManager);

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

            await UserDumpPanel.createOrShow(
                context.extensionUri,
                userCache,
                item.userName
            );
        }
    );

    // Refresh command
    const refreshCommand = vscode.commands.registerCommand('dctm.refreshUserBrowser', async () => {
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
                const results = userCache.searchUsers(filter);
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

            await UserDumpPanel.createOrShow(
                context.extensionUri,
                userCache,
                item.userName
            );
        }
    );

    // Generate DQL for user command
    const generateDqlCommand = vscode.commands.registerCommand(
        'dctm.generateUserQuery',
        async (item: UserBrowserItem) => {
            if (item.itemType !== 'user' || !item.userName) {
                return;
            }

            // Generate a sample DQL query
            const dql = `SELECT user_name, user_login_name, user_os_name, user_address,
    default_folder, default_group, description
FROM dm_user
WHERE user_name = '${item.userName}'`;

            // Open in new editor
            const doc = await vscode.workspace.openTextDocument({
                content: dql,
                language: 'dql'
            });
            await vscode.window.showTextDocument(doc);
        }
    );

    context.subscriptions.push(
        treeView,
        openUserPanelCommand,
        refreshCommand,
        searchUsersCommand,
        clearSearchCommand,
        showUserDetailsCommand,
        generateDqlCommand
    );

    return provider;
}
