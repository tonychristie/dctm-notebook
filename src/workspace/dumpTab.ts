import * as vscode from 'vscode';
import { isObjectId } from '../htmlUtils';
import { NavigationHistory } from '../navigationHistory';
import { RepositoryConnection } from '../repositoryConnection';
import { errorFragment, fetchObjectDump, loadingFragment, renderObjectDump } from '../dumps/objectDump';
import { fetchTypeDump, renderTypeDump } from '../dumps/typeDump';
import { fetchUserDump, renderUserDump } from '../dumps/userDump';
import { fetchGroupDump, renderGroupDump } from '../dumps/groupDump';
import { EntityKind, openEntityQuery } from './entityQuery';

export type DumpTarget =
    | { kind: 'object'; objectId: string }
    | { kind: EntityKind; name: string };

export type DumpRenderer = (connection: RepositoryConnection, target: DumpTarget, refresh: boolean) => Promise<string>;

export interface OpenConnections {
    getOpenConnection(name: string): RepositoryConnection | undefined;
}

export interface DumpContentMessage {
    type: 'dump';
    kind: DumpTarget['kind'];
    html: string;
    objectId: string;
    canGoBack: boolean;
    canGoForward: boolean;
}

export type DumpTabRequest =
    | { command: 'dumpObject'; objectId?: string }
    | { command: 'openType'; typeName?: string }
    | { command: 'openUser'; userName?: string }
    | { command: 'openGroup'; groupName?: string }
    | { command: 'generateDql' }
    | { command: 'refresh' }
    | { command: 'goBack' }
    | { command: 'goForward' }
    | { command: 'copyValue'; value?: string };

export const INVALID_OBJECT_ID_MESSAGE = 'Invalid object ID format. Expected 16 hexadecimal characters.';

export async function renderDumpTarget(connection: RepositoryConnection, target: DumpTarget, refresh: boolean): Promise<string> {
    switch (target.kind) {
        case 'object':
            return renderObjectDump(await fetchObjectDump(connection, target.objectId));
        case 'type':
            return renderTypeDump(await fetchTypeDump(connection, target.name, refresh));
        case 'user':
            return renderUserDump(await fetchUserDump(connection, target.name, refresh));
        case 'group':
            return renderGroupDump(await fetchGroupDump(connection, target.name, refresh));
    }
}

function targetKey(target: DumpTarget): string {
    return target.kind === 'object' ? target.objectId : target.name;
}

export class DumpTab {
    private readonly history = new NavigationHistory<DumpTarget>();
    private latestRequest = 0;
    private content: DumpContentMessage | undefined;

    constructor(
        private readonly connectionName: string,
        private readonly connections: OpenConnections,
        private readonly post: (message: DumpContentMessage) => void,
        private readonly render: DumpRenderer = renderDumpTarget
    ) {
    }

    show(target: DumpTarget): Promise<void> {
        return this.load(target, true, false);
    }

    async back(): Promise<void> {
        const target = this.history.back();
        if (target) {
            await this.load(target, false, false);
        }
    }

    async forward(): Promise<void> {
        const target = this.history.forward();
        if (target) {
            await this.load(target, false, false);
        }
    }

    async refresh(): Promise<void> {
        const target = this.history.current();
        if (target) {
            await this.load(target, false, true);
        }
    }

    ready(): void {
        if (this.content) {
            this.post(this.content);
        }
    }

    async handleMessage(message: DumpTabRequest): Promise<void> {
        switch (message.command) {
            case 'dumpObject': {
                const objectId = message.objectId?.trim() ?? '';
                if (!isObjectId(objectId)) {
                    vscode.window.showWarningMessage(INVALID_OBJECT_ID_MESSAGE);
                    return;
                }
                await this.show({ kind: 'object', objectId });
                break;
            }
            case 'openType':
                await this.showEntity('type', message.typeName);
                break;
            case 'openUser':
                await this.showEntity('user', message.userName);
                break;
            case 'openGroup':
                await this.showEntity('group', message.groupName);
                break;
            case 'generateDql':
                await this.generateQuery();
                break;
            case 'refresh':
                await this.refresh();
                break;
            case 'goBack':
                await this.back();
                break;
            case 'goForward':
                await this.forward();
                break;
            case 'copyValue':
                await vscode.env.clipboard.writeText(message.value ?? '');
                vscode.window.showInformationMessage('Value copied to clipboard');
                break;
        }
    }

    private async showEntity(kind: EntityKind, name: string | undefined): Promise<void> {
        if (name) {
            await this.show({ kind, name });
        }
    }

    private async generateQuery(): Promise<void> {
        const target = this.history.current();
        if (target && target.kind !== 'object') {
            const connection = this.connections.getOpenConnection(this.connectionName);
            await openEntityQuery(connection, this.connectionName, target.kind, target.name);
        }
    }

    private async load(target: DumpTarget, addToHistory: boolean, refresh: boolean): Promise<void> {
        const request = ++this.latestRequest;
        this.postContent(target, loadingFragment(target.kind));

        let html: string;
        try {
            const connection = this.connections.getOpenConnection(this.connectionName);
            if (!connection) {
                throw new Error(`Not connected to ${this.connectionName}`);
            }
            html = await this.render(connection, target, refresh);
        } catch (error) {
            html = errorFragment(target.kind, targetKey(target), error instanceof Error ? error.message : String(error));
        }

        if (request !== this.latestRequest) {
            return;
        }
        if (addToHistory) {
            this.history.add(target);
        }
        this.postContent(target, html);
    }

    private postContent(target: DumpTarget, html: string): void {
        this.content = {
            type: 'dump',
            kind: target.kind,
            html,
            objectId: target.kind === 'object' ? target.objectId : '',
            canGoBack: this.history.canGoBack(),
            canGoForward: this.history.canGoForward()
        };
        this.post(this.content);
    }
}
