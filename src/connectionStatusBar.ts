import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { DocumentConnections } from './documentConnections';
import { RepositoryConnection } from './repositoryConnection';

export type EditorKind = 'notebook' | 'dql';

export interface ConnectionStatus {
    text: string;
    tooltip: string;
    command: string;
    warning: boolean;
}

export function connectionStatus(
    kind: EditorKind,
    connectionName: string | undefined,
    connection: RepositoryConnection | undefined
): ConnectionStatus {
    const notebook = kind === 'notebook';
    const icon = notebook ? '$(notebook)' : '$(file-code)';
    const command = notebook ? 'dctm.notebook.bindConnection' : 'dctm.linkConnection';
    const subject = notebook ? 'Notebook' : 'File';
    const linked = notebook ? 'bound' : 'linked';
    const change = notebook ? 'Click to change the binding.' : 'Click to change the link.';

    if (connection) {
        return {
            text: `${icon} ${connection.name} (${connection.username})`,
            tooltip: `${subject} ${linked} to ${connection.name} as ${connection.username}. ${change}`,
            command,
            warning: false
        };
    }
    if (connectionName) {
        const runs = notebook ? 'Running a cell connects it.' : 'Running the query connects it.';
        return {
            text: `${icon} ${connectionName} (disconnected)`,
            tooltip: `${subject} ${linked} to ${connectionName}, which is not connected. ${runs} ${change}`,
            command,
            warning: true
        };
    }
    return {
        text: `${icon} No connection`,
        tooltip: notebook
            ? 'Notebook is not bound to a connection. Click to bind it.'
            : 'File is not linked to a connection. Click to link it.',
        command,
        warning: true
    };
}

export function registerConnectionStatusBar(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    documents: DocumentConnections
): void {
    const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    context.subscriptions.push(statusBar);

    const setNotebookContext = (boundName: string | undefined) => {
        void vscode.commands.executeCommand('setContext', 'dctm.notebookBound', !!boundName);
        void vscode.commands.executeCommand('setContext', 'dctm.notebookConnectionName', boundName ?? '');
    };

    const update = () => {
        let kind: EditorKind;
        let connectionName: string | undefined;

        const notebookEditor = vscode.window.activeNotebookEditor;
        const textDocument = vscode.window.activeTextEditor?.document;
        // A notebook cell is a dql document too, so the notebook editor is checked first.
        if (notebookEditor) {
            if (notebookEditor.notebook.notebookType !== 'dctmbook') {
                statusBar.hide();
                setNotebookContext(undefined);
                return;
            }
            kind = 'notebook';
            connectionName = documents.notebookConnectionName(notebookEditor.notebook);
            setNotebookContext(connectionName);
        } else if (textDocument?.languageId === 'dql') {
            kind = 'dql';
            connectionName = documents.connectionName(textDocument);
            setNotebookContext(undefined);
        } else {
            statusBar.hide();
            setNotebookContext(undefined);
            return;
        }

        const connection = connectionName ? connectionManager.getOpenConnection(connectionName) : undefined;
        const status = connectionStatus(kind, connectionName, connection);
        statusBar.text = status.text;
        statusBar.tooltip = status.tooltip;
        statusBar.command = status.command;
        statusBar.backgroundColor = status.warning
            ? new vscode.ThemeColor('statusBarItem.warningBackground')
            : undefined;
        statusBar.show();
    };

    context.subscriptions.push(
        vscode.window.onDidChangeActiveNotebookEditor(update),
        vscode.window.onDidChangeActiveTextEditor(update),
        documents.onDidChange(update),
        connectionManager.onDidChangeOpenConnections(update)
    );

    update();
}
