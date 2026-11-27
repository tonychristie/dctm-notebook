import * as vscode from 'vscode';
import { ConnectionManager, DocumentumConnection, openNewConnectionForm } from '../connectionManager';
import { describeConnection } from '../connectionForm';
import { RepositoryConnection } from '../repositoryConnection';

export type NotebookConnectionResult =
    | { connection: RepositoryConnection; error?: undefined }
    | { connection?: undefined; error: string };

export const NOT_BOUND_MESSAGE = 'Notebook is not bound to a connection.';

export function boundConnectionName(metadata: { [key: string]: unknown } | undefined): string | undefined {
    const name = metadata?.connection;
    return typeof name === 'string' && name ? name : undefined;
}

export async function bindNotebook(notebook: vscode.NotebookDocument, connectionName: string): Promise<boolean> {
    const edit = new vscode.WorkspaceEdit();
    edit.set(notebook.uri, [
        vscode.NotebookEdit.updateNotebookMetadata({ ...notebook.metadata, connection: connectionName })
    ]);
    return vscode.workspace.applyEdit(edit);
}

export type OpenNotebookAction = 'open' | 'bind' | 'ask';

export function openNotebookAction(boundName: string | undefined, connectionName: string): OpenNotebookAction {
    if (!boundName) {
        return 'bind';
    }
    return boundName === connectionName ? 'open' : 'ask';
}

export type BindingTarget = 'notebook' | 'file';

export async function pickBinding(
    connections: DocumentumConnection[],
    current: string | undefined,
    target: BindingTarget
): Promise<string | undefined> {
    if (connections.length === 0) {
        const action = await vscode.window.showWarningMessage('No connections configured.', 'Manage Connections');
        if (action === 'Manage Connections') {
            void openNewConnectionForm();
        }
        return undefined;
    }

    const items = connections.map(c => ({
        label: c.name === current ? `$(check) ${c.name}` : c.name,
        description: describeConnection(c),
        detail: c.repository,
        connectionName: c.name
    }));

    const placeHolder = target === 'notebook'
        ? (current ? `Currently bound to: ${current}` : 'Select a connection to bind to this notebook')
        : (current ? `Currently linked to: ${current}` : 'Select a connection to link to this file');
    const selected = await vscode.window.showQuickPick(items, { placeHolder });
    return selected?.connectionName;
}

export type BindingPicker = (current: string | undefined) => Promise<string | undefined>;

export async function resolveNotebookConnection(
    connectionManager: Pick<ConnectionManager, 'getConnections' | 'openConnection'>,
    notebook: vscode.NotebookDocument,
    pick: BindingPicker = current => pickBinding(connectionManager.getConnections(), current, 'notebook')
): Promise<NotebookConnectionResult> {
    let boundName = boundConnectionName(notebook.metadata);

    if (!boundName) {
        boundName = await pick(undefined);
        if (!boundName) {
            return { error: NOT_BOUND_MESSAGE };
        }
        await bindNotebook(notebook, boundName);
    }

    if (!connectionManager.getConnections().some(c => c.name === boundName)) {
        return { error: `Connection "${boundName}" not found. Update the notebook binding.` };
    }

    const connection = await connectionManager.openConnection(boundName);
    return connection
        ? { connection }
        : { error: `Notebook is bound to "${boundName}" but not connected.` };
}
