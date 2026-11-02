import * as assert from 'assert';
import { GroupBrowserProvider } from '../../groupBrowser';
import { GroupCache } from '../../groupCache';
import { ConnectionManager } from '../../connectionManager';

class FakeGroupCache {
    loaded = true;
    failRefresh = false;
    refreshCalls = 0;
    searchPatterns: string[] = [];

    constructor(private names: string[]) {}

    onRefresh(): void {}

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

    getGroupNames(): string[] {
        return this.names;
    }

    getGroup(name: string) {
        return { groupName: name };
    }

    searchGroups(pattern: string): string[] {
        this.searchPatterns.push(pattern);
        return this.names.filter(n => n.includes(pattern));
    }
}

function createProvider(cache: FakeGroupCache, connected: boolean): GroupBrowserProvider {
    const connectionManager = {
        getActiveConnection: () => (connected ? { sessionId: 's1' } : null),
        onConnectionChange: () => {}
    };
    return new GroupBrowserProvider(
        cache as unknown as GroupCache,
        connectionManager as unknown as ConnectionManager
    );
}

suite('GroupBrowser Test Suite', () => {
    let cache: FakeGroupCache;

    setup(() => {
        cache = new FakeGroupCache(['admingroup', 'dm_admin', 'docu']);
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

    test('returns every group name when there is no filter', async () => {
        const children = await createProvider(cache, true).getChildren();

        assert.deepStrictEqual(children.map(c => c.groupName), ['admingroup', 'dm_admin', 'docu']);
        assert.ok(children.every(c => c.itemType === 'group'));
    });

    test('returns the cache search result when a filter is set', async () => {
        const provider = createProvider(cache, true);
        provider.setSearchFilter('ADMIN');

        const children = await provider.getChildren();

        assert.deepStrictEqual(cache.searchPatterns, ['admin']);
        assert.deepStrictEqual(children.map(c => c.groupName), ['admingroup', 'dm_admin']);
    });
});
