import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { NavigationHistory } from './navigationHistory';
import { RepositoryConnection } from './repositoryConnection';
import { DumpPanelBase, DumpPanelConfig, DumpPanelMessage } from './dumpPanelBase';
import { ObjectDump, fetchObjectDump, renderObjectDump } from './dumps/objectDump';

export interface NavigationEntry {
    connectionName: string;
    objectId: string;
    objectName: string;
    typeName: string;
}

const config: DumpPanelConfig = {
    viewType: 'dctmObjectDump',
    entry: 'objectDumpPanel',
    title: 'Object',
    noun: 'object'
};

export class ObjectDumpPanel extends DumpPanelBase<string, ObjectDump> {
    private history = new NavigationHistory<NavigationEntry>();

    public static async createOrShow(
        extensionUri: vscode.Uri,
        connectionManager: ConnectionManager,
        connectionName: string,
        objectId: string
    ): Promise<void> {
        await DumpPanelBase.show(config, extensionUri, connectionName, objectId,
            panel => new ObjectDumpPanel(panel, connectionManager, connectionName, objectId, extensionUri));
    }

    public constructor(
        panel: vscode.WebviewPanel,
        connectionManager: ConnectionManager,
        connectionName: string,
        objectId: string,
        extensionUri: vscode.Uri
    ) {
        super(config, panel, connectionManager, connectionName, objectId, extensionUri);
    }

    protected async handleMessage(message: DumpPanelMessage): Promise<void> {
        switch (message.command) {
            case 'dumpObject':
                await this.load(message.objectId, this.connectionName);
                break;
            case 'goBack':
                await this.showHistoryEntry(this.history.back());
                break;
            case 'goForward':
                await this.showHistoryEntry(this.history.forward());
                break;
        }
    }

    // Loads as a refresh, so the entry the history already holds is not added again.
    private async showHistoryEntry(entry: NavigationEntry | undefined): Promise<void> {
        if (entry) {
            await this.load(entry.objectId, entry.connectionName, true);
        }
    }

    protected onLatestResponse(dump: ObjectDump, refresh: boolean): void {
        const titleParts = [dump.objectId];
        if (dump.objectName) {
            titleParts.push(dump.objectName);
        }
        titleParts.push(dump.typeName);
        this.panel.title = titleParts.join(' ');

        if (!refresh) {
            this.history.add({
                connectionName: this.connectionName,
                objectId: dump.objectId,
                objectName: dump.objectName,
                typeName: dump.typeName
            });
        }
    }

    protected fetch(connection: RepositoryConnection, objectId: string): Promise<ObjectDump> {
        return fetchObjectDump(connection, objectId);
    }

    protected renderContent(dump: ObjectDump): string {
        const navButtons = `<span class="nav-buttons">
                <button data-action="goBack" ${this.history.canGoBack() ? '' : 'disabled'} title="Go back">&#9664;</button>
                <button data-action="goForward" ${this.history.canGoForward() ? '' : 'disabled'} title="Go forward">&#9654;</button>
            </span>`;
        return renderObjectDump(dump, navButtons);
    }
}
