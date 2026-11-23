import * as assert from 'assert';
import { RepositoryConnection } from '../../repositoryConnection';
import { DumpContentMessage, DumpTab, DumpTarget } from '../../workspace/dumpTab';

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: Error): void;
}

function deferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

interface RenderCall {
    target: DumpTarget;
    refresh: boolean;
    result: Deferred<string>;
}

interface Harness {
    tab: DumpTab;
    calls: RenderCall[];
    posted: DumpContentMessage[];
    last(): DumpContentMessage;
}

function harness(resolveAtOnce = true): Harness {
    const calls: RenderCall[] = [];
    const posted: DumpContentMessage[] = [];
    const connection = { name: 'conn1' } as RepositoryConnection;
    const tab = new DumpTab(
        'conn1',
        { getOpenConnection: () => connection },
        message => posted.push(message),
        (_connection, target, refresh) => {
            const result = deferred<string>();
            calls.push({ target, refresh, result });
            if (resolveAtOnce) {
                result.resolve(`result ${target.objectId}`);
            }
            return result.promise;
        }
    );
    return { tab, calls, posted, last: () => posted[posted.length - 1] };
}

const objectA: DumpTarget = { kind: 'object', objectId: '090000018000000a' };
const objectB: DumpTarget = { kind: 'object', objectId: '090000018000000b' };
const objectC: DumpTarget = { kind: 'object', objectId: '090000018000000c' };

suite('DumpTab Test Suite', () => {
    test('a new dump adds one history entry', async () => {
        const { tab, last } = harness();

        await tab.show(objectA);
        assert.strictEqual(last().canGoBack, false);

        await tab.show(objectB);
        assert.strictEqual(last().html, 'result 090000018000000b');
        assert.strictEqual(last().canGoBack, true);
        assert.strictEqual(last().canGoForward, false);
    });

    test('Back and Forward load the entry without adding one and without a refresh', async () => {
        const { tab, calls, last } = harness();
        await tab.show(objectA);
        await tab.show(objectB);
        await tab.show(objectC);

        await tab.back();
        await tab.back();
        assert.deepStrictEqual(calls[3].target, objectB);
        assert.deepStrictEqual(calls[4].target, objectA);
        assert.strictEqual(last().canGoBack, false);

        await tab.forward();
        assert.deepStrictEqual(calls[5].target, objectB);
        assert.strictEqual(last().canGoBack, true);
        assert.strictEqual(last().canGoForward, true);
        assert.ok(calls.every(call => !call.refresh));
    });

    test('Refresh reloads the current entry with refresh and adds nothing', async () => {
        const { tab, calls, last } = harness();
        await tab.show(objectA);
        await tab.show(objectB);
        await tab.back();

        await tab.refresh();

        const refreshCall = calls[calls.length - 1];
        assert.deepStrictEqual(refreshCall.target, objectA);
        assert.strictEqual(refreshCall.refresh, true);
        assert.strictEqual(last().canGoBack, false);
        assert.strictEqual(last().canGoForward, true);
    });

    test('shows the second result when the first load resolves after the second load started', async () => {
        const { tab, calls, last } = harness(false);

        const first = tab.show(objectA);
        const second = tab.show(objectB);
        calls[0].result.resolve('result a');
        await first;
        assert.ok(!last().html.includes('result a'));

        calls[1].result.resolve('result b');
        await second;
        assert.strictEqual(last().html, 'result b');
        assert.strictEqual(last().canGoBack, false);
    });

    test('ignores an error from a load that a newer load has replaced', async () => {
        const { tab, calls, last } = harness(false);

        const first = tab.show(objectA);
        const second = tab.show(objectB);
        calls[1].result.resolve('result b');
        await second;
        calls[0].result.reject(new Error('lost connection'));
        await first;

        assert.strictEqual(last().html, 'result b');
    });

    test('shows the error of the latest load with Retry', async () => {
        const { tab, calls, last } = harness(false);

        const load = tab.show(objectA);
        calls[0].result.reject(new Error('lost <connection>'));
        await load;

        assert.ok(last().html.includes('lost &lt;connection&gt;'));
        assert.ok(last().html.includes('data-action="refresh"'));
    });

    test('ready sends the last content and the Back and Forward state without a fetch', async () => {
        const { tab, calls, posted } = harness();
        await tab.show(objectA);
        await tab.show(objectB);
        const callCount = calls.length;
        posted.length = 0;

        tab.ready();

        assert.strictEqual(calls.length, callCount);
        assert.strictEqual(posted.length, 1);
        assert.strictEqual(posted[0].html, 'result 090000018000000b');
        assert.strictEqual(posted[0].objectId, objectB.objectId);
        assert.strictEqual(posted[0].canGoBack, true);
    });

    test('a closed connection shows the Not connected error', async () => {
        const posted: DumpContentMessage[] = [];
        const tab = new DumpTab('conn1', { getOpenConnection: () => undefined }, message => posted.push(message));

        await tab.show(objectA);

        assert.ok(posted[posted.length - 1].html.includes('Not connected to conn1'));
    });
});
