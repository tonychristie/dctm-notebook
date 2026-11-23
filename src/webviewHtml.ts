import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { escapeHtml } from './htmlUtils';

export type WebviewEntry =
    | 'apiPanel'
    | 'connectionWorkspace'
    | 'connectionsPanel'
    | 'objectDumpPanel'
    | 'typeDumpPanel'
    | 'userDumpPanel'
    | 'groupDumpPanel'
    | 'objectDumpView'
    | 'resultsPanel';

export interface WebviewAssets {
    csp: string;
    script: string;
}

function webviewsRoot(extensionUri: vscode.Uri): vscode.Uri {
    return vscode.Uri.joinPath(extensionUri, 'out', 'webviews');
}

export function webviewResourceRoots(extensionUri: vscode.Uri): vscode.Uri[] {
    return [webviewsRoot(extensionUri)];
}

export function webviewAssets(webview: vscode.Webview, extensionUri: vscode.Uri, entry: WebviewEntry): WebviewAssets {
    const nonce = randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewsRoot(extensionUri), `${entry}.js`));
    return {
        csp: `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; font-src ${webview.cspSource}; script-src 'nonce-${nonce}';">`,
        script: `<script nonce="${nonce}" src="${scriptUri}"></script>`
    };
}

export function webviewStylesheet(
    webview: vscode.Webview,
    extensionUri: vscode.Uri,
    name: 'dumpPanel' | 'connectionWorkspace'
): string {
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(webviewsRoot(extensionUri), `${name}.css`));
    return `<link rel="stylesheet" href="${styleUri}">`;
}

export function webviewData(data: unknown): string {
    return `data-webview="${escapeHtml(JSON.stringify(data))}"`;
}
