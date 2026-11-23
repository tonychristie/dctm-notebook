import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { buildUserQuery } from './dqlQueries';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';
import { UserDump, fetchUserDump, renderUserDump } from './dumps/userDump';

const config: DumpPanelConfig = {
    viewType: 'dctmUserDump',
    entry: 'userDumpPanel',
    title: 'User',
    noun: 'user'
};

export class UserDumpPanel extends DumpPanelBase<string, UserDump> {
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        userName: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, userName,
            panel => new UserDumpPanel(panel, connectionManager, connectionName, userName, extensionUri));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        userName: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, userName, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'generateDql':
                await this.generateDqlQuery();
                break;
            case 'openGroup':
                await vscode.commands.executeCommand('dctm.openGroupByName', message.groupName, this.connectionName);
                break;
            case 'dumpObject':
                await vscode.commands.executeCommand('dctm.dumpObject', message.objectId, this.connectionName);
                break;
        }
    }

    protected fetch(connection: RepositoryConnection, userName: string, refresh: boolean): Promise<UserDump> {
        return fetchUserDump(connection, userName, refresh);
    }

    private async generateDqlQuery(): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({
            content: buildUserQuery(this.currentKey),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    protected renderContent(dump: UserDump): string {
        return renderUserDump(dump);
    }
}
