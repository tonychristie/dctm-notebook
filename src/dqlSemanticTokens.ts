import * as vscode from 'vscode';
import { TypeCache } from './typeCache';
import { ConnectionManager } from './connectionManager';
import { DocumentConnections } from './documentConnections';

/**
 * Semantic token types for DQL
 */
const tokenTypes = ['type', 'keyword', 'variable', 'string', 'number', 'operator'];
const tokenModifiers = ['declaration', 'definition', 'readonly'];

export const legend = new vscode.SemanticTokensLegend(tokenTypes, tokenModifiers);

/**
 * DQL keywords that should NOT be highlighted as types
 * Expanded from Repoint source code analysis (Issue #26)
 */
const DQL_KEYWORDS = new Set([
    // Query structure
    'select', 'from', 'where', 'and', 'or', 'not', 'in', 'is', 'as',
    'order', 'by', 'asc', 'desc', 'group', 'having', 'union', 'all',
    'distinct', 'only', 'first', 'for', 'of', 'to', 'with', 'without',

    // Joins
    'inner', 'outer', 'left', 'right', 'join', 'on',

    // Comparison operators
    'like', 'between', 'exists', 'some', 'any', 'escape',

    // Boolean/null values
    'true', 'false', 'null', 'nulldate', 'nullstring', 'nullint',

    // Data types
    'bool', 'boolean', 'int', 'integer', 'smallint', 'double', 'float',
    'string', 'character', 'characters', 'time', 'date', 'id',

    // Date functions
    'dateadd', 'datediff', 'datefloor', 'datetostring', 'now', 'today',
    'tomorrow', 'yesterday', 'day', 'week', 'month', 'year',

    // String functions
    'upper', 'lower', 'substr', 'substring',

    // Aggregate functions
    'count', 'sum', 'avg', 'min', 'max',

    // DML statements
    'update', 'set', 'delete', 'insert', 'into', 'values',

    // DDL statements
    'create', 'alter', 'drop', 'register', 'unregister', 'change', 'modify',
    'add', 'remove', 'truncate', 'append',

    // Type-related
    'type', 'supertype', 'repeating', 'attr', 'default', 'primary',
    'foreign', 'key', 'references', 'unique', 'computed',

    // Repository objects
    'folder', 'cabinet', 'document', 'object', 'objects', 'acl', 'user',
    'owner', 'policy', 'state', 'version', 'assembly', 'assemblies',
    'component', 'components', 'composite',

    // Full-text search
    'ftindex', 'add_ftindex', 'drop_ftindex', 'search', 'score', 'hits',
    'mhits', 'mscore', 'verity', 'contains', 'ft_optimizer', 'topic', 'summary',

    // Permissions
    'grant', 'revoke', 'permit', 'privileges', 'read', 'write', 'private',
    'public', 'world',

    // Transaction control
    'begin', 'commit', 'tran', 'transaction', 'abort',

    // Control flow
    'if', 'else', 'elseif', 'execute', 'exec', 'enable', 'disable',

    // Content-related
    'content_id', 'content_format', 'contain_id', 'mcontentid', 'mfile_url',
    'setfile', 'path', 'link', 'unlink',

    // System/internal
    'system', 'internal', 'sysobj_id', 'sysadmin', 'superuser', 'server',
    'dm_session_dd_locale', 'language', 'table', 'rdbms', 'storage',

    // Miscellaneous
    'current', 'latest', 'last', 'iscurrent', 'ispublic', 'isreplica',
    'complete', 'deleted', 'display', 'report', 'estimate', 'browse',
    'caching', 'depth', 'descend', 'node', 'nodesort', 'parent',
    'mapping', 'members', 'note', 'page_no', 'position', 'separator',
    'synonym', 'tag', 'text', 'using', 'value', 'violation', 'within',
    'address', 'application', 'assistance', 'business', 'check', 'comment',
    'dependency', 'docbasic', 'enforce', 'list', 'move', 'none', 'qry',
    'relate', 'replaceif'
]);

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

        const text = document.getText();
        const lines = text.split('\n');

        for (let lineNum = 0; lineNum < lines.length; lineNum++) {
            const line = lines[lineNum];
            this.tokenizeLine(line, lineNum, builder, typeCache);
        }

        return builder.build();
    }

    private tokenizeLine(
        line: string,
        lineNum: number,
        builder: vscode.SemanticTokensBuilder,
        typeCache: TypeCache
    ): void {
        // Find potential identifiers (words that could be type names)
        // Matches: word characters, including underscores
        const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;

        let match;
        while ((match = identifierPattern.exec(line)) !== null) {
            const word = match[1];
            const wordLower = word.toLowerCase();

            // Skip DQL keywords
            if (DQL_KEYWORDS.has(wordLower)) {
                continue;
            }

            // Check if this is a known type name
            if (typeCache.isTypeName(wordLower)) {
                // Check context - is this likely a type reference?
                if (this.isTypeContext(line, match.index)) {
                    builder.push(
                        lineNum,
                        match.index,
                        word.length,
                        tokenTypes.indexOf('type'),
                        0 // no modifiers
                    );
                }
            }
        }
    }

    /**
     * Check if the position is in a context where a type name is expected
     */
    private isTypeContext(line: string, position: number): boolean {
        const beforeWord = line.substring(0, position).toLowerCase().trim();

        // After FROM keyword
        if (beforeWord.endsWith('from')) {
            return true;
        }

        // After comma in FROM clause (multiple types)
        if (beforeWord.match(/from\s+[\w_,\s]+,\s*$/i)) {
            return true;
        }

        // After JOIN keyword
        if (beforeWord.match(/join\s*$/i)) {
            return true;
        }

        // After INTO keyword (INSERT)
        if (beforeWord.endsWith('into')) {
            return true;
        }

        // After UPDATE keyword
        if (beforeWord.match(/update\s*$/i)) {
            return true;
        }

        // After TYPE keyword in DQL
        if (beforeWord.endsWith('type')) {
            return true;
        }

        // After CREATE/ALTER/DROP TYPE
        if (beforeWord.match(/(create|alter|drop)\s+type\s*$/i)) {
            return true;
        }

        // In type() function call
        if (beforeWord.match(/type\s*\(\s*$/i)) {
            return true;
        }

        // After REGISTER AS/TABLE
        if (beforeWord.match(/register\s+(as|table)\s*$/i)) {
            return true;
        }

        // In subtype context (e.g., (ALL) dm_document, dm_folder)
        if (beforeWord.match(/\(\s*all\s*\)\s*$/i)) {
            return true;
        }

        return false;
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
