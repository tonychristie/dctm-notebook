import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { DqlExecutor } from './dqlExecutor';
import { registerConnectionsView } from './connectionsView';
import { ApiExecutor } from './apiExecutor';
import { registerConnectionsPanel } from './connectionsPanel';
import { registerDqlSemanticTokens } from './dqlSemanticTokens';
import { registerDqlCompletion } from './dqlCompletion';
import { registerApiMethodReference } from './apiMethodReference';
import { registerNotebook } from './notebook';
import { registerConnectionWorkspace } from './workspace/connectionWorkspace';
import { registerObjectCommands } from './workspace/objectCommands';
import { registerDocumentConnections } from './documentConnections';
import { registerExecuteDql } from './executeDql';
import { registerConnectionStatusBar } from './connectionStatusBar';
import { registerDqlConnectionLens } from './dqlConnectionLens';

let connectionManager: ConnectionManager;
let dqlExecutor: DqlExecutor;
let apiExecutor: ApiExecutor;

export function activate(context: vscode.ExtensionContext) {
    connectionManager = new ConnectionManager();
    dqlExecutor = new DqlExecutor();
    apiExecutor = new ApiExecutor();
    context.subscriptions.push(connectionManager);

    const documents = registerDocumentConnections(context, connectionManager);
    registerConnectionsView(context, connectionManager);
    const workspaces = registerConnectionWorkspace(context, connectionManager, apiExecutor, dqlExecutor, documents);
    registerObjectCommands(context, connectionManager, workspaces);
    registerConnectionsPanel(context, connectionManager);
    registerDqlSemanticTokens(context, connectionManager, documents);
    registerDqlCompletion(context, connectionManager, documents);
    registerExecuteDql(context, connectionManager, documents, dqlExecutor, workspaces);
    registerConnectionStatusBar(context, connectionManager, documents);
    registerDqlConnectionLens(context, connectionManager, documents);

    context.subscriptions.push(
        vscode.commands.registerCommand('dctm.connect', async () => {
            const connection = await connectionManager.connect();
            if (connection) {
                await workspaces.show(connection.name);
            }
        }),
        vscode.commands.registerCommand('dctm.disconnect', async () => {
            await connectionManager.disconnect();
        }),
        vscode.commands.registerCommand('dctm.showConnections', async () => {
            await connectionManager.showConnections();
        })
    );

    const apiReference = registerApiMethodReference(context);

    registerNotebook(context, connectionManager, dqlExecutor, apiExecutor, workspaces, apiReference);
}

export async function deactivate() {
    if (connectionManager) {
        await connectionManager.disconnectAll();
    }
}
