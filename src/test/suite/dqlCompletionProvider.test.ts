import * as assert from 'assert';
import * as vscode from 'vscode';
import { CompletionConnections, DqlCompletionProvider } from '../../dqlCompletion';
import { DocumentConnections } from '../../documentConnections';
import { RepositoryConnection } from '../../repositoryConnection';

class FakeMemento implements vscode.Memento {
    private readonly values = new Map<string, unknown>();

    keys(): readonly string[] {
        return [...this.values.keys()];
    }

    get<T>(key: string, defaultValue?: T): T | undefined {
        return this.values.has(key) ? this.values.get(key) as T : defaultValue;
    }

    async update(key: string, value: unknown): Promise<void> {
        this.values.set(key, value);
    }
}

class FakeConnections implements CompletionConnections {
    private readonly open = new Map<string, RepositoryConnection>();

    getOpenConnection(name: string): RepositoryConnection | undefined {
        return this.open.get(name);
    }

    setOpen(name: string, types: Record<string, string[]>): void {
        const typeCache = {
            getNames: () => Object.keys(types),
            fetchTypeDetails: async (typeName: string) =>
                types[typeName] ? { attributes: types[typeName].map(attribute => ({ name: attribute })) } : undefined
        };
        this.open.set(name, { name, typeCache } as unknown as RepositoryConnection);
    }
}

async function notebookCell(text: string, connectionName: string): Promise<vscode.TextDocument> {
    const data = new vscode.NotebookData([new vscode.NotebookCellData(vscode.NotebookCellKind.Code, text, 'dql')]);
    data.metadata = { connection: connectionName };
    const notebook = await vscode.workspace.openNotebookDocument('dctmbook', data);
    return notebook.cellAt(0).document;
}

function dqlDocument(text: string): Thenable<vscode.TextDocument> {
    return vscode.workspace.openTextDocument({ language: 'dql', content: text });
}

function endOf(document: vscode.TextDocument): vscode.Position {
    return document.positionAt(document.getText().length);
}

function labelsOfKind(items: vscode.CompletionItem[] | undefined, kind: vscode.CompletionItemKind): string[] {
    return (items ?? []).filter(item => item.kind === kind).map(item => item.label as string);
}

suite('DqlCompletionProvider Test Suite', () => {
    let connections: FakeConnections;
    let documents: DocumentConnections;
    let provider: DqlCompletionProvider;

    setup(() => {
        connections = new FakeConnections();
        connections.setOpen('A', { dm_document: ['object_name', 'title'], qca_custom: ['qca_code'] });
        connections.setOpen('B', { dm_document: ['object_name', 'title'], dm_folder: ['r_folder_path'] });
        documents = new DocumentConnections(new FakeMemento());
        provider = new DqlCompletionProvider(connections, documents);
    });

    teardown(() => {
        documents.dispose();
    });

    test('a notebook cell uses the notebook binding and offers that connection types after FROM', async () => {
        const cell = await notebookCell('select * from ', 'B');

        const items = await provider.provideCompletionItems(cell, endOf(cell));

        assert.deepStrictEqual(labelsOfKind(items, vscode.CompletionItemKind.Class), ['dm_document', 'dm_folder']);
    });

    test('a .dql document uses its link and offers that connection types after FROM', async () => {
        const document = await dqlDocument('select * from qca');
        await documents.link(document, 'A');

        const items = await provider.provideCompletionItems(document, endOf(document));

        assert.deepStrictEqual(labelsOfKind(items, vscode.CompletionItemKind.Class), ['qca_custom']);
    });

    test('a document whose connection is not open gets keywords and functions and no types', async () => {
        const document = await dqlDocument('select * from dm_');
        await documents.link(document, 'C');
        const keywordsDocument = await dqlDocument('sel');
        await documents.link(keywordsDocument, 'C');
        const functionsDocument = await dqlDocument('select upp');

        const types = await provider.provideCompletionItems(document, endOf(document));
        const keywords = await provider.provideCompletionItems(keywordsDocument, endOf(keywordsDocument));
        const functions = await provider.provideCompletionItems(functionsDocument, endOf(functionsDocument));

        assert.deepStrictEqual(types, []);
        assert.deepStrictEqual(labelsOfKind(keywords, vscode.CompletionItemKind.Keyword), ['SELECT']);
        assert.deepStrictEqual(labelsOfKind(functions, vscode.CompletionItemKind.Function), ['UPPER']);
        assert.strictEqual(functions!.find(item => item.label === 'UPPER')!.insertText, 'UPPER(');
    });

    test('item kinds and replace ranges come from the completion rules', async () => {
        const document = await dqlDocument('select 1 from dm_server_config;\nselect d.ti, obj from dm_document d');
        await documents.link(document, 'A');
        const attributePosition = new vscode.Position(1, 11);
        const selectListPosition = new vscode.Position(1, 16);

        const afterAlias = await provider.provideCompletionItems(document, attributePosition);
        const selectList = await provider.provideCompletionItems(document, selectListPosition);

        assert.deepStrictEqual(afterAlias!.map(item => [item.label, item.kind]), [
            ['title', vscode.CompletionItemKind.Field]
        ]);
        assert.deepStrictEqual(afterAlias![0].range, new vscode.Range(1, 9, 1, 11));
        assert.deepStrictEqual(selectList!.map(item => [item.label, item.kind]), [
            ['object_name', vscode.CompletionItemKind.Field],
            ['OBJECT', vscode.CompletionItemKind.Keyword],
            ['OBJECTS', vscode.CompletionItemKind.Keyword]
        ]);
        selectList!.forEach(item => assert.deepStrictEqual(item.range, new vscode.Range(1, 13, 1, 16)));
    });

    test('inside a string there is no completion', async () => {
        const document = await dqlDocument('select * from dm_document where title = \'sel');
        await documents.link(document, 'A');

        const items = await provider.provideCompletionItems(document, endOf(document));

        assert.strictEqual(items, undefined);
    });
});
