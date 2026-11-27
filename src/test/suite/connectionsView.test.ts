import * as assert from 'assert';
import * as vscode from 'vscode';
import { DocumentumConnection } from '../../connectionManager';
import { ConnectionsViewProvider, ConnectionsViewSource } from '../../connectionsView';
import { RepositoryConnection } from '../../repositoryConnection';

function source(connections: DocumentumConnection[], open: Record<string, Partial<RepositoryConnection>>): ConnectionsViewSource {
    const event = () => ({ dispose: () => undefined });
    return {
        getConnections: () => connections,
        getOpenConnection: (name: string) => open[name] as RepositoryConnection | undefined,
        onDidChangeOpenConnections: event,
        onDidChangeConnections: event
    } as unknown as ConnectionsViewSource;
}

const config: DocumentumConnection = { name: 'conn1', type: 'dfc', repository: 'repo1', docbroker: 'host', port: 1489 };

suite('Connections View Test Suite', () => {
    test('a connected node has no children and opens its workspace on click', () => {
        const provider = new ConnectionsViewProvider(source([config], { conn1: { username: 'test01' } }));

        const [node] = provider.getChildren();

        assert.strictEqual(node.collapsibleState, vscode.TreeItemCollapsibleState.None);
        assert.deepStrictEqual(provider.getChildren(node), []);
        assert.strictEqual(node.command?.command, 'dctm.openWorkspace');
        assert.deepStrictEqual(node.command?.arguments, ['conn1']);
        assert.strictEqual(node.contextValue, 'connection-connected');
        assert.strictEqual(node.description, 'repo1 (test01)');
        provider.dispose();
    });

    test('a disconnected node opens its workspace on click', () => {
        const provider = new ConnectionsViewProvider(source([config], {}));

        const [node] = provider.getChildren();

        assert.strictEqual(node.command?.command, 'dctm.openWorkspace');
        assert.strictEqual(node.contextValue, 'connection-disconnected');
        assert.strictEqual(node.description, 'disconnected');
        provider.dispose();
    });
});
