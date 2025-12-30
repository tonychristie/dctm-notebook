import * as vscode from 'vscode';
import { TypeCache, TypeAttribute } from './typeCache';
import { ConnectionManager } from './connectionManager';

/**
 * Tree item types for the Type Browser
 */
type TreeItemType = 'root' | 'type' | 'attributes-folder' | 'attribute' | 'loading' | 'no-connection';

/**
 * Tree item for the Type Browser
 */
class TypeBrowserItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly itemType: TreeItemType,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly typeName?: string,
        public readonly attribute?: TypeAttribute
    ) {
        super(label, collapsibleState);
        this.contextValue = itemType;
        this.setIcon();
        this.setTooltip();
    }

    private setIcon(): void {
        switch (this.itemType) {
            case 'root':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
                break;
            case 'type':
                this.iconPath = new vscode.ThemeIcon('symbol-class');
                break;
            case 'attributes-folder':
                this.iconPath = new vscode.ThemeIcon('symbol-field');
                break;
            case 'attribute':
                if (this.attribute?.isRepeating) {
                    this.iconPath = new vscode.ThemeIcon('symbol-array');
                } else {
                    this.iconPath = new vscode.ThemeIcon('symbol-property');
                }
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
                this.tooltip = `Type: ${this.typeName}`;
                break;
            case 'attribute':
                if (this.attribute) {
                    const parts = [
                        `${this.attribute.name}: ${this.attribute.dataType}`,
                        this.attribute.length > 0 ? `Length: ${this.attribute.length}` : '',
                        this.attribute.isRepeating ? 'Repeating' : 'Single-value',
                        this.attribute.isInherited ? '(Inherited)' : '(Defined here)'
                    ].filter(p => p);
                    this.tooltip = parts.join('\n');
                }
                break;
        }
    }
}

/**
 * Tree data provider for the Type Browser
 */
export class TypeBrowserProvider implements vscode.TreeDataProvider<TypeBrowserItem> {
    private _onDidChangeTreeData = new vscode.EventEmitter<TypeBrowserItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private typeCache: TypeCache;
    private connectionManager: ConnectionManager;
    private showInheritedAttributes: boolean = true;
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

    setShowInheritedAttributes(show: boolean): void {
        this.showInheritedAttributes = show;
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
                return new TypeBrowserItem(
                    type?.name || name,
                    'type',
                    hasChildren && !this.searchFilter
                        ? vscode.TreeItemCollapsibleState.Collapsed
                        : vscode.TreeItemCollapsibleState.Collapsed,
                    name
                );
            });
        }

        // Type node - show child types and attributes folder
        if (element.itemType === 'type' && element.typeName) {
            const items: TypeBrowserItem[] = [];

            // Add child types (unless searching)
            if (!this.searchFilter) {
                const childTypes = this.typeCache.getChildTypes(element.typeName);
                for (const childName of childTypes) {
                    const childType = this.typeCache.getType(childName);
                    const hasGrandchildren = childType && childType.children.length > 0;
                    items.push(new TypeBrowserItem(
                        childType?.name || childName,
                        'type',
                        hasGrandchildren
                            ? vscode.TreeItemCollapsibleState.Collapsed
                            : vscode.TreeItemCollapsibleState.Collapsed,
                        childName
                    ));
                }
            }

            // Add attributes folder
            items.push(new TypeBrowserItem(
                'Attributes',
                'attributes-folder',
                vscode.TreeItemCollapsibleState.Collapsed,
                element.typeName
            ));

            return items;
        }

        // Attributes folder - show attributes
        if (element.itemType === 'attributes-folder' && element.typeName) {
            // Fetch detailed type info if needed
            const type = await this.typeCache.fetchTypeDetails(element.typeName);
            if (!type) {
                return [];
            }

            const attributes = this.typeCache.getAttributes(
                element.typeName,
                this.showInheritedAttributes
            );

            return attributes.map(attr => {
                const label = this.showInheritedAttributes && attr.isInherited
                    ? `${attr.name} (inherited)`
                    : attr.name;
                const description = `${attr.dataType}${attr.length > 0 ? `(${attr.length})` : ''}${attr.isRepeating ? '[]' : ''}`;

                const item = new TypeBrowserItem(
                    label,
                    'attribute',
                    vscode.TreeItemCollapsibleState.None,
                    element.typeName,
                    attr
                );
                item.description = description;
                return item;
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

    // Toggle inherited attributes command
    let showInherited = true;
    const toggleInheritedCommand = vscode.commands.registerCommand(
        'dctm.toggleInheritedAttributes',
        () => {
            showInherited = !showInherited;
            provider.setShowInheritedAttributes(showInherited);
            vscode.window.showInformationMessage(
                showInherited
                    ? 'Showing all attributes (including inherited)'
                    : 'Showing only type-specific attributes'
            );
        }
    );

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

    // Show type details command
    const showTypeDetailsCommand = vscode.commands.registerCommand(
        'dctm.showTypeDetails',
        async (item: TypeBrowserItem) => {
            if (item.itemType !== 'type' || !item.typeName) {
                return;
            }

            const type = await typeCache.fetchTypeDetails(item.typeName);
            if (!type) {
                vscode.window.showErrorMessage(`Could not load details for type: ${item.typeName}`);
                return;
            }

            // Create a quick pick to show type details
            const details = [
                `Type: ${type.name}`,
                `Super Type: ${type.superType || 'None'}`,
                `Child Types: ${type.children.length}`,
                `Total Attributes: ${type.attributes.length}`,
                `Type-specific Attributes: ${type.attributes.filter(a => !a.isInherited).length}`
            ];

            vscode.window.showQuickPick(details, {
                title: `Type Details: ${type.name}`,
                canPickMany: false
            });
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
        refreshCommand,
        toggleInheritedCommand,
        searchTypesCommand,
        clearSearchCommand,
        showTypeDetailsCommand,
        generateDqlCommand
    );

    return provider;
}
