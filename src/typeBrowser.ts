import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { TypeDumpPanel } from './typeDumpPanel';
import { TypeCache } from './typeCache';
import {
    NamedEntityBrowserConfig,
    NamedEntityBrowserProvider,
    NamedEntityItem,
    registerNamedEntityBrowser
} from './namedEntityBrowser';

export function registerTypeBrowser(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): NamedEntityBrowserProvider<TypeCache> {
    const config: NamedEntityBrowserConfig<TypeCache> = {
        viewId: 'documentumTypeBrowser',
        singular: 'type',
        plural: 'types',
        icon: 'symbol-class',
        contextValue: 'type',
        pickCache: connection => connection.typeCache,
        rootNames: cache => cache.getRootTypes(),
        childNames: (cache, typeName) => cache.getChildTypes(typeName),
        filteredContextKey: 'dctm.typeBrowserFiltered',
        commands: {
            open: 'dctm.openTypePanel',
            showDetails: 'dctm.showTypeDetails',
            refresh: 'dctm.refreshTypeBrowser',
            search: 'dctm.searchTypes',
            clearSearch: 'dctm.clearTypeSearch'
        },
        searchPrompt: 'Enter type name pattern to search',
        searchPlaceholder: 'e.g., dm_document, custom_',
        openDump: (connectionName, typeName) =>
            TypeDumpPanel.createOrShow(context.extensionUri, connectionManager, connectionName, typeName)
    };

    const provider = registerNamedEntityBrowser(context, connectionManager, config);

    context.subscriptions.push(
        vscode.commands.registerCommand('dctm.generateTypeQuery', async (item: NamedEntityItem) => {
            if (!item?.name) {
                return;
            }

            let type;
            try {
                type = await connectionManager.getSelectedConnection()?.typeCache.fetchTypeDetails(item.name);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to generate DQL for ${item.name}: ${message}`);
                return;
            }
            if (!type) {
                return;
            }

            const attrs = type.attributes
                .filter(a => !a.isInherited)
                .slice(0, 5)
                .map(a => a.name);

            if (attrs.length === 0) {
                attrs.push('r_object_id', 'object_name');
            }

            const doc = await vscode.workspace.openTextDocument({
                content: `SELECT ${attrs.join(', ')}\nFROM ${type.name}\nWHERE 1=1`,
                language: 'dql'
            });
            await vscode.window.showTextDocument(doc);
        })
    );

    return provider;
}
