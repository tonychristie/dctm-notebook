import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConnectionLensDocuments, ConnectionLensSource, connectionLens, DqlConnectionLensProvider } from '../../dqlConnectionLens';
import { RepositoryConnection } from '../../repositoryConnection';

const open = { name: 'A', username: 'test01', config: { repository: 'repo1' } } as RepositoryConnection;

const event = () => ({ dispose: () => undefined });

function source(connections: Record<string, RepositoryConnection>, configured: string[] = ['A']): ConnectionLensSource {
    return {
        getConnections: () => configured.map(name => ({ name })),
        getOpenConnection: (name: string) => connections[name],
        onDidChangeOpenConnections: event,
        onDidChangeConnections: event
    } as unknown as ConnectionLensSource;
}

function documents(connectionName: string | undefined): ConnectionLensDocuments {
    return {
        connectionName: () => connectionName,
        onDidChange: event
    } as unknown as ConnectionLensDocuments;
}

suite('DQL Connection Lens Test Suite', () => {
    test('a link to an open connection shows the repository and user', () => {
        assert.deepStrictEqual(connectionLens('A', open, true), {
            text: 'Connection: A · repo1 as test01',
            action: 'Change'
        });
    });

    test('a link to a connection that is not open shows disconnected', () => {
        assert.deepStrictEqual(connectionLens('A', undefined, true), {
            text: 'Connection: A · disconnected',
            action: 'Change'
        });
    });

    test('a link to a name that is not configured shows not found', () => {
        assert.deepStrictEqual(connectionLens('B', undefined, false), {
            text: 'Connection: B · not found',
            action: 'Change'
        });
    });

    test('the provider shows not found for a link to a name that is not configured', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'SELECT 1' });
        const provider = new DqlConnectionLensProvider(source({}, ['A']), documents('B'));

        const [text, action] = provider.provideCodeLenses(document);

        assert.strictEqual(text.command?.title, 'Connection: B · not found');
        assert.strictEqual(action.command?.title, 'Change');
        provider.dispose();
    });

    test('no link shows none', () => {
        assert.deepStrictEqual(connectionLens(undefined, undefined, false), {
            text: 'Connection: none',
            action: 'Link'
        });
    });

    test('the provider returns the text and the action on line 0', async () => {
        const document = await vscode.workspace.openTextDocument({ language: 'dql', content: 'SELECT 1\nFROM dm_document' });
        const provider = new DqlConnectionLensProvider(source({ A: open }), documents('A'));

        const [text, action] = provider.provideCodeLenses(document);

        assert.strictEqual(text.range.start.line, 0);
        assert.strictEqual(action.range.start.line, 0);
        assert.strictEqual(text.command?.title, 'Connection: A · repo1 as test01');
        assert.strictEqual(text.command?.command, '');
        assert.strictEqual(action.command?.title, 'Change');
        assert.strictEqual(action.command?.command, 'dctm.linkConnection');
        assert.deepStrictEqual(action.command?.arguments, [document.uri]);
        provider.dispose();
    });
});
