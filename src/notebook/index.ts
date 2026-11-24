import * as vscode from 'vscode';
import { DctmNotebookSerializer } from './notebookSerializer';
import { DctmNotebookController } from './notebookController';
import { registerNotebookCompletions } from './notebookCompletionProvider';
import { ConnectionManager } from '../connectionManager';
import { DqlExecutor } from '../dqlExecutor';
import { ApiExecutor } from '../apiExecutor';
import { ApiMethodReference } from '../apiMethodReference';
import type { ConnectionWorkspaces } from '../workspace/connectionWorkspace';
import { exportToExcel, exportToJson } from './exporter';
import { getOutputFormat, nextOutputFormat } from './commandParsing';
import { bindNotebook, boundConnectionName, pickBinding, resolveNotebookConnection } from './notebookConnection';

export { DctmNotebookSerializer } from './notebookSerializer';
export { DctmNotebookController } from './notebookController';
export { NotebookApiCompletionProvider, registerNotebookCompletions } from './notebookCompletionProvider';

export type NotebookDumpWorkspaces = Pick<ConnectionWorkspaces, 'showDump'>;

export async function dumpFromNotebook(
    connectionManager: ConnectionManager,
    workspaces: NotebookDumpWorkspaces,
    notebook: vscode.NotebookDocument,
    objectId: string
): Promise<void> {
    const { connection, error } = await resolveNotebookConnection(connectionManager, notebook);
    if (!connection) {
        vscode.window.showErrorMessage(error);
        return;
    }
    await workspaces.showDump(connection.name, { kind: 'object', objectId });
}

/**
 * Register the Documentum notebook support
 *
 * This sets up:
 * - NotebookSerializer for .dctmbook files
 * - NotebookController for cell execution
 */
export function registerNotebook(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    dqlExecutor: DqlExecutor,
    apiExecutor: ApiExecutor,
    workspaces: NotebookDumpWorkspaces,
    apiReference?: ApiMethodReference
): void {
    // Register the notebook serializer
    const serializer = new DctmNotebookSerializer();
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('dctmbook', serializer, {
            transientOutputs: true,
            transientCellMetadata: {
                inputCollapsed: true,
                outputCollapsed: true
            }
        })
    );

    // Register the notebook controller
    const controller = new DctmNotebookController(
        connectionManager,
        dqlExecutor,
        apiExecutor
    );
    context.subscriptions.push({
        dispose: () => controller.dispose()
    });

    // Set up renderer messaging for object ID click handling and export
    const rendererMessaging = vscode.notebooks.createRendererMessaging('dctm-result-renderer');
    const messageDisposable = rendererMessaging.onDidReceiveMessage(async (e) => {
        const message = e.message as {
            command: string;
            objectId?: string;
            data?: {
                columns: string[];
                rows: Record<string, unknown>[];
                format: 'excel' | 'json';
            };
        };

        if (message.command === 'dumpObject' && message.objectId) {
            try {
                await dumpFromNotebook(connectionManager, workspaces, e.editor.notebook, message.objectId);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Connection failed: ${errorMsg}`);
            }
        } else if (message.command === 'exportData' && message.data) {
            try {
                if (message.data.format === 'excel') {
                    await exportToExcel(message.data.columns, message.data.rows);
                } else if (message.data.format === 'json') {
                    await exportToJson(message.data.columns, message.data.rows);
                }
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Export failed: ${errorMsg}`);
            }
        }
    });
    context.subscriptions.push(messageDisposable);

    // Register notebook-specific commands
    registerNotebookCommands(context, connectionManager);

    // Register enhanced dmAPI completion provider if reference is available
    if (apiReference) {
        registerNotebookCompletions(context, apiReference);
    }
}

