import * as assert from 'assert';
import { Credentials, DocumentumConnection } from '../../connectionManager';
import { ConnectionSettingsHandler, ConnectionSettingsSource } from '../../connectionsPanel';

const first: DocumentumConnection = { name: 'A', type: 'dfc', repository: 'repo1', docbroker: 'host1' };
const second: DocumentumConnection = { name: 'B', type: 'rest', repository: 'repo2', endpoint: 'http://host2' };

class FakeConnectionManager implements ConnectionSettingsSource {
    stored: DocumentumConnection[] = [first, second];
    saves: DocumentumConnection[][] = [];
    credentials: Credentials | undefined = { username: 'test01', password: 'secret' };
    failTest = false;

    storedConnections(): DocumentumConnection[] {
        return this.stored;
    }

    async saveConnections(connections: DocumentumConnection[]): Promise<void> {
        this.saves.push(connections);
        this.stored = connections;
    }

    async requestCredentials(): Promise<Credentials | undefined> {
        return this.credentials;
    }

    async testConnection(): Promise<void> {
        if (this.failTest) {
            throw new Error('authentication failed');
        }
    }
}

function harness(confirm = true) {
    const manager = new FakeConnectionManager();
    const posted: unknown[] = [];
    const confirmations: string[] = [];
    const notices: string[] = [];
    const handler = new ConnectionSettingsHandler(
        manager,
        message => posted.push(message),
        async message => {
            confirmations.push(message);
            return confirm;
        },
        message => notices.push(message)
    );
    return { manager, handler, posted, confirmations, notices };
}

suite('Connection Settings Handler Test Suite', () => {
    test('save of a new connection appends it', async () => {
        const { manager, handler, notices } = harness();
        const added: DocumentumConnection = { name: 'C', type: 'dfc', repository: 'repo3', docbroker: 'host3' };

        await handler.save(undefined, added);

        assert.deepStrictEqual(manager.saves, [[first, second, added]]);
        assert.deepStrictEqual(notices, []);
    });

    test('save of an edited connection replaces it at the same position', async () => {
        const { manager, handler, notices } = harness();
        const edited = { ...first, docbroker: 'other' };

        await handler.save('A', edited);

        assert.deepStrictEqual(manager.saves, [[edited, second]]);
        assert.deepStrictEqual(notices, []);
    });

    test('save of a renamed connection replaces it and shows the rename notice', async () => {
        const { manager, handler, notices } = harness();
        const renamed = { ...first, name: 'A2' };

        await handler.save('A', renamed);

        assert.deepStrictEqual(manager.saves, [[renamed, second]]);
        assert.strictEqual(notices.length, 1);
    });

    test('a confirmed delete removes the connection', async () => {
        const { manager, handler, confirmations } = harness(true);

        await handler.delete('A');

        assert.strictEqual(confirmations.length, 1);
        assert.deepStrictEqual(manager.saves, [[second]]);
    });

    test('a cancelled delete saves nothing', async () => {
        const { manager, handler } = harness(false);

        await handler.delete('A');

        assert.deepStrictEqual(manager.saves, []);
    });

    test('test posts a success result', async () => {
        const { handler, posted } = harness();

        await handler.test(first);

        assert.deepStrictEqual(posted, [{ type: 'testResult', success: true, message: 'Connected to repo1 as test01.' }]);
    });

    test('test posts a failure result when the bridge connect fails', async () => {
        const { manager, handler, posted } = harness();
        manager.failTest = true;

        await handler.test(first);

        assert.deepStrictEqual(posted, [{ type: 'testResult', success: false, message: 'authentication failed' }]);
    });

    test('test posts an empty result when the credentials prompt is cancelled', async () => {
        const { manager, handler, posted } = harness();
        manager.credentials = undefined;

        await handler.test(first);

        assert.deepStrictEqual(posted, [{ type: 'testResult' }]);
    });
});
