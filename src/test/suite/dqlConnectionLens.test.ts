import * as assert from 'assert';
import * as vscode from 'vscode';
import { ConnectionLensDocuments, ConnectionLensSource, connectionLens, DqlConnectionLensProvider } from '../../dqlConnectionLens';
import { RepositoryConnection } from '../../repositoryConnection';

const open = { name: 'A', username: 'test01', config: { repository: 'repo1' } } as RepositoryConnection;

const event = () => ({ dispose: () => undefined });

function source(connections: Record<string, RepositoryConnection>): ConnectionLensSource {
    return {
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
        assert.deepStrictEqual(connectionLens('A', open), {
            text: 'Connection: A · repo1 as test01',
            action: 'Change'
        });
    });

    test('a link to a connection that is not open shows disconnected', () => {
        assert.deepStrictEqual(connectionLens('A', undefined), {
            text: 'Connection: A · disconnected',
            action: 'Change'
        });
    });

    test('no link shows none', () => {
        assert.deepStrictEqual(connectionLens(undefined, undefined), {
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
