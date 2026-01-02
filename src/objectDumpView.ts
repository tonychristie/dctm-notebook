import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { ObjectDumpPanel } from './objectDumpPanel';

/**
 * WebviewViewProvider for the Object Dump sidebar panel.
 * Provides a simple interface to enter an object ID and view its dump.
 */
export class ObjectDumpViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'documentumObjectDump';

    private view?: vscode.WebviewView;
    private readonly extensionUri: vscode.Uri;
    private readonly connectionManager: ConnectionManager;

    constructor(extensionUri: vscode.Uri, connectionManager: ConnectionManager) {
        this.extensionUri = extensionUri;
        this.connectionManager = connectionManager;
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken
    ): void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.extensionUri]
        };

        webviewView.webview.html = this.getHtmlContent();

        // Handle messages from the webview
        webviewView.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'dumpObject':
                    await this.dumpObject(message.objectId);
                    break;
            }
        });

        // Update connection status when view becomes visible
        webviewView.onDidChangeVisibility(() => {
            if (webviewView.visible) {
                this.updateConnectionStatus();
            }
        });

        // Listen for connection changes
        this.connectionManager.onConnectionChange(() => {
            this.updateConnectionStatus();
        });
    }

    /**
     * Dump an object by ID
     */
    private async dumpObject(objectId: string): Promise<void> {
        const trimmedId = objectId.trim();
        if (!trimmedId) {
            vscode.window.showWarningMessage('Please enter an object ID');
            return;
        }

        // Validate it looks like an object ID (16 hex chars)
        if (!/^[0-9a-f]{16}$/i.test(trimmedId)) {
            vscode.window.showWarningMessage('Invalid object ID format. Expected 16 hexadecimal characters.');
            return;
        }

        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            vscode.window.showErrorMessage('Not connected to Documentum');
            return;
        }

        try {
            await ObjectDumpPanel.createOrShow(
                this.extensionUri,
                this.connectionManager,
                trimmedId
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            vscode.window.showErrorMessage(`Failed to dump object: ${message}`);
        }
    }

    /**
     * Update the connection status display in the webview
     */
    private updateConnectionStatus(): void {
        if (this.view) {
            const connection = this.connectionManager.getActiveConnection();
            this.view.webview.postMessage({
                command: 'updateConnection',
                connected: !!connection,
                repositoryName: connection?.config.repository || ''
            });
        }
    }

    /**
     * Generate HTML content for the webview
     */
    private getHtmlContent(): string {
        const connection = this.connectionManager.getActiveConnection();
        const isConnected = !!connection;

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    font-size: var(--vscode-font-size);
                    padding: 12px;
                    color: var(--vscode-foreground);
                }
                .section {
                    margin-bottom: 16px;
                }
                .section-title {
                    font-size: 11px;
                    font-weight: 600;
                    text-transform: uppercase;
                    color: var(--vscode-descriptionForeground);
                    margin-bottom: 8px;
                }
                .input-group {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }
                input[type="text"] {
                    width: 100%;
                    padding: 6px 8px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 2px;
                    font-family: var(--vscode-editor-font-family);
                    font-size: 12px;
                    box-sizing: border-box;
                }
                input[type="text"]:focus {
                    outline: 1px solid var(--vscode-focusBorder);
                    border-color: var(--vscode-focusBorder);
                }
                input[type="text"]::placeholder {
                    color: var(--vscode-input-placeholderForeground);
                }
                button {
                    width: 100%;
                    padding: 6px 14px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 2px;
                    cursor: pointer;
                    font-size: 13px;
                }
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                button:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }
                .status {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 8px;
                }
                .status.connected {
                    color: var(--vscode-testing-iconPassed);
                }
                .status.disconnected {
                    color: var(--vscode-testing-iconFailed);
                }
                .hint {
                    font-size: 11px;
                    color: var(--vscode-descriptionForeground);
                    margin-top: 4px;
                }
            </style>
        </head>
        <body>
            <div class="section">
                <div class="section-title">Object Dump</div>
                <div class="input-group">
                    <input
                        type="text"
                        id="objectId"
                        placeholder="Enter object ID (16 hex chars)"
                        maxlength="16"
                        ${!isConnected ? 'disabled' : ''}
                    >
                    <button id="dumpBtn" ${!isConnected ? 'disabled' : ''}>Dump Object</button>
                </div>
                <div class="hint">e.g., 0900000180000102</div>
                <div id="status" class="status ${isConnected ? 'connected' : 'disconnected'}">
                    ${isConnected ? 'Connected to ' + connection?.config.repository : 'Not connected'}
                </div>
            </div>

            <script>
                const vscode = acquireVsCodeApi();
                const objectIdInput = document.getElementById('objectId');
                const dumpBtn = document.getElementById('dumpBtn');
                const statusEl = document.getElementById('status');

                // Handle dump button click
                dumpBtn.addEventListener('click', () => {
                    const objectId = objectIdInput.value.trim();
                    if (objectId) {
                        vscode.postMessage({ command: 'dumpObject', objectId: objectId });
                    }
                });

                // Handle Enter key in input
                objectIdInput.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        dumpBtn.click();
                    }
                });

                // Handle messages from extension
                window.addEventListener('message', (event) => {
                    const message = event.data;
                    switch (message.command) {
                        case 'updateConnection':
                            objectIdInput.disabled = !message.connected;
                            dumpBtn.disabled = !message.connected;
                            statusEl.className = 'status ' + (message.connected ? 'connected' : 'disconnected');
                            statusEl.textContent = message.connected
                                ? 'Connected to ' + message.repositoryName
                                : 'Not connected';
                            break;
                    }
                });
            </script>
        </body>
        </html>`;
    }
}

/**
 * Register the Object Dump view
 */
export function registerObjectDumpView(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): ObjectDumpViewProvider {
    const provider = new ObjectDumpViewProvider(context.extensionUri, connectionManager);

    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            ObjectDumpViewProvider.viewType,
            provider
        )
    );

    return provider;
}
