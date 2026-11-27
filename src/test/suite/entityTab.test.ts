import * as assert from 'assert';
import * as vscode from 'vscode';
import { RepositoryConnection } from '../../repositoryConnection';
import { DumpTarget } from '../../workspace/dumpTab';
import { ENTITY_TABS, EntityMessage, EntityTab } from '../../workspace/entityTab';

class FakeCache {
    names: string[] = [];
    next: string[] = [];
    superTypes = new Map<string, string>();
    refreshCalls = 0;
    failWith: Error | undefined;
    private lastRefresh: Date | null = null;
    private readonly emitter = new vscode.EventEmitter<void>();
    readonly onRefresh = this.emitter.event;

    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    async refresh(): Promise<void> {
        this.refreshCalls++;
        if (this.failWith) {
            throw this.failWith;
        }
        this.names = this.next;
        this.lastRefresh = new Date();
        this.emitter.fire();
    }

    getNames(): string[] {
        return this.names;
    }

    getCount(): number {
        return this.names.length;
    }

    get(name: string): { superType?: string } | undefined {
        return this.names.includes(name) ? { superType: this.superTypes.get(name) } : undefined;
    }
}

function fakeConnection(cache: FakeCache): RepositoryConnection {
    return { name: 'conn1', typeCache: cache, userCache: cache, groupCache: cache } as unknown as RepositoryConnection;
}

interface Harness {
    tab: EntityTab;
    cache: FakeCache;
    posted: EntityMessage[];
    opened: DumpTarget[];
    setConnection(connection: RepositoryConnection | undefined): void;
}

function harness(tabName: keyof typeof ENTITY_TABS = 'users'): Harness {
    const cache = new FakeCache();
    cache.next = ['admin', 'jsmith'];
    let connection: RepositoryConnection | undefined = fakeConnection(cache);
    const posted: EntityMessage[] = [];
    const opened: DumpTarget[] = [];
    const tab = new EntityTab(
        'conn1',
        { getOpenConnection: () => connection },
        ENTITY_TABS[tabName],
        message => posted.push(message),
        async target => {
            opened.push(target);
        }
    );
    tab.watch(connection);
    return {
        tab,
        cache,
        posted,
        opened,
        setConnection: value => {
            connection = value;
            tab.watch(value);
        }
    };
}

function lastReply(posted: EntityMessage[], requestId: number): EntityMessage | undefined {
    return posted.filter(message => message.requestId === requestId).pop();
}

suite('EntityTab Test Suite', () => {
    test('a tab whose cache has not loaded refreshes it once', async () => {
        const { tab, cache, posted } = harness();

        await tab.handleMessage({ command: 'load', requestId: 1 });
        await tab.handleMessage({ command: 'load', requestId: 2 });

        assert.strictEqual(cache.refreshCalls, 1);
        assert.deepStrictEqual(lastReply(posted, 1), {
            type: 'entities',
            tab: 'users',
            requestId: 1,
            items: [{ name: 'admin' }, { name: 'jsmith' }]
        });
        assert.ok(lastReply(posted, 2) && 'items' in lastReply(posted, 2)!);
    });

    test('a failed refresh reports the error', async () => {
        const { tab, cache, posted } = harness('groups');
        cache.failWith = new Error('bridge unavailable');

        await tab.handleMessage({ command: 'load', requestId: 1 });

        assert.deepStrictEqual(lastReply(posted, 1), {
            type: 'entities',
            tab: 'groups',
            requestId: 1,
            error: 'Unable to load groups: bridge unavailable'
        });
    });

    test('a closed connection reports Not connected', async () => {
        const { tab, posted, setConnection } = harness('types');
        setConnection(undefined);

        await tab.handleMessage({ command: 'load', requestId: 1 });

        const reply = lastReply(posted, 1);
        assert.ok(reply && 'error' in reply);
        assert.strictEqual(reply.error, 'Unable to load types: Not connected to conn1');
    });

    test('Refresh reloads a cache that has already loaded', async () => {
        const { tab, cache, posted } = harness();
        await tab.handleMessage({ command: 'load', requestId: 1 });
        cache.next = ['admin', 'jsmith', 'kjones'];

        await tab.handleMessage({ command: 'refresh', requestId: 2 });

        assert.strictEqual(cache.refreshCalls, 2);
        const reply = lastReply(posted, 2);
        assert.ok(reply && 'items' in reply);
        assert.strictEqual(reply.items.length, 3);
    });

    test('a cache refresh from anywhere sends the new list', async () => {
        const { cache, posted } = harness();

        await cache.refresh();

        assert.deepStrictEqual(posted, [{
            type: 'entities',
            tab: 'users',
            requestId: undefined,
            items: [{ name: 'admin' }, { name: 'jsmith' }]
        }]);
    });

    test('the cache of a closed connection no longer sends lists', async () => {
        const { cache, posted, setConnection } = harness();
        setConnection(undefined);

        await cache.refresh();

        assert.deepStrictEqual(posted, []);
    });

    test('types are sent with their supertype', async () => {
        const { tab, cache, posted } = harness('types');
        cache.next = ['dm_document', 'dm_sysobject'];
        cache.superTypes.set('dm_document', 'dm_sysobject');

        await tab.handleMessage({ command: 'load', requestId: 1 });

        const reply = lastReply(posted, 1);
        assert.ok(reply && 'items' in reply);
        assert.deepStrictEqual(reply.items, [
            { name: 'dm_document', parent: 'dm_sysobject' },
            { name: 'dm_sysobject', parent: undefined }
        ]);
    });

    test('open shows the item in the Dump tab', async () => {
        const { tab, opened } = harness('groups');

        await tab.handleMessage({ command: 'open', name: 'editors' });

        assert.deepStrictEqual(opened, [{ kind: 'group', name: 'editors' }]);
    });
});
