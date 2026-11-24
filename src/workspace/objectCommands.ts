import * as vscode from 'vscode';
import { ConnectionManager } from '../connectionManager';
import { RepositoryConnection } from '../repositoryConnection';
import type { ConnectionWorkspaces } from './connectionWorkspace';

function itemField(arg: unknown, field: 'objectId' | 'connectionName'): string | undefined {
    if (!arg || typeof arg !== 'object') {
        return undefined;
    }
    const value = (arg as Record<string, unknown>)[field];
    return typeof value === 'string' ? value : undefined;
}

export function extractObjectId(arg: unknown): string | undefined {
    return itemField(arg, 'objectId');
}

export function extractConnectionName(arg: unknown): string | undefined {
    return itemField(arg, 'connectionName');
}

export function registerObjectCommands(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    workspaces: ConnectionWorkspaces
): void {
    const connectionFor = (arg: unknown): RepositoryConnection | undefined => {
        const name = extractConnectionName(arg);
        return name ? connectionManager.getOpenConnection(name) : connectionManager.getSelectedConnection();
    };

    const executeApiOnObjectCommand = vscode.commands.registerCommand(
        'dctm.executeApiOnObject',
        async (arg?: unknown) => {
            const connection = await connectionManager.connect(extractConnectionName(arg));
            if (connection) {
                workspaces.showApi(connection.name, extractObjectId(arg));
            }
        }
    );
    context.subscriptions.push(executeApiOnObjectCommand);

    const checkoutCommand = vscode.commands.registerCommand(
        'dctm.checkout',
        async (arg?: unknown) => {
            const objectId = extractObjectId(arg);
            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionFor(arg);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            try {
                const result = await connection.bridge.checkout(connection.sessionId, objectId);
                const objectInfo = result as { objectId?: string };
                vscode.window.showInformationMessage(
                    `Checked out: ${objectInfo.objectId || objectId}`
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Checkout failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    context.subscriptions.push(checkoutCommand);

    const checkinCommand = vscode.commands.registerCommand(
        'dctm.checkin',
        async (arg?: unknown) => {
            const objectId = extractObjectId(arg);
            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionFor(arg);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            const versionLabel = await vscode.window.showInputBox({
                prompt: 'Enter version label',
                placeHolder: 'CURRENT',
                value: 'CURRENT'
            });

            if (versionLabel === undefined) {
                return; // Cancelled
            }

            try {
                const result = await connection.bridge.checkin(connection.sessionId, objectId, versionLabel);
                const objectInfo = result as { objectId?: string };
                vscode.window.showInformationMessage(
                    `Checked in: ${objectInfo.objectId || objectId}`
                );
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Checkin failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    context.subscriptions.push(checkinCommand);

    const cancelCheckoutCommand = vscode.commands.registerCommand(
        'dctm.cancelCheckout',
        async (arg?: unknown) => {
            const objectId = extractObjectId(arg);
            if (!objectId) {
                vscode.window.showErrorMessage('No object selected');
                return;
            }

            const connection = connectionFor(arg);
            if (!connection) {
                vscode.window.showErrorMessage('No active connection');
                return;
            }

            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to cancel checkout? Unsaved changes will be lost.',
                'Yes',
                'No'
            );

            if (confirm !== 'Yes') {
                return;
            }

            try {
                await connection.bridge.cancelCheckout(connection.sessionId, objectId);
                vscode.window.showInformationMessage('Checkout cancelled');
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Cancel checkout failed: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    );
    context.subscriptions.push(cancelCheckoutCommand);
}
