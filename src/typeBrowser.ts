import * as vscode from 'vscode';
import { TypeCache } from './typeCache';
import { ConnectionManager } from './connectionManager';
import { TypeDumpPanel } from './typeDumpPanel';

/**
 * Tree item types for the Type Browser
 */
type TreeItemType = 'root' | 'type' | 'loading' | 'no-connection';

/**
 * Tree item for the Type Browser
 * Types are now clickable and open in a panel view instead of inline expansion
 */
class TypeBrowserItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: TreeItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly typeName?: string,
        public readonly hasChildren?: boolean
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.setIcon();
        this.setTooltip();

        // Set command to open type in panel when clicked
        if (this.itemType === 'type' && this.typeName) {
            this.command = {
                command: 'dctm.openTypePanel',
                title: 'Open Type',
                arguments: [this]
            };
        }
    }

    private setIcon(): void {
        switch (this.itemType) {
            case 'root':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
                break;
            case 'type':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
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
            case 'type':
                this.tooltip = `Type: ${this.typeName}\nClick to view details`;
                break;
        }
    }
}

/**
 * Tree data provider for the Type Browser
 * Shows type hierarchy only - clicking a type opens it in a panel view
 */
export class TypeBrowserProvider implements vscode.TreeDataProvider<TypeBrowserItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TypeBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private typeCache: TypeCache;
    private connectionManager: ConnectionManager;
    private searchFilter: string = '';

    constructor(typeCache: TypeCache, connectionManager: ConnectionManager) {
        this.typeCache = typeCache;
        this.connectionManager = connectionManager;

        // Refresh tree when cache is updated
        this.typeCache.onRefresh(() => {
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

    getTreeItem(element: TypeBrowserItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: TypeBrowserItem): Promise<TypeBrowserItem[]> {
        // Check connection
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            return [
                new TypeBrowserItem(
                    'Connect to repository to browse types',
                    'no-connection',
                    vscode.TreeItemCollapsibleState.None
                )
            ];
        }

        // Root level - show type hierarchy
        if (!element) {
            if (!this.typeCache.hasData()) {
                // Try to refresh cache
                try {
                    await this.typeCache.refresh();
                } catch {
                    return [
                        new TypeBrowserItem(
                            'Unable to load types',
                            'no-connection',
                            vscode.TreeItemCollapsibleState.None
                        )
                    ];
                }
            }

            // Get root types or search results
            let typeNames: string[];
            if (this.searchFilter) {
                typeNames = this.typeCache.searchTypes(this.searchFilter);
            } else {
                typeNames = this.typeCache.getRootTypes();
            }

            return typeNames.map(name => {
                const type = this.typeCache.getType(name);
                const hasChildren = type && type.children.length > 0;
                // When searching, show flat list (no children expansion)
                // When browsing hierarchy, allow expansion if type has children
                const collapsible = this.searchFilter
                    ? vscode.TreeItemCollapsibleState.None
                    : (hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None);
                return new TypeBrowserItem(
                    type?.name || name,
                    'type',
                    collapsible,
                    name,
                    hasChildren
                );
            });
        }

        // Type node - show only child types (no attributes - those are shown in panel)
        if (element.itemType === 'type' && element.typeName) {
            const childTypes = this.typeCache.getChildTypes(element.typeName);
            return childTypes.map(childName => {
                const childType = this.typeCache.getType(childName);
                const hasGrandchildren = childType && childType.children.length > 0;
                return new TypeBrowserItem(
                    childType?.name || childName,
                    'type',
                    hasGrandchildren
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.None,
                    childName,
                    hasGrandchildren
                );
            });
        }

        return [];
    }
}

/**
 * Register the Type Browser view and commands
 */
export function registerTypeBrowser(
    context: vscode.ExtensionContext,
    typeCache: TypeCache,
    connectionManager: ConnectionManager
): TypeBrowserProvider {
    const provider = new TypeBrowserProvider(typeCache, connectionManager);

    // Register tree view
    const treeView = vscode.window.createTreeView('documentumTypeBrowser', {
        treeDataProvider: provider,
        showCollapseAll: true
    });

    // Open type in panel command (triggered by clicking on a type)
    const openTypePanelCommand = vscode.commands.registerCommand(
        'dctm.openTypePanel',
        async (item: TypeBrowserItem) => {
            if (item.itemType !== 'type' || !item.typeName) {
                return;
            }

            await TypeDumpPanel.createOrShow(
                context.extensionUri,
                typeCache,
                item.typeName
            );
        }
    );

    // Refresh command
    const refreshCommand = vscode.commands.registerCommand('dctm.refreshTypeBrowser', async () => {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: 'Refreshing type cache...',
                cancellable: false
            }, async () => {
                await typeCache.refresh();
            });
            vscode.window.showInformationMessage(
                `Type cache refreshed: ${typeCache.getStats().typeCount} types loaded`
            );
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to refresh types: ${error.message}`);
            }
        }
    });

    // Search types command
    const searchTypesCommand = vscode.commands.registerCommand('dctm.searchTypes', async () => {
        const filter = await vscode.window.showInputBox({
            prompt: 'Enter type name pattern to search',
            placeHolder: 'e.g., dm_document, custom_'
        });

        if (filter !== undefined) {
            provider.setSearchFilter(filter);
            if (filter) {
                const results = typeCache.searchTypes(filter);
                vscode.window.showInformationMessage(`Found ${results.length} matching types`);
            }
        }
    });

    // Clear search command
    const clearSearchCommand = vscode.commands.registerCommand('dctm.clearTypeSearch', () => {
        provider.setSearchFilter('');
    });

    // Show type details command (opens panel - kept for context menu)
    const showTypeDetailsCommand = vscode.commands.registerCommand(
        'dctm.showTypeDetails',
        async (item: TypeBrowserItem) => {
            if (item.itemType !== 'type' || !item.typeName) {
                return;
            }

            await TypeDumpPanel.createOrShow(
                context.extensionUri,
                typeCache,
                item.typeName
            );
        }
    );

    // Generate DQL for type command
    const generateDqlCommand = vscode.commands.registerCommand(
        'dctm.generateTypeQuery',
        async (item: TypeBrowserItem) => {
            if (item.itemType !== 'type' || !item.typeName) {
                return;
            }

            const type = await typeCache.fetchTypeDetails(item.typeName);
            if (!type) {
                return;
            }

            // Generate a sample DQL query
            const attrs = type.attributes
                .filter(a => !a.isInherited)
                .slice(0, 5)
                .map(a => a.name);

            if (attrs.length === 0) {
                attrs.push('r_object_id', 'object_name');
            }

            const dql = `SELECT ${attrs.join(', ')}\nFROM ${type.name}\nWHERE 1=1`;

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
        openTypePanelCommand,
        refreshCommand,
        searchTypesCommand,
        clearSearchCommand,
        showTypeDetailsCommand,
        generateDqlCommand
    );

    return provider;
}
