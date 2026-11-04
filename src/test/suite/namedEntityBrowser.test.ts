import * as assert from 'assert';
import * as vscode from 'vscode';
import { NamedEntityBrowserConfig, NamedEntityBrowserProvider } from '../../namedEntityBrowser';
import { ConnectionManager } from '../../connectionManager';
import { EntityCache } from '../../entityCache';

class FakeCache {
    lastRefresh: Date | null = new Date();
    failRefresh = false;
    refreshCalls = 0;
    searchPatterns: string[] = [];

    constructor(
        readonly entryNames: string[],
        readonly children: Record<string, string[]> = {}
    ) {}

    onRefresh() {
        return { dispose: () => {} };
    }

    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    async refresh(): Promise<void> {
        this.refreshCalls++;
        if (this.failRefresh) {
            throw new Error('refresh failed');
        }
        this.lastRefresh = new Date();
    }

    getNames(): string[] {
        return this.entryNames;
    }

    search(pattern: string): string[] {
        this.searchPatterns.push(pattern);
        return this.entryNames.filter(n => n.includes(pattern));
    }
}

type Cache = EntityCache<unknown>;

function createProvider(
    cache: FakeCache,
    connected: boolean,
    withChildren = false
): NamedEntityBrowserProvider<Cache> {
    const connectionManager = {
        getSelectedConnection: () => (connected ? {} : undefined),
        onDidChangeSelection: () => ({ dispose: () => {} })
    };
    const config: NamedEntityBrowserConfig<Cache> = {
        viewId: 'testView',
        singular: 'thing',
        plural: 'things',
        icon: 'symbol-class',
        contextValue: 'thing',
        pickCache: () => cache as unknown as Cache,
        rootNames: c => c.getNames(),
        childNames: withChildren ? (_c, name) => cache.children[name] ?? [] : undefined,
        filteredContextKey: 'test.filtered',
        commands: { open: 'o', showDetails: 's', refresh: 'r', search: 'q', clearSearch: 'c' },
        searchPrompt: '',
        searchPlaceholder: '',
        openDump: async () => {}
    };
    return new NamedEntityBrowserProvider(connectionManager as unknown as ConnectionManager, config);
}

suite('NamedEntityBrowser Test Suite', () => {
    let cache: FakeCache;

    setup(() => {
        cache = new FakeCache(['admin', 'dmadmin', 'jsmith']);
    });

    test('returns the no-connection item when there is no connection', async () => {
        const children = await createProvider(cache, false).getChildren();

        assert.deepStrictEqual(children.map(c => c.contextValue), ['no-connection']);
    });

    test('returns no items and does not refresh when the list loaded empty', async () => {
        cache = new FakeCache([]);

        const children = await createProvider(cache, true).getChildren();

        assert.deepStrictEqual(children, []);
        assert.strictEqual(cache.refreshCalls, 0);
    });

    test('refreshes once when the cache has not loaded', async () => {
        cache.lastRefresh = null;

        const children = await createProvider(cache, true).getChildren();

        assert.strictEqual(cache.refreshCalls, 1);
        assert.deepStrictEqual(children.map(c => c.name), ['admin', 'dmadmin', 'jsmith']);
        assert.ok(children.every(c => c.contextValue === 'thing'));
    });

    test('returns the unable-to-load item when the refresh fails', async () => {
        cache.lastRefresh = null;
        cache.failRefresh = true;

        const children = await createProvider(cache, true).getChildren();

        assert.strictEqual(cache.refreshCalls, 1);
        assert.deepStrictEqual(children.map(c => c.contextValue), ['no-connection']);
    });

    test('returns the search result as items that cannot be expanded', async () => {
        cache = new FakeCache(['admin', 'dmadmin', 'jsmith'], { admin: ['child'] });
        const provider = createProvider(cache, true, true);
        provider.setSearchFilter('ADMIN');

        const children = await provider.getChildren();

        assert.deepStrictEqual(cache.searchPatterns, ['admin']);
        assert.deepStrictEqual(children.map(c => c.name), ['admin', 'dmadmin']);
        assert.ok(children.every(c => c.collapsibleState === vscode.TreeItemCollapsibleState.None));
    });

    test('a name with children can be expanded and returns its children', async () => {
        cache = new FakeCache(['dm_sysobject'], { dm_sysobject: ['dm_document'], dm_document: [] });
        const provider = createProvider(cache, true, true);

        const [root] = await provider.getChildren();
        const children = await provider.getChildren(root);

        assert.strictEqual(root.collapsibleState, vscode.TreeItemCollapsibleState.Collapsed);
        assert.deepStrictEqual(children.map(c => c.name), ['dm_document']);
        assert.strictEqual(children[0].collapsibleState, vscode.TreeItemCollapsibleState.None);
    });
});
