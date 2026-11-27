import * as vscode from 'vscode';
import { EntityCache } from '../entityCache';
import { EntityItem } from '../entityList';
import { RepositoryConnection } from '../repositoryConnection';
import { DumpTarget, OpenConnections } from './dumpTab';
import { EntityKind } from './entityQuery';

export type EntityTabName = 'types' | 'users' | 'groups';

export interface EntityTabConfig {
    tab: EntityTabName;
    kind: EntityKind;
    plural: string;
    cache(connection: RepositoryConnection): EntityCache<unknown>;
    items(connection: RepositoryConnection): EntityItem[];
}

export const ENTITY_TABS: Record<EntityTabName, EntityTabConfig> = {
    types: {
        tab: 'types',
        kind: 'type',
        plural: 'types',
        cache: connection => connection.typeCache,
        items: ({ typeCache }) => typeCache.getNames().map(name => ({
            name,
            parent: typeCache.get(name)?.superType ?? undefined
        }))
    },
    users: {
        tab: 'users',
        kind: 'user',
        plural: 'users',
        cache: connection => connection.userCache,
        items: connection => connection.userCache.getNames().map(name => ({ name }))
    },
    groups: {
        tab: 'groups',
        kind: 'group',
        plural: 'groups',
        cache: connection => connection.groupCache,
        items: connection => connection.groupCache.getNames().map(name => ({ name }))
    }
};

export function isEntityTabName(value: unknown): value is EntityTabName {
    return value === 'types' || value === 'users' || value === 'groups';
}

export type EntityRequest =
    | { command: 'load'; requestId: number }
    | { command: 'refresh'; requestId: number }
    | { command: 'open'; name: string };

export type EntityMessage =
    | { type: 'entities'; tab: EntityTabName; requestId?: number; items: EntityItem[] }
    | { type: 'entities'; tab: EntityTabName; requestId?: number; error: string };

export class EntityTab implements vscode.Disposable {
    private subscription: vscode.Disposable | undefined;

    constructor(
        private readonly connectionName: string,
        private readonly connections: OpenConnections,
        readonly config: EntityTabConfig,
        private readonly post: (message: EntityMessage) => void,
        private readonly openDump: (target: DumpTarget) => Promise<void>
    ) {
    }

    // A reopened connection has a new cache, so the subscription follows the open connection.
    watch(connection: RepositoryConnection | undefined): void {
        this.subscription?.dispose();
        this.subscription = connection
            ? this.config.cache(connection).onRefresh(() => this.postItems(connection))
            : undefined;
    }

    dispose(): void {
        this.watch(undefined);
    }

    async handleMessage(message: EntityRequest): Promise<void> {
        if (message.command === 'open') {
            await this.openDump({ kind: this.config.kind, name: message.name });
            return;
        }

        const { plural } = this.config;
        const connection = this.connections.getOpenConnection(this.connectionName);
        if (!connection) {
            this.postError(message.requestId, `Unable to load ${plural}: Not connected to ${this.connectionName}`);
            return;
        }

        const cache = this.config.cache(connection);
        const refresh = message.command === 'refresh';
        try {
            if (refresh || cache.getLastRefresh() === null) {
                await cache.refresh();
            }
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.postError(message.requestId, `Unable to load ${plural}: ${text}`);
            return;
        }

        this.postItems(connection, message.requestId);
        if (refresh) {
            vscode.window.showInformationMessage(`${cache.getCount()} ${plural} loaded`);
        }
    }

    private postItems(connection: RepositoryConnection, requestId?: number): void {
        this.post({ type: 'entities', tab: this.config.tab, requestId, items: this.config.items(connection) });
    }

    private postError(requestId: number, error: string): void {
        this.post({ type: 'entities', tab: this.config.tab, requestId, error });
    }
}
