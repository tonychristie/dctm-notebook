import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { buildTypeQuery } from './dqlQueries';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';
import { TypeDump, fetchTypeDump, renderTypeDump } from './dumps/typeDump';

const config: DumpPanelConfig = {
    viewType: 'dctmTypeDump',
    entry: 'typeDumpPanel',
    title: 'Type',
    noun: 'type'
};

export class TypeDumpPanel extends DumpPanelBase<string, TypeDump> {
    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        typeName: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, typeName,
            panel => new TypeDumpPanel(panel, connectionManager, connectionName, typeName, extensionUri));
    }

    private constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        typeName: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, typeName, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'openType':
                await this.load(message.typeName, this.connectionName);
                break;
            case 'generateDql':
                await this.generateDqlQuery();
                break;
        }
    }

    protected fetch(connection: RepositoryConnection, typeName: string, refresh: boolean): Promise<TypeDump> {
        return fetchTypeDump(connection, typeName, refresh);
    }

    private async generateDqlQuery(): Promise<void> {
        const connection = this.connectionManager.getOpenConnection(this.connectionName);
        let type;
        try {
            type = await connection?.typeCache.fetchTypeDetails(this.currentKey);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to generate DQL for ${this.currentKey}: ${message}`);
            return;
        }
        if (!type) {
            return;
        }

        const doc = await vscode.workspace.openTextDocument({
            content: buildTypeQuery(type),
            language: 'dql'
        });
        await vscode.window.showTextDocument(doc);
    }

    protected renderContent(dump: TypeDump): string {
        return renderTypeDump(dump);
    }
}
