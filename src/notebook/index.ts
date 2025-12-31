import * as vscode from 'vscode';
import { DctmNotebookSerializer } from './notebookSerializer';
import { DctmNotebookController } from './notebookController';
import { registerNotebookCompletions } from './notebookCompletionProvider';
import { ConnectionManager } from '../connectionManager';
import { DqlExecutor } from '../dqlExecutor';
import { ApiExecutor } from '../apiExecutor';
import { ApiMethodReference } from '../apiMethodReference';

export { DctmNotebookSerializer } from './notebookSerializer';
export { DctmNotebookController } from './notebookController';
export { NotebookApiCompletionProvider, registerNotebookCompletions } from './notebookCompletionProvider';

/**
 * Register the Documentum notebook support
 *
 * This sets up:
 * - NotebookSerializer for .dctmbook files
 * - NotebookController for cell execution
 * - Status bar item for notebook connection
 */
export function registerNotebook(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    dqlExecutor: DqlExecutor,
    apiExecutor: ApiExecutor,
    apiReference?: ApiMethodReference
): void {
    // Register the notebook serializer
    const serializer = new DctmNotebookSerializer();
    context.subscriptions.push(
        vscode.workspace.registerNotebookSerializer('dctmbook', serializer, {
            transientOutputs: false,
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

    // Register notebook-specific commands
    registerNotebookCommands(context, connectionManager);

    // Register enhanced dmAPI completion provider if reference is available
    if (apiReference) {
        registerNotebookCompletions(context, apiReference);
    }

    console.log('Documentum notebook support registered');
}

/**
 * Register notebook-specific commands
 */
function registerNotebookCommands(
    context: vscode.ExtensionContext,
    _connectionManager: ConnectionManager
): void {
    // Command to insert a new DQL cell
    const insertDqlCell = vscode.commands.registerCommand(
        'dctm.notebook.insertDqlCell',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                return;
            }

            const cell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                '-- Enter your DQL query here\n',
                'dql'
            );

            const edit = new vscode.WorkspaceEdit();
            const cellIndex = editor.selection.end;
            edit.set(editor.notebook.uri, [
                vscode.NotebookEdit.insertCells(cellIndex, [cell])
            ]);

            await vscode.workspace.applyEdit(edit);
        }
    );

    // Command to insert a new API cell
    const insertApiCell = vscode.commands.registerCommand(
        'dctm.notebook.insertApiCell',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                return;
            }

            const cell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                '-- Enter your API command here\n-- Example: dmAPIGet("getdocbaseconfig,session")\n',
                'dmapi'
            );

            const edit = new vscode.WorkspaceEdit();
            const cellIndex = editor.selection.end;
            edit.set(editor.notebook.uri, [
                vscode.NotebookEdit.insertCells(cellIndex, [cell])
            ]);

            await vscode.workspace.applyEdit(edit);
        }
    );

    // Command to insert a markdown cell
    const insertMarkdownCell = vscode.commands.registerCommand(
        'dctm.notebook.insertMarkdownCell',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                return;
            }

            const cell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Markup,
                '# Documentation\n\nAdd your notes here...',
                'markdown'
            );

            const edit = new vscode.WorkspaceEdit();
            const cellIndex = editor.selection.end;
            edit.set(editor.notebook.uri, [
                vscode.NotebookEdit.insertCells(cellIndex, [cell])
            ]);

            await vscode.workspace.applyEdit(edit);
        }
    );

    context.subscriptions.push(
        insertDqlCell,
        insertApiCell,
        insertMarkdownCell
    );
}
