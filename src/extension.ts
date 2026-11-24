import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { DqlExecutor } from './dqlExecutor';
import { ResultsPanel } from './resultsPanel';
import { registerConnectionsView } from './connectionsView';
import { ApiExecutor } from './apiExecutor';
import { registerConnectionsPanel } from './connectionsPanel';
import { registerDqlSemanticTokens } from './dqlSemanticTokens';
import { registerApiMethodReference } from './apiMethodReference';
import { registerNotebook } from './notebook';
import { registerConnectionWorkspace } from './workspace/connectionWorkspace';
import { registerObjectCommands } from './workspace/objectCommands';

let connectionManager: ConnectionManager;
let dqlExecutor: DqlExecutor;
let apiExecutor: ApiExecutor;

export function activate(context: vscode.ExtensionContext) {
    connectionManager = new ConnectionManager();
    dqlExecutor = new DqlExecutor();
    apiExecutor = new ApiExecutor();
    context.subscriptions.push(connectionManager);

    const connectCommand = vscode.commands.registerCommand('dctm.connect', async () => {
        await connectionManager.connect();
    });

    const disconnectCommand = vscode.commands.registerCommand('dctm.disconnect', async () => {
        await connectionManager.disconnect();
    });

    const switchUserCommand = vscode.commands.registerCommand('dctm.switchUser', async () => {
        await connectionManager.switchUser();
    });

    const executeDqlCommand = vscode.commands.registerCommand('dctm.executeDql', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        // Get selected text or entire document
        const selection = editor.selection;
        const query = selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(selection);

        if (!query.trim()) {
            vscode.window.showWarningMessage('No DQL query to execute');
            return;
        }

        const connection = connectionManager.getSelectedConnection();
        if (!connection) {
            vscode.window.showErrorMessage('DQL Error: Not connected to Documentum. Use "Documentum: Connect" first.');
            return;
        }

        try {
            const results = await dqlExecutor.execute(query, connection);
            ResultsPanel.createOrShow(context.extensionUri, results);
        } catch (error) {
            if (error instanceof Error) {
                vscode.window.showErrorMessage(`DQL Error: ${error.message}`);
            }
        }
    });

    const showConnectionsCommand = vscode.commands.registerCommand('dctm.showConnections', async () => {
        await connectionManager.showConnections();
    });

    context.subscriptions.push(
        connectCommand,
        disconnectCommand,
        switchUserCommand,
        executeDqlCommand,
        showConnectionsCommand
    );

    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'dctm.showConnections';
    statusBarItem.text = '$(database) Documentum: Disconnected';
    statusBarItem.tooltip = 'Click to manage Documentum connections';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    context.subscriptions.push(connectionManager.onDidChangeSelection(connection => {
        if (connection) {
            statusBarItem.text = `$(database) Documentum: ${connection.name} (${connection.username})`;
            statusBarItem.backgroundColor = undefined;
        } else {
            statusBarItem.text = '$(database) Documentum: Disconnected';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
    }));

    registerConnectionsView(context, connectionManager);
    const workspaces = registerConnectionWorkspace(context, connectionManager, apiExecutor);
    registerObjectCommands(context, connectionManager, workspaces);
    registerConnectionsPanel(context, connectionManager);
    registerDqlSemanticTokens(context, connectionManager);

    const apiReference = registerApiMethodReference(context);

    registerNotebook(context, connectionManager, dqlExecutor, apiExecutor, workspaces, apiReference);
}

export async function deactivate() {
    if (connectionManager) {
        await connectionManager.disconnectAll();
    }
}