async function insertCell(kind: vscode.NotebookCellKind, text: string, language: string): Promise<void> {
    const editor = vscode.window.activeNotebookEditor;
    if (!editor || editor.notebook.notebookType !== 'dctmbook') {
        return;
    }

    const edit = new vscode.WorkspaceEdit();
    edit.set(editor.notebook.uri, [
        vscode.NotebookEdit.insertCells(editor.selection.end, [new vscode.NotebookCellData(kind, text, language)])
    ]);
    await vscode.workspace.applyEdit(edit);
}

/**
 * Register notebook-specific commands
 */
function registerNotebookCommands(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): void {
    const insertDqlCell = vscode.commands.registerCommand('dctm.notebook.insertDqlCell', () =>
        insertCell(vscode.NotebookCellKind.Code, '-- Enter your DQL query here\n', 'dql')
    );

    const insertApiCell = vscode.commands.registerCommand('dctm.notebook.insertApiCell', () =>
        insertCell(
            vscode.NotebookCellKind.Code,
            '-- Enter your API command here\n-- Example: dmAPIGet("dump,session,docbaseconfig")\n',
            'dmapi'
        )
    );

    const insertMarkdownCell = vscode.commands.registerCommand('dctm.notebook.insertMarkdownCell', () =>
        insertCell(vscode.NotebookCellKind.Markup, '# Documentation\n\nAdd your notes here...', 'markdown')
    );

    // Command to toggle output format between HTML and JSON
    const toggleOutputFormat = vscode.commands.registerCommand(
        'dctm.notebook.toggleOutputFormat',
        async (cell?: vscode.NotebookCell) => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                return;
            }

            // Get the cell - either passed as argument or from current selection
            let targetCell = cell;
            if (!targetCell) {
                const selection = editor.selection;
                if (selection && selection.start < editor.notebook.cellCount) {
                    targetCell = editor.notebook.cellAt(selection.start);
                }
            }

            if (!targetCell || targetCell.kind !== vscode.NotebookCellKind.Code) {
                return;
            }

            const newFormat = nextOutputFormat(getOutputFormat(targetCell.metadata));

            // Update cell metadata
            const edit = new vscode.WorkspaceEdit();
            const newMetadata = { ...targetCell.metadata, outputFormat: newFormat };
            edit.set(editor.notebook.uri, [
                vscode.NotebookEdit.updateCellMetadata(targetCell.index, newMetadata)
            ]);

            await vscode.workspace.applyEdit(edit);

            // Show notification
            vscode.window.showInformationMessage(
                `Output format set to ${newFormat.toUpperCase()}. Re-run cell to apply.`
            );
        }
    );

    // Command to bind notebook to a specific connection
    const bindConnection = vscode.commands.registerCommand(
        'dctm.notebook.bindConnection',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                vscode.window.showWarningMessage('No Documentum notebook is active');
                return;
            }

            const selected = await pickBinding(
                connectionManager.getConnections(),
                boundConnectionName(editor.notebook.metadata),
                'notebook'
            );
            if (!selected) {
                return;
            }

            await bindNotebook(editor.notebook, selected);

            vscode.window.showInformationMessage(`Notebook bound to "${selected}".`);
        }
    );

    // Command to unbind notebook from its connection
    const unbindConnection = vscode.commands.registerCommand(
        'dctm.notebook.unbindConnection',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                vscode.window.showWarningMessage('No Documentum notebook is active');
                return;
            }

            const currentBinding = boundConnectionName(editor.notebook.metadata);
            if (!currentBinding) {
                vscode.window.showInformationMessage('Notebook is not bound to any connection');
                return;
            }

            const edit = new vscode.WorkspaceEdit();
            // The extension host merges metadata updates, so a deleted key keeps its old value.
            const newMetadata = { ...editor.notebook.metadata, connection: null };
            edit.set(editor.notebook.uri, [
                vscode.NotebookEdit.updateNotebookMetadata(newMetadata)
            ]);

            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage(`Notebook unbound from "${currentBinding}".`);
        }
    );

    context.subscriptions.push(
        insertDqlCell,
        insertApiCell,
        insertMarkdownCell,
        toggleOutputFormat,
        bindConnection,
        unbindConnection
    );
}
