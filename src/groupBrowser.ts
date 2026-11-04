import * as vscode from 'vscode';
import { ConnectionManager, followSelectedCache } from './connectionManager';
import { GroupDumpPanel } from './groupDumpPanel';
import { buildGroupQuery } from './dqlQueries';

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
export class GroupBrowserProvider implements vscode.TreeDataProvider<GroupBrowserItem>, vscode.Disposable {
    private _onDidChangeTreeData = new vscode.EventEmitter<GroupBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private searchFilter: string = '';
    private readonly cacheSubscription: vscode.Disposable;

    constructor(private readonly connectionManager: ConnectionManager) {
        this.cacheSubscription = followSelectedCache(
            connectionManager,
            connection => connection.groupCache,
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
        vscode.commands.executeCommand('setContext', 'dctm.groupBrowserFiltered', this.searchFilter.length > 0);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: GroupBrowserItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: GroupBrowserItem): Promise<GroupBrowserItem[]> {
        const groupCache = this.connectionManager.getSelectedConnection()?.groupCache;
        if (!groupCache) {
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
            if (!groupCache.hasData()) {
                // Try to refresh cache
                try {
                    await groupCache.refresh();
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
                groupNames = groupCache.searchGroups(this.searchFilter);
            } else {
                groupNames = groupCache.getGroupNames();
            }

            return groupNames.map(name => {
                const group = groupCache.getGroup(name);
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
    connectionManager: ConnectionManager
): GroupBrowserProvider {
    const provider = new GroupBrowserProvider(connectionManager);

    const openGroup = async (groupName: string, connectionName?: string) => {
        const name = connectionName ?? connectionManager.getSelectedConnection()?.name;
        if (!name) {
            vscode.window.showErrorMessage('Not connected to Documentum. Use "Documentum: Connect" first.');
            return;
        }
        await GroupDumpPanel.createOrShow(context.extensionUri, connectionManager, name, groupName);
    };

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

            await openGroup(item.groupName);
        }
    );

    // Refresh command
    const refreshCommand = vscode.commands.registerCommand('dctm.refreshGroupBrowser', async () => {
        const groupCache = connectionManager.getSelectedConnection()?.groupCache;
        if (!groupCache) {
            vscode.window.showErrorMessage('Failed to refresh groups: No active connection');
            return;
        }

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
                const results = connectionManager.getSelectedConnection()?.groupCache.searchGroups(filter) ?? [];
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

            await openGroup(item.groupName);
        }
    );

    // Generate DQL for group command
    const generateDqlCommand = vscode.commands.registerCommand(
        'dctm.generateGroupQuery',
        async (item: GroupBrowserItem) => {
            if (item.itemType !== 'group' || !item.groupName) {
                return;
            }

            const doc = await vscode.workspace.openTextDocument({
                content: buildGroupQuery(item.groupName),
                language: 'dql'
            });
            await vscode.window.showTextDocument(doc);
        }
    );

    // Open group panel by name (for cross-panel navigation)
    const openGroupByNameCommand = vscode.commands.registerCommand(
        'dctm.openGroupByName',
        async (groupName: string, connectionName?: string) => {
            if (!groupName) {
                return;
            }
            await openGroup(groupName, connectionName);
        }
    );

    context.subscriptions.push(
        provider,
        treeView,
        openGroupPanelCommand,
        refreshCommand,
        searchGroupsCommand,
        clearSearchCommand,
        showGroupDetailsCommand,
        generateDqlCommand,
        openGroupByNameCommand
    );

    return provider;
}
