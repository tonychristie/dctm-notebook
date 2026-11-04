import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { UserDumpPanel } from './userDumpPanel';
import { buildUserQuery } from './dqlQueries';
import { UserCache } from './userCache';
import {
    NamedEntityBrowserConfig,
    NamedEntityBrowserProvider,
    NamedEntityItem,
    openNamedEntity,
    registerNamedEntityBrowser
} from './namedEntityBrowser';

export function registerUserBrowser(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): NamedEntityBrowserProvider<UserCache> {
    const config: NamedEntityBrowserConfig<UserCache> = {
        viewId: 'documentumUserBrowser',
        singular: 'user',
        plural: 'users',
        icon: 'person',
        contextValue: 'user',
        pickCache: connection => connection.userCache,
        rootNames: cache => cache.getNames(),
        filteredContextKey: 'dctm.userBrowserFiltered',
        commands: {
            open: 'dctm.openUserPanel',
            showDetails: 'dctm.showUserDetails',
            refresh: 'dctm.refreshUserBrowser',
            search: 'dctm.searchUsers',
            clearSearch: 'dctm.clearUserSearch'
        },
        searchPrompt: 'Enter user name pattern to search',
        searchPlaceholder: 'e.g., admin, dmadmin',
        openDump: (connectionName, userName) =>
            UserDumpPanel.createOrShow(context.extensionUri, connectionManager, connectionName, userName)
    };

    const provider = registerNamedEntityBrowser(context, connectionManager, config);

    context.subscriptions.push(
        vscode.commands.registerCommand('dctm.generateUserQuery', async (item: NamedEntityItem) => {
            if (!item?.name) {
                return;
            }
            const doc = await vscode.workspace.openTextDocument({
                content: buildUserQuery(item.name),
                language: 'dql'
            });
            await vscode.window.showTextDocument(doc);
        }),
        vscode.commands.registerCommand('dctm.openUserByName', async (userName: string, connectionName?: string) => {
            if (!userName) {
                return;
            }
            await openNamedEntity(connectionManager, config, userName, connectionName);
        })
    );

    return provider;
}
