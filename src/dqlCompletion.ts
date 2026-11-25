import * as vscode from 'vscode';
import type { ConnectionManager } from './connectionManager';
import type { DocumentConnections } from './documentConnections';
import { completeDql, DqlCompletionKind } from './dql/completion';
import { typeCacheSchema } from './dql/typeCacheSchema';

export type CompletionConnections = Pick<ConnectionManager, 'getOpenConnection'>;
export type CompletionDocuments = Pick<DocumentConnections, 'connectionName'>;

const ITEM_KINDS: Record<DqlCompletionKind, vscode.CompletionItemKind> = {
    keyword: vscode.CompletionItemKind.Keyword,
    function: vscode.CompletionItemKind.Function,
    type: vscode.CompletionItemKind.Class,
    attribute: vscode.CompletionItemKind.Field
};

export class DqlCompletionProvider implements vscode.CompletionItemProvider {
    constructor(
        private readonly connections: CompletionConnections,
        private readonly documents: CompletionDocuments
    ) {}

    async provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position
    ): Promise<vscode.CompletionItem[] | undefined> {
        const connectionName = this.documents.connectionName(document);
        const connection = connectionName ? this.connections.getOpenConnection(connectionName) : undefined;
        const schema = connection ? typeCacheSchema(connection.typeCache) : undefined;

        const result = await completeDql(document.getText(), document.offsetAt(position), schema);
        if (!result) {
            return undefined;
        }

        const range = new vscode.Range(document.positionAt(result.from), document.positionAt(result.to));
        return result.items.map(item => {
            const completion = new vscode.CompletionItem(item.label, ITEM_KINDS[item.kind]);
            completion.insertText = item.insertText;
            completion.range = range;
            return completion;
        });
    }
}

export function registerDqlCompletion(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager,
    documents: DocumentConnections
): void {
    context.subscriptions.push(
        vscode.languages.registerCompletionItemProvider(
            { language: 'dql' },
            new DqlCompletionProvider(connectionManager, documents),
            '.'
        )
    );
}
