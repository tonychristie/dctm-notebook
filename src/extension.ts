import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { DqlExecutor } from './dqlExecutor';
import { ResultsPanel } from './resultsPanel';
import { registerObjectBrowser } from './objectBrowser';
import { ApiExecutor } from './apiExecutor';
import { registerApiPanel } from './apiPanel';
import { TypeCache } from './typeCache';
import { registerTypeBrowser } from './typeBrowser';
import { UserCache } from './userCache';
import { registerUserBrowser } from './userBrowser';
import { GroupCache } from './groupCache';
import { registerGroupBrowser } from './groupBrowser';
import { registerDqlSemanticTokens } from './dqlSemanticTokens';
import { registerApiMethodReference } from './apiMethodReference';
import { registerNotebook } from './notebook';
import { registerObjectDumpView } from './objectDumpView';

let connectionManager: ConnectionManager;
let dqlExecutor: DqlExecutor;
let apiExecutor: ApiExecutor;
let typeCache: TypeCache;
let userCache: UserCache;
let groupCache: GroupCache;

export function activate(context: vscode.ExtensionContext) {
    // Initialize managers
    connectionManager = new ConnectionManager(context);
    dqlExecutor = new DqlExecutor(connectionManager);
    apiExecutor = new ApiExecutor(connectionManager);
    typeCache = new TypeCache(connectionManager);
    userCache = new UserCache(connectionManager);
    groupCache = new GroupCache(connectionManager);

    // Register commands
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

        try {
            const results = await dqlExecutor.execute(query);
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

    // Status bar item for connection status
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.command = 'dctm.showConnections';
    statusBarItem.text = '$(database) Documentum: Disconnected';
    statusBarItem.tooltip = 'Click to manage Documentum connections';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);

    // Update status bar when connection changes
    connectionManager.onConnectionChange((connected, name, username) => {
        if (connected) {
            const displayText = username ? `${name} (${username})` : name;
            statusBarItem.text = `$(database) Documentum: ${displayText}`;
            statusBarItem.backgroundColor = undefined;
        } else {
            statusBarItem.text = '$(database) Documentum: Disconnected';
            statusBarItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');
        }
    });

    // Register Object Browser tree view
    registerObjectBrowser(context, connectionManager);

    // Register API Panel and related commands
    registerApiPanel(context, apiExecutor, connectionManager);

    // Register Type Browser and semantic tokens
    registerTypeBrowser(context, typeCache, connectionManager);
    registerDqlSemanticTokens(context, typeCache);

    // Register User Browser
    registerUserBrowser(context, userCache, connectionManager);

    // Register Group Browser
    registerGroupBrowser(context, groupCache, connectionManager);

    // Register API method reference (autocomplete and hover for dmAPI methods)
    const apiReference = registerApiMethodReference(context);

    // Register notebook support for .dctmbook files
    registerNotebook(context, connectionManager, dqlExecutor, apiExecutor, apiReference);

    // Register Object Dump sidebar view
    registerObjectDumpView(context, connectionManager);

    // Auto-refresh caches on connection
    connectionManager.onConnectionChange(async (connected) => {
        if (connected) {
            // Refresh all caches in parallel
            await Promise.allSettled([
                typeCache.refresh(),
                userCache.refresh(),
                groupCache.refresh()
            ]);
        } else {
            typeCache.clear();
            userCache.clear();
            groupCache.clear();
        }
    });
}

export async function deactivate() {
    if (connectionManager) {
        // Disconnect all notebook sessions first
        await connectionManager.disconnectAllNotebooks();
        // Then disconnect the global connection
        await connectionManager.disconnect();
    }
}
