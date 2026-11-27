import * as assert from 'assert';
import { EntityCache } from '../../entityCache';
import { DctmBridge } from '../../dctmBridge';

interface Entry {
    name: string;
}

class TestCache extends EntityCache<Entry> {
    fetchCalls = 0;
    nextFetch: () => Promise<Entry[]> = async () => [];

    constructor() {
        super({} as DctmBridge, 'session-1');
    }

    protected fetchAll(): Promise<Entry[]> {
        this.fetchCalls++;
        return this.nextFetch();
    }

    protected nameOf(entry: Entry): string {
        return entry.name;
    }
}

function entries(...names: string[]): Entry[] {
    return names.map(name => ({ name }));
}

suite('EntityCache Test Suite', () => {
    let cache: TestCache;
    let refreshEvents: number;

    setup(() => {
        cache = new TestCache();
        refreshEvents = 0;
        cache.onRefresh(() => refreshEvents++);
    });

    teardown(() => {
        cache.dispose();
    });

    test('refresh stores the fetched entries, sets lastRefresh and fires onRefresh once', async () => {
        cache.nextFetch = async () => entries('zeta', 'Alpha', 'beta');

        await cache.refresh();

        assert.deepStrictEqual(cache.getNames(), ['Alpha', 'beta', 'zeta']);
        assert.strictEqual(cache.getCount(), 3);
        assert.strictEqual(cache.hasData(), true);
        assert.ok(cache.getLastRefresh() instanceof Date);
        assert.strictEqual(refreshEvents, 1);
    });

    test('a failed refresh rejects and keeps the previous entries and lastRefresh', async () => {
        cache.nextFetch = async () => entries('alpha', 'beta');
        await cache.refresh();
        const lastRefresh = cache.getLastRefresh();
        refreshEvents = 0;

        cache.nextFetch = async () => {
            throw new Error('bridge down');
        };

        await assert.rejects(cache.refresh(), /bridge down/);
        assert.deepStrictEqual(cache.getNames(), ['alpha', 'beta']);
        assert.ok(cache.get('alpha'));
        assert.strictEqual(cache.getLastRefresh(), lastRefresh);
        assert.strictEqual(refreshEvents, 0);
    });

    test('the previous entries are returned while a fetch is running', async () => {
        cache.nextFetch = async () => entries('alpha');
        await cache.refresh();

        let finishFetch: (value: Entry[]) => void = () => {};
        cache.nextFetch = () => new Promise(resolve => (finishFetch = resolve));
        const running = cache.refresh();

        assert.deepStrictEqual(cache.getNames(), ['alpha']);
        assert.ok(cache.get('alpha'));

        finishFetch(entries('beta'));
        await running;
        assert.deepStrictEqual(cache.getNames(), ['beta']);
        assert.strictEqual(cache.get('alpha'), undefined);
    });

    test('two refresh calls made together make one fetch', async () => {
        cache.nextFetch = async () => entries('alpha');

        await Promise.all([cache.refresh(), cache.refresh()]);

        assert.strictEqual(cache.fetchCalls, 1);
    });

    test('an empty list sets lastRefresh and hasData is false', async () => {
        await cache.refresh();

        assert.ok(cache.getLastRefresh() instanceof Date);
        assert.strictEqual(cache.hasData(), false);
    });

    test('get and search are case-insensitive and search returns sorted display names', async () => {
        cache.nextFetch = async () => entries('dm_world', 'Docu', 'admingroup', 'DM_ADMIN');
        await cache.refresh();

        assert.deepStrictEqual(cache.get('DOCU'), { name: 'Docu' });
        assert.deepStrictEqual(cache.search('DM_'), ['DM_ADMIN', 'dm_world']);
        assert.deepStrictEqual(cache.search('admin'), ['DM_ADMIN', 'admingroup']);
    });
});
