import * as vscode from 'vscode';
import { completeDql, DqlCompletionResult } from '../dql/completion';
import { typeCacheSchema } from '../dql/typeCacheSchema';
import { DqlResult } from '../dqlExecutor';
import { RepositoryConnection } from '../repositoryConnection';
import { exportRows, ResultsExporter } from '../resultsPanel';
import { DumpTarget, OpenConnections } from './dumpTab';

export interface DqlExecute {
    execute(query: string, connection: RepositoryConnection): Promise<DqlResult>;
}

export type DqlRequest =
    | { command: 'run'; query: string }
    | { command: 'complete'; requestId: number; text: string; offset: number }
    | { command: 'dumpObject'; objectId: string }
    | { command: 'export'; format: 'excel' | 'json'; columns: string[]; rows: Record<string, unknown>[] };

export interface DqlHistoryEntry {
    query: string;
    timestamp: string;
    rowCount?: number;
    error: boolean;
}

export type DqlOutcome =
    | { result: Omit<DqlResult, 'query'> }
    | { error: string };

export type DqlMessage =
    | { type: 'dqlRunning' }
    | { type: 'dqlResult'; outcome: DqlOutcome; history: DqlHistoryEntry[] }
    | { type: 'dqlState'; running: boolean; outcome?: DqlOutcome; history: DqlHistoryEntry[] }
    | { type: 'dqlCompletion'; requestId: number; result?: DqlCompletionResult }
    | { type: 'dqlTypeNames'; names: string[] };

const HISTORY_SIZE = 10;

export class DqlTab implements vscode.Disposable {
    // A hidden workspace page reloads when shown again, so the history and the last result live here.
    private readonly history: DqlHistoryEntry[] = [];
    private outcome: DqlOutcome | undefined;
    private running = false;
    private subscription: vscode.Disposable | undefined;

    constructor(
        private readonly connectionName: string,
        private readonly connections: OpenConnections,
        private readonly executor: DqlExecute,
        private readonly post: (message: DqlMessage) => void,
        private readonly openDump: (target: DumpTarget) => Promise<void>,
        private readonly exporter?: ResultsExporter
    ) {
    }

    // The page colours type names, so it gets them whenever the open connection or its type cache changes.
    watch(connection: RepositoryConnection | undefined): void {
        this.subscription?.dispose();
        this.subscription = connection?.typeCache.onRefresh(() => this.postTypeNames(connection));
        this.postTypeNames(connection);
    }

    dispose(): void {
        this.subscription?.dispose();
        this.subscription = undefined;
    }

    ready(): void {
        this.post({ type: 'dqlState', running: this.running, outcome: this.outcome, history: [...this.history] });
        this.postTypeNames(this.connections.getOpenConnection(this.connectionName));
    }

    async handleMessage(message: DqlRequest): Promise<void> {
        switch (message.command) {
            case 'run':
                await this.run(message.query);
                break;
            case 'complete':
                await this.complete(message.requestId, message.text, message.offset);
                break;
            case 'dumpObject':
                await this.openDump({ kind: 'object', objectId: message.objectId });
                break;
            case 'export':
                await exportRows(message.format, message.columns, message.rows, this.exporter);
                break;
        }
    }

    private async run(query: string): Promise<void> {
        this.running = true;
        this.post({ type: 'dqlRunning' });
        const entry: DqlHistoryEntry = { query: query.trim(), timestamp: new Date().toLocaleTimeString(), error: false };
        try {
            const connection = this.connections.getOpenConnection(this.connectionName);
            if (!connection) {
                throw new Error(`Not connected to ${this.connectionName}`);
            }
            const { columns, rows, rowCount, executionTime } = await this.executor.execute(query, connection);
            this.outcome = { result: { columns, rows, rowCount, executionTime } };
            entry.rowCount = rowCount;
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.outcome = { error: `DQL Error: ${text}` };
            entry.error = true;
        } finally {
            this.running = false;
        }
        this.history.unshift(entry);
        this.history.splice(HISTORY_SIZE);
        this.post({ type: 'dqlResult', outcome: this.outcome, history: [...this.history] });
    }

    private async complete(requestId: number, text: string, offset: number): Promise<void> {
        const connection = this.connections.getOpenConnection(this.connectionName);
        const schema = connection ? typeCacheSchema(connection.typeCache) : undefined;
        let result: DqlCompletionResult | undefined;
        try {
            result = await completeDql(text, offset, schema);
        } catch {
            // A failed attribute lookup leaves the list empty rather than showing an error while typing.
            result = undefined;
        }
        this.post({ type: 'dqlCompletion', requestId, result });
    }

    private postTypeNames(connection: RepositoryConnection | undefined): void {
        this.post({ type: 'dqlTypeNames', names: connection ? connection.typeCache.getNames() : [] });
    }
}
