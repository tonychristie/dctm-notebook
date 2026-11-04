import * as vscode from 'vscode';
import { ConnectionManager, followSelectedCache } from './connectionManager';
import { RepositoryConnection } from './repositoryConnection';
import { EntityCache } from './entityCache';

export interface NamedEntityBrowserConfig<C extends EntityCache<unknown>> {
    viewId: string;
    singular: string;
    plural: string;
    icon: string;
    contextValue: string;
    pickCache: (connection: RepositoryConnection) => C;
    rootNames: (cache: C) => string[];
    childNames?: (cache: C, name: string) => string[];
    filteredContextKey: string;
    commands: {
        open: string;
        showDetails: string;
        refresh: string;
        search: string;
        clearSearch: string;
    };
    searchPrompt: string;
    searchPlaceholder: string;
    openDump: (connectionName: string, name: string) => Promise<void>;
}

const NO_CONNECTION_CONTEXT = 'no-connection';

function capitalise(text: string): string {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

export class NamedEntityItem extends vscode.TreeItem {
    constructor(
        label: string,
        collapsibleState: vscode.TreeItemCollapsibleState,
        contextValue: string,
        icon: string,
        public readonly name?: string
    ) {
        super(label, collapsibleState);
        this.contextValue = contextValue;
        this.iconPath = new vscode.ThemeIcon(icon);
    }
}

export class NamedEntityBrowserProvider<C extends EntityCache<unknown>>
    implements vscode.TreeDataProvider<NamedEntityItem>, vscode.Disposable
{
    private readonly _onDidChangeTreeData = new vscode.EventEmitter<NamedEntityItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private searchFilter = '';
    private readonly cacheSubscription: vscode.Disposable;

    constructor(
        private readonly connectionManager: ConnectionManager,
        private readonly config: NamedEntityBrowserConfig<C>
    ) {
        this.cacheSubscription = followSelectedCache(connectionManager, config.pickCache, () =>
            this._onDidChangeTreeData.fire()
        );
    }

    dispose(): void {
        this.cacheSubscription.dispose();
        this._onDidChangeTreeData.dispose();
    }

    setSearchFilter(filter: string): void {
        this.searchFilter = filter.toLowerCase();
        vscode.commands.executeCommand('setContext', this.config.filteredContextKey, this.searchFilter.length > 0);
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: NamedEntityItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: NamedEntityItem): Promise<NamedEntityItem[]> {
        const connection = this.connectionManager.getSelectedConnection();
        const cache = connection ? this.config.pickCache(connection) : undefined;
        if (!cache) {
            return [this.messageItem(`Connect to repository to browse ${this.config.plural}`)];
        }

        if (element) {
            const childNames = this.config.childNames;
            return element.name && childNames ? this.entityItems(cache, childNames(cache, element.name), true) : [];
        }

        if (cache.getLastRefresh() === null) {
            try {
                await cache.refresh();
            } catch {
                return [this.messageItem(`Unable to load ${this.config.plural}`)];
            }
        }

        if (this.searchFilter) {
            return this.entityItems(cache, cache.search(this.searchFilter), false);
        }
        return this.entityItems(cache, this.config.rootNames(cache), true);
    }

    private messageItem(label: string): NamedEntityItem {
        return new NamedEntityItem(label, vscode.TreeItemCollapsibleState.None, NO_CONNECTION_CONTEXT, 'plug');
    }

    private entityItems(cache: C, names: string[], expandable: boolean): NamedEntityItem[] {
        const { childNames, contextValue, icon, singular, commands } = this.config;
        return names.map(name => {
            const hasChildren = expandable && childNames !== undefined && childNames(cache, name).length > 0;
            const item = new NamedEntityItem(
                name,
                hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None,
                contextValue,
                icon,
                name
            );
            item.tooltip = `${capitalise(singular)}: ${name}\nClick to view details`;
            item.command = { command: commands.open, title: `Open ${capitalise(singular)}`, arguments: [item] };
            return item;
        });
    }
}

export async function openNamedEntity<C extends EntityCache<unknown>>(
    connectionManager: ConnectionManager,
    config: NamedEntityBrowserConfig<C>,
    name: string,
    connectionName?: string
): Promise<void> {
    const target = connectionName ?? connectionManager.getSelectedConnection()?.name;
    if (!target) {
        vscode.window.showErrorMessage('Not connected to Documentum. Use "Documentum: Connect" first.');
        return;
    }
    await config.openDump(target, name);
}

export function registerNamedEntityBrowser<C extends EntityCache<unknown>>(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    config: NamedEntityBrowserConfig<C>
): NamedEntityBrowserProvider<C> {
    const provider = new NamedEntityBrowserProvider(connectionManager, config);
    const { singular, plural, commands } = config;
    const selectedCache = () => {
        const connection = connectionManager.getSelectedConnection();
        return connection ? config.pickCache(connection) : undefined;
    };

    const treeView = vscode.window.createTreeView(config.viewId, {
        treeDataProvider: provider,
        showCollapseAll: config.childNames !== undefined
    });

    const openItem = async (item: NamedEntityItem) => {
        if (!item?.name) {
            return;
        }
        await openNamedEntity(connectionManager, config, item.name);
    };

    const refreshCommand = vscode.commands.registerCommand(commands.refresh, async () => {
        const cache = selectedCache();
        if (!cache) {
            vscode.window.showErrorMessage(`Failed to refresh ${plural}: No active connection`);
            return;
        }

        try {
            await vscode.window.withProgress(
                {
                    location: vscode.ProgressLocation.Notification,
                    title: `Refreshing ${singular} cache...`,
                    cancellable: false
                },
                () => cache.refresh()
            );
            vscode.window.showInformationMessage(
                `${capitalise(singular)} cache refreshed: ${cache.getCount()} ${plural} loaded`
            );
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`Failed to refresh ${plural}: ${error.message}`);
            }
        }
    });

    const searchCommand = vscode.commands.registerCommand(commands.search, async () => {
        const filter = await vscode.window.showInputBox({
            prompt: config.searchPrompt,
            placeHolder: config.searchPlaceholder
        });

        if (filter !== undefined) {
            provider.setSearchFilter(filter);
            if (filter) {
                const results = selectedCache()?.search(filter) ?? [];
                vscode.window.showInformationMessage(`Found ${results.length} matching ${plural}`);
            }
        }
    });

    context.subscriptions.push(
        provider,
        treeView,
        vscode.commands.registerCommand(commands.open, openItem),
        vscode.commands.registerCommand(commands.showDetails, openItem),
        refreshCommand,
        searchCommand,
        vscode.commands.registerCommand(commands.clearSearch, () => provider.setSearchFilter(''))
    );

    return provider;
}
