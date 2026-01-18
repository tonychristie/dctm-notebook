import * as vscode from 'vscode';
import { GroupCache } from './groupCache';
import { ConnectionManager } from './connectionManager';
import { GroupDumpPanel } from './groupDumpPanel';

/**
 * Tree item types for the Group Browser
 */
type TreeItemType = 'group' | 'loading' | 'no-connection';

/**
 * Tree item for the Group Browser
 */
class GroupBrowserItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: TreeItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly groupName?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.setIcon();
        this.setTooltip();

        // Set command to open group in panel when clicked
        if (this.itemType === 'group' && this.groupName) {
            this.command = {
                command: 'dctm.openGroupPanel',
                title: 'Open Group',
                arguments: [this]
            };
        }
    }

    private setIcon(): void {
        switch (this.itemType) {
            case 'group':
                this.iconPath = new vscode.ThemeIcon('organization');
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
            case 'group':
                this.tooltip = `Group: ${this.groupName}\nClick to view details`;
                break;
        }
    }
}

/**
 * Tree data provider for the Group Browser
 * Shows flat list of groups - clicking a group opens it in a panel view
 */
export class GroupBrowserProvider implements vscode.TreeDataProvider<GroupBrowserItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<GroupBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private groupCache: GroupCache;
    private connectionManager: ConnectionManager;
    private searchFilter: string = '';

    constructor(groupCache: GroupCache, connectionManager: ConnectionManager) {
        this.groupCache = groupCache;
        this.connectionManager = connectionManager;

        // Refresh tree when cache is updated
        this.groupCache.onRefresh(() => {
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
        vscode.commands.executeCommand('setContext', 'dctm.groupBrowserFiltered', this.searchFilter.length > 0);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GroupBrowserItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GroupBrowserItem): Promise<GroupBrowserItem[]> {
        // Check connection
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [
                new GroupBrowserItem(
                    'Connect to repository to browse groups',
                    'no-connection',
                    vscode.TreeItemCollapsibleState.None
                )
            ];
        }

        // Root level - show groups
        if (!element) {
            if (!this.groupCache.hasData()) {
                // Try to refresh cache
                try {
                    await this.groupCache.refresh();
                } catch {
                    return [
                        new GroupBrowserItem(
                            'Unable to load groups',
                            'no-connection',
                            vscode.TreeItemCollapsibleState.None
                        )
                    ];
                }
            }

            // Get groups or search results
            let groupNames: string[];
            if (this.searchFilter) {
                groupNames = this.groupCache.searchGroups(this.searchFilter);
            } else {
                groupNames = this.groupCache.getGroupNames();
            }

            return groupNames.map(name => {
                const group = this.groupCache.getGroup(name);
                return new GroupBrowserItem(
                    group?.groupName || name,
                    'group',
                    vscode.TreeItemCollapsibleState.None,
                    name
                );
            });
        }

        return [];
    }
}

/**
 * Register the Group Browser view and commands
 */
export function registerGroupBrowser(
    context: vscode.ExtensionContext,
    groupCache: GroupCache,
    connectionManager: ConnectionManager
): GroupBrowserProvider {
    const provider = new GroupBrowserProvider(groupCache, connectionManager);

    // Register tree view
    const treeView = vscode.window.createTreeView('documentumGroupBrowser', {
        treeDataProvider: provider,
        showCollapseAll: false
    });

    // Open group in panel command (triggered by clicking on a group)
    const openGroupPanelCommand = vscode.commands.registerCommand(
        'dctm.openGroupPanel',
        async (item: GroupBrowserItem) => {
            if (item.itemType !== 'group' || !item.groupName) {
                return;
            }

            await GroupDumpPanel.createOrShow(
                context.extensionUri,
                groupCache,
                item.groupName
            );
        }
    );

    // Refresh command
    const refreshCommand = vscode.commands.registerCommand('dctm.refreshGroupBrowser', async () => {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Refreshing group cache...',
                cancellable: false
            }, async () => {
                await groupCache.refresh();
            });
            vscode.window.showInformationMessage(
                `Group cache refreshed: ${groupCache.getStats().groupCount} groups loaded`
            );
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to refresh groups: ${error.message}`);
            }
        }
    });

    // Search groups command
    const searchGroupsCommand = vscode.commands.registerCommand('dctm.searchGroups', async () => {
        const filter = await vscode.window.showInputBox({
            prompt: 'Enter group name pattern to search',
            placeHolder: 'e.g., dm_admin, docu'
        });

        if (filter !== undefined) {
            provider.setSearchFilter(filter);
            if (filter) {
                const results = groupCache.searchGroups(filter);
                vscode.window.showInformationMessage(`Found ${results.length} matching groups`);
            }
        }
    });

    // Clear search command
    const clearSearchCommand = vscode.commands.registerCommand('dctm.clearGroupSearch', () => {
        provider.setSearchFilter('');
    });

    // Show group details command (opens panel - kept for context menu)
    const showGroupDetailsCommand = vscode.commands.registerCommand(
        'dctm.showGroupDetails',
        async (item: GroupBrowserItem) => {
            if (item.itemType !== 'group' || !item.groupName) {
                return;
            }

            await GroupDumpPanel.createOrShow(
                context.extensionUri,
                groupCache,
                item.groupName
            );
        }
    );

    // Generate DQL for group command
    const generateDqlCommand = vscode.commands.registerCommand(
        'dctm.generateGroupQuery',
        async (item: GroupBrowserItem) => {
            if (item.itemType !== 'group' || !item.groupName) {
                return;
            }

            // Generate a sample DQL query
            const dql = `SELECT group_name, group_address, group_class, owner_name,
    description, users_names, groups_names
FROM dm_group
WHERE group_name = '${item.groupName}'`;

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
        openGroupPanelCommand,
        refreshCommand,
        searchGroupsCommand,
        clearSearchCommand,
        showGroupDetailsCommand,
        generateDqlCommand
    );

    return provider;
}
