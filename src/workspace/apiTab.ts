import { ApiMethodRequest, ApiMethodResponse } from '../apiExecutor';
import { RepositoryConnection } from '../repositoryConnection';
import { formatResult } from '../webviewLogic';
import { DumpTarget, OpenConnections } from './dumpTab';

export interface ApiExecute {
    execute(request: ApiMethodRequest, connection: RepositoryConnection): Promise<ApiMethodResponse>;
}

export type ApiRequest =
    | { command: 'execute'; objectId?: string; method: string; args?: unknown[] }
    | { command: 'dumpObject'; objectId?: string };

export interface ApiHistoryEntry {
    method: string;
    result: string;
    success: boolean;
    timestamp: string;
}

export type ApiMessage =
    | { type: 'apiExecuting'; method: string }
    | {
        type: 'apiResult';
        success: true;
        result: unknown;
        resultType: string;
        executionTimeMs: number;
        history: ApiHistoryEntry[];
    }
    | { type: 'apiResult'; success: false; error: string; history: ApiHistoryEntry[] }
    | { type: 'apiHistory'; history: ApiHistoryEntry[] }
    | { type: 'apiObjectId'; objectId: string };

const HISTORY_SIZE = 10;

export class ApiTab {
    // A message posted before the page loads is lost, so the object ID waits for the page's ready.
    private pendingObjectId: string | undefined;
    // A hidden workspace page reloads when shown again, so the history lives here.
    private readonly history: ApiHistoryEntry[] = [];

    constructor(
        private readonly connectionName: string,
        private readonly connections: OpenConnections,
        private readonly executor: ApiExecute,
        private readonly post: (message: ApiMessage) => void,
        private readonly openDump: (target: DumpTarget) => Promise<void>
    ) {
    }

    setObjectId(objectId: string): void {
        this.pendingObjectId = objectId;
        this.post({ type: 'apiObjectId', objectId });
    }

    ready(): void {
        if (this.history.length > 0) {
            this.post({ type: 'apiHistory', history: [...this.history] });
        }
        if (this.pendingObjectId !== undefined) {
            this.post({ type: 'apiObjectId', objectId: this.pendingObjectId });
            this.pendingObjectId = undefined;
        }
    }

    async handleMessage(message: ApiRequest): Promise<void> {
        if (message.command === 'dumpObject') {
            if (message.objectId) {
                await this.openDump({ kind: 'object', objectId: message.objectId });
            }
            return;
        }
        await this.execute(message.method, message.objectId, message.args);
    }

    private async execute(method: string, objectId: string | undefined, args: unknown[] | undefined): Promise<void> {
        this.post({ type: 'apiExecuting', method });
        try {
            const connection = this.connections.getOpenConnection(this.connectionName);
            if (!connection) {
                throw new Error(`Not connected to ${this.connectionName}`);
            }
            const response = await this.executor.execute({ objectId, method, args }, connection);
            this.addToHistory(method, formatResult(response.result).substring(0, 100), true);
            this.post({
                type: 'apiResult',
                success: true,
                result: response.result,
                resultType: response.resultType,
                executionTimeMs: response.executionTimeMs,
                history: [...this.history]
            });
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.addToHistory(method, text, false);
            this.post({ type: 'apiResult', success: false, error: text, history: [...this.history] });
        }
    }

    private addToHistory(method: string, result: string, success: boolean): void {
        this.history.unshift({ method, result, success, timestamp: new Date().toLocaleTimeString() });
        this.history.splice(HISTORY_SIZE);
    }
}
