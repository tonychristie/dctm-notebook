import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { buildGroupQuery } from './dqlQueries';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';
import { GroupDump, fetchGroupDump, renderGroupDump } from './dumps/groupDump';

const config: DumpPanelConfig = {
    viewType: 'dctmGroupDump',
    entry: 'groupDumpPanel',
    title: 'Group',
    noun: 'group'
};

export class GroupDumpPanel extends DumpPanelBase<string, GroupDump> {
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        groupName: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, groupName,
            panel => new GroupDumpPanel(panel, connectionManager, connectionName, groupName, extensionUri));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        groupName: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, groupName, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'generateDql':
                await this.generateDqlQuery();
                break;
            case 'openGroup':
                await GroupDumpPanel.createOrShow(
                    this.extensionUri,
                    this.connectionManager,
                    this.connectionName,
                    message.groupName
                );
                break;
            case 'openUser':
                await vscode.commands.executeCommand('dctm.openUserByName', message.userName, this.connectionName);
                break;
            case 'dumpObject':
                await vscode.commands.executeCommand('dctm.dumpObject', message.objectId, this.connectionName);
                break;
        }
    }

    protected fetch(connection: RepositoryConnection, groupName: string, refresh: boolean): Promise<GroupDump> {
        return fetchGroupDump(connection, groupName, refresh);
    }

    private async generateDqlQuery(): Promise<void> {
        const doc = await vscode.workspace.openTextDocument({
            content: buildGroupQuery(this.currentKey),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    protected renderContent(dump: GroupDump): string {
        return renderGroupDump(dump);
    }
}
