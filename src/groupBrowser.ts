import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { GroupDumpPanel } from './groupDumpPanel';
import { buildGroupQuery } from './dqlQueries';
import { GroupCache } from './groupCache';
import {
    NamedEntityBrowserConfig,
    NamedEntityBrowserProvider,
    NamedEntityItem,
    openNamedEntity,
    registerNamedEntityBrowser
} from './namedEntityBrowser';

export function registerGroupBrowser(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): NamedEntityBrowserProvider<GroupCache> {
    const config: NamedEntityBrowserConfig<GroupCache> = {
        viewId: 'documentumGroupBrowser',
        singular: 'group',
        plural: 'groups',
        icon: 'organization',
        contextValue: 'group',
        pickCache: connection => connection.groupCache,
        rootNames: cache => cache.getNames(),
        filteredContextKey: 'dctm.groupBrowserFiltered',
        commands: {
            open: 'dctm.openGroupPanel',
            showDetails: 'dctm.showGroupDetails',
            refresh: 'dctm.refreshGroupBrowser',
            search: 'dctm.searchGroups',
            clearSearch: 'dctm.clearGroupSearch'
        },
        searchPrompt: 'Enter group name pattern to search',
        searchPlaceholder: 'e.g., dm_admin, docu',
        openDump: (connectionName, groupName) =>
            GroupDumpPanel.createOrShow(context.extensionUri, connectionManager, connectionName, groupName)
    };

    const provider = registerNamedEntityBrowser(context, connectionManager, config);

    context.subscriptions.push(
        vscode.commands.registerCommand('dctm.generateGroupQuery', async (item: NamedEntityItem) => {
            if (!item?.name) {
                return;
            }
            const doc = await vscode.workspace.openTextDocument({
                content: buildGroupQuery(item.name),
                language: 'dql'
            });
            await vscode.window.showTextDocument(doc);
        }),
        vscode.commands.registerCommand('dctm.openGroupByName', async (groupName: string, connectionName?: string) => {
            if (!groupName) {
                return;
            }
            await openNamedEntity(connectionManager, config, groupName, connectionName);
        })
    );

    return provider;
}
