import * as vscode from 'vscode';
import { DctmNotebookSerializer } from './notebookSerializer';
import { DctmNotebookController } from './notebookController';
import { registerNotebookCompletions } from './notebookCompletionProvider';
import { ConnectionManager } from '../connectionManager';
import { DqlExecutor } from '../dqlExecutor';
import { ApiExecutor } from '../apiExecutor';
import { ApiMethodReference } from '../apiMethodReference';
import { ObjectDumpPanel } from '../objectDumpPanel';

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

    // Set up renderer messaging for object ID click handling
    const rendererMessaging = vscode.notebooks.createRendererMessaging('dctm-result-renderer');
    const messageDisposable = rendererMessaging.onDidReceiveMessage(async (e) => {
        const message = e.message as { command: string; objectId?: string };
        if (message.command === 'dumpObject' && message.objectId) {
            const connection = connectionManager.getActiveConnection();
            if (!connection) {
                vscode.window.showErrorMessage('Not connected to Documentum. Use "Documentum: Connect" first.');
                return;
            }
            try {
                await ObjectDumpPanel.createOrShow(context.extensionUri, connectionManager, message.objectId);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to dump object: ${errorMsg}`);
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

    console.log('Documentum notebook support registered');
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
    notebookStatusBar.command = 'dctm.notebook.connectNotebook';
    context.subscriptions.push(notebookStatusBar);

    // Function to update the status bar based on active notebook
    const updateNotebookStatus = () => {
        const editor = vscode.window.activeNotebookEditor;

        // Hide if no notebook is active or it's not a dctmbook
        if (!editor || editor.notebook.notebookType !== 'dctmbook') {
            notebookStatusBar.hide();
            return;
        }

        const notebookUri = editor.notebook.uri.toString();
        const boundConnection = editor.notebook.metadata?.connection as string | undefined;
        const notebookConnection = connectionManager.getNotebookConnection(notebookUri);

        if (notebookConnection) {
            // Notebook has its own active connection
            notebookStatusBar.text = `$(notebook) ${notebookConnection.config.name} (${notebookConnection.username})`;
            notebookStatusBar.tooltip = `Notebook connected to ${notebookConnection.config.name} as ${notebookConnection.username}. Click to manage.`;
            notebookStatusBar.backgroundColor = undefined;
            notebookStatusBar.command = 'dctm.notebook.disconnectNotebook';
        } else if (boundConnection) {
            // Notebook is bound but not connected
            notebookStatusBar.text = `$(notebook) ${boundConnection} (disconnected)`;
            notebookStatusBar.tooltip = `Notebook bound to ${boundConnection} but not connected. Click to connect.`;
            notebookStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            notebookStatusBar.command = 'dctm.notebook.connectNotebook';
        } else {
            // Notebook uses global connection
            const globalConn = connectionManager.getActiveConnection();
            if (globalConn) {
                notebookStatusBar.text = `$(notebook) Using global: ${globalConn.config.name}`;
                notebookStatusBar.tooltip = `Notebook using global connection. Click to bind to a specific connection.`;
                notebookStatusBar.backgroundColor = undefined;
            } else {
                notebookStatusBar.text = `$(notebook) No connection`;
                notebookStatusBar.tooltip = `Notebook has no connection. Click to bind to a connection.`;
                notebookStatusBar.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
            }
            notebookStatusBar.command = 'dctm.notebook.bindConnection';
        }

        notebookStatusBar.show();
    };

    // Update when active editor changes
    context.subscriptions.push(
        vscode.window.onDidChangeActiveNotebookEditor(() => {
            updateNotebookStatus();
        })
    );

    // Clean up notebook connection when notebook is closed
    context.subscriptions.push(
        vscode.workspace.onDidCloseNotebookDocument(async (notebook) => {
            if (notebook.notebookType === 'dctmbook') {
                const notebookUri = notebook.uri.toString();
                if (connectionManager.hasNotebookConnection(notebookUri)) {
                    await connectionManager.disconnectNotebook(notebookUri);
                    console.log(`Disconnected notebook session for ${notebook.uri.fsPath}`);
                }
            }
        })
    );

    // Update when notebook connection changes
    connectionManager.onNotebookConnectionChange(() => {
        updateNotebookStatus();
    });

    // Update when global connection changes
    connectionManager.onConnectionChange(() => {
        updateNotebookStatus();
    });

    // Initial update
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

            // Get current format from metadata, default to 'html'
            const currentFormat = targetCell.metadata?.outputFormat as string || 'html';
            const newFormat = currentFormat === 'html' ? 'json' : 'html';

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
    // Can be called with:
    // - A string objectId (from notebook context menu)
    // - A node data object with objectId property (from tree view context menu)
    // - No argument (prompts for object ID)
    const dumpObject = vscode.commands.registerCommand(
        'dctm.dumpObject',
        async (arg?: string | { objectId?: string }) => {
            let objectId: string | undefined;

            // Extract objectId from argument
            if (typeof arg === 'string') {
                objectId = arg;
            } else if (arg && typeof arg === 'object' && 'objectId' in arg) {
                objectId = arg.objectId;
            }

            // If no objectId provided, prompt for one
            if (!objectId) {
                objectId = await vscode.window.showInputBox({
                    prompt: 'Enter Object ID',
                    placeHolder: '0900000000000001',
                    validateInput: (value) => {
                        if (!/^[0-9a-f]{16}$/i.test(value)) {
                            return 'Object ID must be a 16-character hex string';
                        }
                        return null;
                    }
                });
            }

            if (!objectId) {
                return;
            }

            // Check connection
            const connection = connectionManager.getActiveConnection();
            if (!connection) {
                vscode.window.showErrorMessage('Not connected to Documentum. Use "Documentum: Connect" first.');
                return;
            }

            try {
                await ObjectDumpPanel.createOrShow(context.extensionUri, connectionManager, objectId);
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
                description: c.repository,
                detail: c.docbroker ? `${c.docbroker}:${c.port || 1489}` : 'Bridge connection',
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
            vscode.window.showInformationMessage(
                `Notebook bound to "${selected.connectionName}". Use "Connect Notebook" to establish connection.`
            );
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

            // Disconnect if there's an active notebook connection
            const notebookUri = editor.notebook.uri.toString();
            if (connectionManager.hasNotebookConnection(notebookUri)) {
                await connectionManager.disconnectNotebook(notebookUri);
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

    // Command to connect notebook using its bound connection
    const connectNotebook = vscode.commands.registerCommand(
        'dctm.notebook.connectNotebook',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                vscode.window.showWarningMessage('No Documentum notebook is active');
                return;
            }

            const notebookUri = editor.notebook.uri.toString();
            const boundConnection = editor.notebook.metadata?.connection as string | undefined;

            if (!boundConnection) {
                // No binding - ask if they want to bind first
                const action = await vscode.window.showWarningMessage(
                    'Notebook is not bound to a connection. Bind to a connection first?',
                    'Bind Connection',
                    'Use Global'
                );
                if (action === 'Bind Connection') {
                    await vscode.commands.executeCommand('dctm.notebook.bindConnection');
                }
                return;
            }

            // Check if already connected
            if (connectionManager.hasNotebookConnection(notebookUri)) {
                const conn = connectionManager.getNotebookConnection(notebookUri);
                vscode.window.showInformationMessage(
                    `Already connected to ${conn?.config.name} as ${conn?.username}`
                );
                return;
            }

            // Get the connection config
            const connections = connectionManager.getConnections();
            const connection = connections.find(c => c.name === boundConnection);
            if (!connection) {
                vscode.window.showErrorMessage(
                    `Connection "${boundConnection}" not found. Update the notebook binding.`
                );
                return;
            }

            // Prompt for credentials
            const username = connection.username || await vscode.window.showInputBox({
                prompt: `Enter username for ${connection.name}`,
                placeHolder: 'dmadmin'
            });

            if (!username) {
                return;
            }

            const password = await vscode.window.showInputBox({
                prompt: 'Enter password',
                password: true
            });

            if (!password) {
                return;
            }

            try {
                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `Connecting notebook to ${connection.name}...`,
                    cancellable: false
                }, async () => {
                    await connectionManager.connectNotebook(
                        notebookUri,
                        boundConnection,
                        username,
                        password
                    );
                });

                vscode.window.showInformationMessage(
                    `Notebook connected to ${connection.name} as ${username}`
                );
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Failed to connect notebook: ${message}`);
            }
        }
    );

    // Command to disconnect notebook
    const disconnectNotebook = vscode.commands.registerCommand(
        'dctm.notebook.disconnectNotebook',
        async () => {
            const editor = vscode.window.activeNotebookEditor;
            if (!editor || editor.notebook.notebookType !== 'dctmbook') {
                vscode.window.showWarningMessage('No Documentum notebook is active');
                return;
            }

            const notebookUri = editor.notebook.uri.toString();
            if (!connectionManager.hasNotebookConnection(notebookUri)) {
                vscode.window.showInformationMessage('Notebook is not connected');
                return;
            }

            const conn = connectionManager.getNotebookConnection(notebookUri);
            await connectionManager.disconnectNotebook(notebookUri);
            vscode.window.showInformationMessage(
                `Notebook disconnected from ${conn?.config.name}`
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
        unbindConnection,
        connectNotebook,
        disconnectNotebook
    );
}
