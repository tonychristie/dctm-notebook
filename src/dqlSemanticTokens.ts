import * as vscode from 'vscode';
import { ConnectionManager } from './connectionManager';
import { DocumentConnections } from './documentConnections';
import { findTypeNames } from './dql/typeNames';

/**
 * Semantic token types for DQL
 */
const tokenTypes = ['type', 'keyword', 'variable', 'string', 'number', 'operator'];
const tokenModifiers = ['declaration', 'definition', 'readonly'];

export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

/**
 * Semantic Token Provider for DQL files
 * Highlights repository-specific type names dynamically
 */
export type TokenConnections = Pick<
    ConnectionManager,
    'getOpenConnection' | 'getOpenConnections' | 'onDidChangeOpenConnections'
>;
export type TokenDocuments = Pick<DocumentConnections, 'connectionName' | 'onDidChange'>;

export class DqlSemanticTokensProvider implements vscode.DocumentSemanticTokensProvider, vscode.Disposable {
    private readonly _onDidChangeSemanticTokens = new vscode.EventEmitter<void>();
    readonly onDidChangeSemanticTokens = this._onDidChangeSemanticTokens.event;

    private readonly subscriptions: vscode.Disposable[];
    private cacheSubscriptions: vscode.Disposable[] = [];

    constructor(
        private readonly connectionManager: TokenConnections,
        private readonly documents: TokenDocuments
    ) {
        this.subscribeToCaches();
        this.subscriptions = [
            connectionManager.onDidChangeOpenConnections(() => {
                this.subscribeToCaches();
                this._onDidChangeSemanticTokens.fire();
            }),
            documents.onDidChange(() => this._onDidChangeSemanticTokens.fire())
        ];
    }

    private subscribeToCaches(): void {
        this.cacheSubscriptions.forEach(subscription => subscription.dispose());
        this.cacheSubscriptions = this.connectionManager.getOpenConnections().map(connection =>
            connection.typeCache.onRefresh(() => this._onDidChangeSemanticTokens.fire())
        );
    }

    dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.cacheSubscriptions.forEach(subscription => subscription.dispose());
        this._onDidChangeSemanticTokens.dispose();
    }

    provideDocumentSemanticTokens(
        document: vscode.TextDocument
    ): vscode.SemanticTokens {
        const builder = new vscode.SemanticTokensBuilder(legend);

        const connectionName = this.documents.connectionName(document);
        const typeCache = connectionName
            ? this.connectionManager.getOpenConnection(connectionName)?.typeCache
            : undefined;
        if (!typeCache?.hasData()) {
            return builder.build();
        }

        for (const range of findTypeNames(document.getText(), name => typeCache.isTypeName(name))) {
            builder.push(range.line, range.start, range.length, tokenTypes.indexOf('type'), 0);
        }

        return builder.build();
    }
}

/**
 * Register the semantic token provider
 */
export function registerDqlSemanticTokens(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    documents: DocumentConnections
): void {
    const provider = new DqlSemanticTokensProvider(connectionManager, documents);

    context.subscriptions.push(
        provider,
        vscode.languages.registerDocumentSemanticTokensProvider({ language: 'dql' }, provider, legend)
    );
}
