import * as assert from 'assert';
import { UserBrowserProvider } from '../../userBrowser';
import { ConnectionManager } from '../../connectionManager';

class FakeUserCache {
    loaded = true;
    failRefresh = false;
    refreshCalls = 0;
    searchPatterns: string[] = [];

    constructor(private names: string[]) {}

    onRefresh() {
        return { dispose: () => {} };
    }

    hasData(): boolean {
        return this.loaded;
    }

    async refresh(): Promise<void> {
        this.refreshCalls++;
        if (this.failRefresh) {
            throw new Error('refresh failed');
        }
        this.loaded = true;
    }

    getUserNames(): string[] {
        return this.names;
    }

    getUser(name: string) {
        return { userName: name };
    }

    searchUsers(pattern: string): string[] {
        this.searchPatterns.push(pattern);
        return this.names.filter(n => n.includes(pattern));
    }
}

function createProvider(cache: FakeUserCache, connected: boolean): UserBrowserProvider {
    const connectionManager = {
        getSelectedConnection: () => (connected ? { userCache: cache } : undefined),
        onDidChangeSelection: () => ({ dispose: () => {} })
    };
    return new UserBrowserProvider(connectionManager as unknown as ConnectionManager);
}

suite('UserBrowser Test Suite', () => {
    let cache: FakeUserCache;

    setup(() => {
        cache = new FakeUserCache(['admin', 'dmadmin', 'jsmith']);
    });

    test('returns the no-connection item when there is no connection', async () => {
        const children = await createProvider(cache, false).getChildren();

        assert.deepStrictEqual(children.map(c => c.itemType), ['no-connection']);
    });

    test('returns the unable-to-load item when the cache refresh fails', async () => {
        cache.loaded = false;
        cache.failRefresh = true;

        const children = await createProvider(cache, true).getChildren();

        assert.strictEqual(cache.refreshCalls, 1);
        assert.deepStrictEqual(children.map(c => c.itemType), ['no-connection']);
    });

    test('returns every user name when there is no filter', async () => {
        const children = await createProvider(cache, true).getChildren();

        assert.deepStrictEqual(children.map(c => c.userName), ['admin', 'dmadmin', 'jsmith']);
        assert.ok(children.every(c => c.itemType === 'user'));
    });

    test('returns the cache search result when a filter is set', async () => {
        const provider = createProvider(cache, true);
        provider.setSearchFilter('ADMIN');

        const children = await provider.getChildren();

        assert.deepStrictEqual(cache.searchPatterns, ['admin']);
        assert.deepStrictEqual(children.map(c => c.userName), ['admin', 'dmadmin']);
    });
});
