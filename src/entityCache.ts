import * as vscode from 'vscode';
import { DctmBridge } from './dctmBridge';

export abstract class EntityCache<T> {
    private entries = new Map<string, T>();
    private names: string[] = [];
    private lastRefresh: Date | null = null;
    private refreshPromise: Promise<void> | null = null;

    private readonly refreshEmitter = new vscode.EventEmitter<void>();
    readonly onRefresh: vscode.Event<void> = this.refreshEmitter.event;

    constructor(
        protected readonly bridge: DctmBridge,
        protected readonly sessionId: string
    ) {}

    protected abstract fetchAll(): Promise<T[]>;

    protected abstract nameOf(entry: T): string;

    dispose(): void {
        this.refreshEmitter.dispose();
    }

    refresh(): Promise<void> {
        if (!this.refreshPromise) {
            this.refreshPromise = this.load().finally(() => {
                this.refreshPromise = null;
            });
        }
        return this.refreshPromise;
    }

    hasData(): boolean {
        return this.entries.size > 0;
    }

    get(name: string): T | undefined {
        return this.entries.get(name.toLowerCase());
    }

    getNames(): string[] {
        return this.names;
    }

    search(pattern: string): string[] {
        const lowerPattern = pattern.toLowerCase();
        return this.names.filter(name => name.toLowerCase().includes(lowerPattern));
    }

    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    getCount(): number {
        return this.entries.size;
    }

    protected setEntry(entry: T): void {
        this.entries.set(this.nameOf(entry).toLowerCase(), entry);
    }

    private async load(): Promise<void> {
        const fetched = await this.fetchAll();

        const entries = new Map<string, T>();
        for (const entry of fetched) {
            entries.set(this.nameOf(entry).toLowerCase(), entry);
        }
        const names = fetched.map(entry => this.nameOf(entry)).sort();

        this.entries = entries;
        this.names = names;
        this.lastRefresh = new Date();
        this.refreshEmitter.fire();
    }
}
