import * as vscode from 'vscode';
import type { ConnectionManager } from './connectionManager';
import type { DocumentConnections } from './documentConnections';
import { RepositoryConnection } from './repositoryConnection';

export type ConnectionLensSource = Pick<
    ConnectionManager,
    'getOpenConnection' | 'onDidChangeOpenConnections' | 'onDidChangeConnections'
>;
export type ConnectionLensDocuments = Pick<DocumentConnections, 'connectionName' | 'onDidChange'>;

export interface ConnectionLens {
    text: string;
    action: string;
}

export function connectionLens(
    connectionName: string | undefined,
    connection: RepositoryConnection | undefined
): ConnectionLens {
    if (connection) {
        return {
            text: `Connection: ${connection.name} · ${connection.config.repository} as ${connection.username}`,
            action: 'Change'
        };
    }
    if (connectionName) {
        return { text: `Connection: ${connectionName} · disconnected`, action: 'Change' };
    }
    return { text: 'Connection: none', action: 'Link' };
}

export class DqlConnectionLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChangeCodeLenses: vscode.Event<void> = this.changeEmitter.event;
    private readonly subscriptions: vscode.Disposable[];

    constructor(
        private readonly connectionManager: ConnectionLensSource,
        private readonly documents: ConnectionLensDocuments
    ) {
        const refresh = () => this.changeEmitter.fire();
        this.subscriptions = [
            documents.onDidChange(refresh),
            connectionManager.onDidChangeOpenConnections(refresh),
            connectionManager.onDidChangeConnections(refresh)
        ];
    }

    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
        const connectionName = this.documents.connectionName(document);
        const connection = connectionName ? this.connectionManager.getOpenConnection(connectionName) : undefined;
        const lens = connectionLens(connectionName, connection);
        const range = new vscode.Range(0, 0, 0, 0);
        return [
            new vscode.CodeLens(range, { title: lens.text, command: '' }),
            new vscode.CodeLens(range, {
                title: lens.action,
                command: 'dctm.linkConnection',
                arguments: [document.uri]
            })
        ];
    }

    dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.changeEmitter.dispose();
    }
}

export function registerDqlConnectionLens(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    documents: DocumentConnections
): void {
    const provider = new DqlConnectionLensProvider(connectionManager, documents);
    context.subscriptions.push(
        provider,
        vscode.languages.registerCodeLensProvider(
            [{ language: 'dql', scheme: 'file' }, { language: 'dql', scheme: 'untitled' }],
            provider
        )
    );
}
