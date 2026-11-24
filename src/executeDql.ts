import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import type { DocumentConnections } from './documentConnections';
import { DqlExecutor } from './dqlExecutor';
import { RepositoryConnection } from './repositoryConnection';
import { ResultsPanel } from './resultsPanel';

export type DqlConnections = Pick<ConnectionManager, 'getConnections' | 'pickConnection' | 'connect'>;
export type DqlDocumentLinks = Pick<DocumentConnections, 'connectionName' | 'link'>;

export async function documentConnection(
    connectionManager: DqlConnections,
    documents: DqlDocumentLinks,
    document: vscode.TextDocument
): Promise<RepositoryConnection | undefined> {
    const linked = documents.connectionName(document);
    if (linked && connectionManager.getConnections().some(c => c.name === linked)) {
        return connectionManager.connect(linked);
    }

    const picked = await connectionManager.pickConnection();
    if (picked) {
        await documents.link(document, picked.name);
    }
    return picked;
}

export function registerExecuteDql(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    documents: DocumentConnections,
    dqlExecutor: DqlExecutor
): void {
    context.subscriptions.push(vscode.commands.registerCommand('dctm.executeDql', async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) {
            vscode.window.showErrorMessage('No active editor');
            return;
        }

        const selection = editor.selection;
        const query = selection.isEmpty
            ? editor.document.getText()
            : editor.document.getText(selection);

        if (!query.trim()) {
            vscode.window.showWarningMessage('No DQL query to execute');
            return;
        }

        const connection = await documentConnection(connectionManager, documents, editor.document);
        if (!connection) {
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
    }));
}
