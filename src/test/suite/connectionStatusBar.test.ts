import * as assert from 'assert';
import { connectionStatus } from '../../connectionStatusBar';
import { RepositoryConnection } from '../../repositoryConnection';

const open = { name: 'A', username: 'test01' } as RepositoryConnection;

suite('Connection Status Bar Test Suite', () => {
    test('a notebook shows its binding and binds on click', () => {
        assert.deepStrictEqual(connectionStatus('notebook', 'A', open), {
            text: '$(notebook) A (test01)',
            tooltip: 'Notebook bound to A as test01. Click to change the binding.',
            command: 'dctm.notebook.bindConnection',
            warning: false
        });
        assert.deepStrictEqual(connectionStatus('notebook', undefined, undefined), {
            text: '$(notebook) No connection',
            tooltip: 'Notebook is not bound to a connection. Click to bind it.',
            command: 'dctm.notebook.bindConnection',
            warning: true
        });
    });

    test('a DQL file shows its link and links on click', () => {
        assert.deepStrictEqual(connectionStatus('dql', 'A', undefined), {
            text: '$(file-code) A (disconnected)',
            tooltip: 'File linked to A, which is not connected. Running the query connects it. Click to change the link.',
            command: 'dctm.linkConnection',
            warning: true
        });
        assert.strictEqual(connectionStatus('dql', 'A', open).text, '$(file-code) A (test01)');
        assert.strictEqual(connectionStatus('dql', undefined, undefined).text, '$(file-code) No connection');
    });
});
