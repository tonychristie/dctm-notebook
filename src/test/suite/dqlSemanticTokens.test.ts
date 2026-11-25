import * as assert from 'assert';
import * as vscode from 'vscode';
import { DqlSemanticTokensProvider, TokenConnections, TokenDocuments } from '../../dqlSemanticTokens';
import { TypeCache, TypeInfo } from '../../typeCache';
import { DctmBridge } from '../../dctmBridge';
import { RepositoryConnection } from '../../repositoryConnection';

// Create a mock TypeCache with test data
class MockTypeCache extends TypeCache {
    private mockTypes: Set<string> = new Set();

    constructor() {
        super({} as DctmBridge, 'session-1');
    }

    addMockType(typeName: string): void {
        this.mockTypes.add(typeName.toLowerCase());
    }

    override isTypeName(name: string): boolean {
        return this.mockTypes.has(name.toLowerCase());
    }

    override hasData(): boolean {
        return this.mockTypes.size > 0;
    }

    protected override async fetchAll(): Promise<TypeInfo[]> {
        return [];
    }
}

class FakeConnections implements TokenConnections {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChangeOpenConnections = this.emitter.event;
    private readonly open = new Map<string, RepositoryConnection>();

    getOpenConnection(name: string): RepositoryConnection | undefined {
        return this.open.get(name);
    }

    getOpenConnections(): RepositoryConnection[] {
        return [...this.open.values()];
    }

    setOpen(name: string, typeCache: TypeCache): void {
        this.open.set(name, { name, typeCache } as unknown as RepositoryConnection);
        this.emitter.fire();
    }

    close(name: string): void {
        this.open.delete(name);
        this.emitter.fire();
    }
}

class FakeDocuments implements TokenDocuments {
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onDidChange = this.emitter.event;
    private readonly links = new Map<vscode.TextDocument, string>();

    connectionName(document: vscode.TextDocument): string | undefined {
        return this.links.get(document);
    }

    link(document: vscode.TextDocument, connectionName: string): void {
        this.links.set(document, connectionName);
        this.emitter.fire();
    }
}

function documentWithText(text: string): vscode.TextDocument {
    return { getText: () => text } as vscode.TextDocument;
}

function cacheWith(...typeNames: string[]): MockTypeCache {
    const cache = new MockTypeCache();
    typeNames.forEach(name => cache.addMockType(name));
    return cache;
}

suite('DqlSemanticTokensProvider Test Suite', () => {
    suite('type cache of the document connection', () => {
        let connections: FakeConnections;
        let documents: FakeDocuments;
        let cacheA: MockTypeCache;
        let cacheB: MockTypeCache;
        let tokens: DqlSemanticTokensProvider;
        let fired: number;

        setup(() => {
            connections = new FakeConnections();
            documents = new FakeDocuments();
            cacheA = cacheWith('dm_document', 'my_custom_type');
            cacheB = cacheWith('dm_document');
            connections.setOpen('A', cacheA);
            connections.setOpen('B', cacheB);
            tokens = new DqlSemanticTokensProvider(connections, documents);
            fired = 0;
            tokens.onDidChangeSemanticTokens(() => fired++);
        });

        teardown(() => {
            tokens.dispose();
        });

        test('two documents linked to two connections use each connection type cache', () => {
            const documentA = documentWithText('select * from my_custom_type');
            const documentB = documentWithText('select * from my_custom_type');
            documents.link(documentA, 'A');
            documents.link(documentB, 'B');

            assert.strictEqual(tokens.provideDocumentSemanticTokens(documentA).data.length, 5);
            assert.strictEqual(tokens.provideDocumentSemanticTokens(documentB).data.length, 0);
        });

        test('a document with no connection, or a connection that is not open, has no type colouring', () => {
            const unlinked = documentWithText('select * from dm_document');
            const closed = documentWithText('select * from dm_document');
            documents.link(closed, 'C');

            assert.strictEqual(tokens.provideDocumentSemanticTokens(unlinked).data.length, 0);
            assert.strictEqual(tokens.provideDocumentSemanticTokens(closed).data.length, 0);
        });

        test('fires when a link changes', () => {
            documents.link(documentWithText(''), 'A');

            assert.strictEqual(fired, 1);
        });

        test('fires when the type cache of any open connection refreshes', async () => {
            await cacheA.refresh();
            await cacheB.refresh();

            assert.strictEqual(fired, 2);
        });

        test('fires when a connection opens and follows the type cache of the new connection', async () => {
            const cacheC = cacheWith('dm_folder');
            connections.setOpen('C', cacheC);
            await cacheC.refresh();

            assert.strictEqual(fired, 2);
        });

        test('fires when a connection closes and stops following its type cache', async () => {
            connections.close('A');
            await cacheA.refresh();

            assert.strictEqual(fired, 1);
        });

        test('does not fire after dispose', async () => {
            tokens.dispose();

            await cacheA.refresh();
            documents.link(documentWithText(''), 'A');

            assert.strictEqual(fired, 0);
        });
    });
});
