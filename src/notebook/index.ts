import * as vscode from 'vscode';
import { DctmNotebookSerializer } from './notebookSerializer';
import { DctmNotebookController } from './notebookController';
import { registerNotebookCompletions } from './notebookCompletionProvider';
import { ConnectionManager, describeConnection } from '../connectionManager';
import { DqlExecutor } from '../dqlExecutor';
import { ApiExecutor } from '../apiExecutor';
import { ApiMethodReference } from '../apiMethodReference';
import { ObjectDumpPanel } from '../objectDumpPanel';
import { extractObjectId } from '../apiPanel';
import { isObjectId } from '../htmlUtils';
import { exportToExcel, exportToJson } from './exporter';
import { getOutputFormat, nextOutputFormat } from './commandParsing';
import { boundConnectionName, resolveNotebookConnection } from './notebookConnection';

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
                const { connection, error } = await resolveNotebookConnection(
                    connectionManager,
                    e.editor.notebook.metadata
                );
                if (!connection) {
                    vscode.window.showErrorMessage(error);
                    return;
                }
                await vscode.commands.executeCommand('dctm.dumpObject', message.objectId, connection.name);
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

    // Register notebook connection status bar
    registerNotebookStatusBar(context, connectionManager);

    // Register enhanced dmAPI completion provider if reference is available
    if (apiReference) {
        registerNotebookCompletions(context, apiReference);
    }
}

/**
 * Register status bar item for notebook connection status
 */
function registerNotebookStatusBar(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): void {
    // Create a status bar item for notebook connection
    const notebookStatusBar = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        99 // Just after the main connection status bar (100)
    );
    notebookStatusBar.command = 'dctm.notebook.bindConnection';
    context.subscriptions.push(notebookStatusBar);

    const updateContextKeys = (isNotebookBound: boolean, connectionName?: string) => {
        vscode.commands.executeCommand('setContext', 'dctm.notebookBound', isNotebookBound);
        vscode.commands.executeCommand('setContext', 'dctm.notebookConnectionName', connectionName || '');
    };

    const updateNotebookStatus = () => {
        const editor = vscode.window.activeNotebookEditor;

        if (!editor || editor.notebook.notebookType !== 'dctmbook') {
            notebookStatusBar.hide();
            updateContextKeys(false);
            return;
        }

        const boundName = boundConnectionName(editor.notebook.metadata);
        const boundConnection = boundName ? connectionManager.getOpenConnection(boundName) : undefined;
        const selected = connectionManager.getSelectedConnection();

        if (boundConnection) {
            notebookStatusBar.text = `$(notebook) ${boundConnection.name} (${boundConnection.username})`;
            notebookStatusBar.tooltip = `Notebook bound to ${boundConnection.name} as ${boundConnection.username}. Click to change the binding.`;
            notebookStatusBar.backgroundColor = undefined;
        } else if (boundName) {
            notebookStatusBar.text = `$(notebook) ${boundName} (disconnected)`;
            notebookStatusBar.tooltip = `Notebook bound to ${boundName}, which is not connected. Running a cell connects it. Click to change the binding.`;
            notebookStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        } else if (selected) {
            notebookStatusBar.text = `$(notebook) Using global: ${selected.name}`;
            notebookStatusBar.tooltip = 'Notebook using the selected connection. Click to bind to a specific connection.';
            notebookStatusBar.backgroundColor = undefined;
        } else {
            notebookStatusBar.text = '$(notebook) No connection';
            notebookStatusBar.tooltip = 'Notebook has no connection. Click to bind to a connection.';
            notebookStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }

        updateContextKeys(!!boundName, boundName);
        notebookStatusBar.show();
    };

    context.subscriptions.push(
        vscode.window.onDidChangeActiveNotebookEditor(() => updateNotebookStatus()),
        vscode.workspace.onDidChangeNotebookDocument(e => {
            if (e.metadata && e.notebook === vscode.window.activeNotebookEditor?.notebook) {
                updateNotebookStatus();
            }
        }),
        connectionManager.onDidChangeSelection(() => updateNotebookStatus()),
        connectionManager.onDidChangeOpenConnections(() => updateNotebookStatus())
    );

    updateNotebookStatus();
}

/**
 * Register notebook-specific commands
 */
function registerNotebookCommands(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
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

    // Command to dump an object by ID (opens Object Dump panel)
    const dumpObject = vscode.commands.registerCommand(
        'dctm.dumpObject',
        async (arg?: unknown, connectionName?: string) => {
            let objectId = extractObjectId(arg);

            // If no objectId provided, prompt for one
            if (!objectId) {
                objectId = await vscode.window.showInputBox({
                    prompt: 'Enter Object ID',
                    placeHolder: '0900000000000001',
                    validateInput: (value) => {
                        if (!isObjectId(value)) {
                            return 'Object ID must be a 16-character hex string';
                        }
                        return null;
                    }
                });
            }

            if (!objectId) {
                return;
            }

            const connection = connectionName
                ? connectionManager.getOpenConnection(connectionName)
                : connectionManager.getSelectedConnection();
            if (!connection) {
                vscode.window.showErrorMessage('Not connected to Documentum. Use "Documentum: Connect" first.');
                return;
            }

            try {
                await ObjectDumpPanel.createOrShow(context.extensionUri, connectionManager, connection.name, objectId);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to dump object: ${message}`);
            }
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

            const connections = connectionManager.getConnections();
            if (connections.length === 0) {
                vscode.window.showWarningMessage(
                    'No connections configured. Add connections in settings first.'
                );
                return;
            }

            // Show picker with available connections
            const currentBinding = editor.notebook.metadata?.connection as string | undefined;
            const items = connections.map(c => ({
                label: c.name === currentBinding ? `$(check) ${c.name}` : c.name,
                description: describeConnection(c),
                detail: c.repository,
                connectionName: c.name
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: currentBinding
                    ? `Currently bound to: ${currentBinding}`
                    : 'Select a connection to bind to this notebook'
            });

            if (!selected) {
                return;
            }

            // Update notebook metadata
            const edit = new vscode.WorkspaceEdit();
            const newMetadata = {
                ...editor.notebook.metadata,
                connection: selected.connectionName
            };
            edit.set(editor.notebook.uri, [
                vscode.NotebookEdit.updateNotebookMetadata(newMetadata)
            ]);

            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage(`Notebook bound to "${selected.connectionName}".`);
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

            const currentBinding = editor.notebook.metadata?.connection as string | undefined;
            if (!currentBinding) {
                vscode.window.showInformationMessage('Notebook is not bound to any connection');
                return;
            }

            // Remove the connection binding from metadata
            const edit = new vscode.WorkspaceEdit();
            const newMetadata = { ...editor.notebook.metadata };
            delete newMetadata.connection;
            edit.set(editor.notebook.uri, [
                vscode.NotebookEdit.updateNotebookMetadata(newMetadata)
            ]);

            await vscode.workspace.applyEdit(edit);

            vscode.window.showInformationMessage(
                `Notebook unbound from "${currentBinding}". Will use global connection.`
            );
        }
    );

    context.subscriptions.push(
        insertDqlCell,
        insertApiCell,
        insertMarkdownCell,
        toggleOutputFormat,
        dumpObject,
        bindConnection,
        unbindConnection
    );
}
