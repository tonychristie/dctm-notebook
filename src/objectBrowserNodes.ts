import * as vscode from 'vscode';

export interface ConnectionNodeData {
    connectionName: string;
    repository: string;
    connected: boolean;
    username?: string;
}

export class ConnectionItem extends vscode.TreeItem {
    constructor(public readonly data: ConnectionNodeData) {
        super(data.connectionName, vscode.TreeItemCollapsibleState.None);
        this.id = data.connectionName;
        this.contextValue = data.connected ? 'connection-connected' : 'connection-disconnected';
        this.tooltip = this.getTooltip();
        this.iconPath = new vscode.ThemeIcon(
            data.connected ? 'database' : 'debug-disconnect',
            data.connected ? undefined : new vscode.ThemeColor('errorForeground')
        );
        this.description = this.getDescription();
        this.command = {
            command: 'dctm.openWorkspace',
            title: 'Open Workspace',
            arguments: [data.connectionName]
        };
    }

    private getTooltip(): string {
        const { connectionName, repository, connected, username } = this.data;
        const userInfo = connected && username ? `\nUser: ${username}` : '';
        return `${connectionName}\nRepository: ${repository}${userInfo}\nStatus: ${connected ? 'Connected' : 'Disconnected'}`;
    }

    private getDescription(): string {
        const { repository, connected, username } = this.data;
        if (connected && username) {
            return `${repository} (${username})`;
        }
        return connected ? repository : 'disconnected';
    }
}
