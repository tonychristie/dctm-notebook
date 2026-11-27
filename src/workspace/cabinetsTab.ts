import { ObjectInfo } from '../bridgeTypes';
import { DumpTarget, OpenConnections } from './dumpTab';

export type CabinetNodeType = 'cabinet' | 'folder' | 'document';

const documentIconMappings: Array<{ patterns: string[]; icon: string }> = [
    { patterns: ['pdf'], icon: 'file-pdf' },
    { patterns: ['word', 'doc', 'docx', 'text', 'txt', 'excel', 'xls', 'xlsx'], icon: 'file-text' },
    { patterns: ['image', 'jpg', 'jpeg', 'png', 'gif', 'bmp'], icon: 'file-media' },
    { patterns: ['xml', 'html'], icon: 'file-code' },
    { patterns: ['zip', 'rar', 'tar'], icon: 'file-zip' }
];

function documentIconName(format: string | undefined): string {
    const lowerFormat = format?.toLowerCase() ?? '';
    const mapping = documentIconMappings.find(({ patterns }) => patterns.some(p => lowerFormat.includes(p)));
    return mapping?.icon ?? 'file';
}

/**
 * An object linked into several folders appears once under each, so its id carries the parent chain.
 */
export function createChildNodeId(parentNodeId: string, objectId: string): string {
    return `${parentNodeId}/${objectId}`;
}

export function compareFolderContentNodes(
    a: { name: string; type: CabinetNodeType },
    b: { name: string; type: CabinetNodeType }
): number {
    const aIsFolder = a.type === 'folder';
    if (aIsFolder !== (b.type === 'folder')) {
        return aIsFolder ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
}

/**
 * The object id prefix comes from the base type: 0b for dm_folder and its subtypes, 0c for dm_cabinet.
 */
export function isFolderObjectId(objectId: string): boolean {
    const prefix = objectId.substring(0, 2).toLowerCase();
    return prefix === '0b' || prefix === '0c';
}

export interface CabinetNodeContext {
    webviewSection: CabinetNodeType;
    connectionName: string;
    objectId: string;
    nodeId: string;
}

export interface CabinetNode {
    id: string;
    name: string;
    type: CabinetNodeType;
    objectId: string;
    path?: string;
    label: string;
    icon: string;
    expandable: boolean;
    description?: string;
    tooltip: string;
    context: CabinetNodeContext;
}

export interface CabinetParent {
    id: string;
    objectId: string;
    path: string;
}

export type CabinetsRequest =
    | { command: 'loadCabinets'; requestId: number }
    | { command: 'loadChildren'; requestId: number; nodeId: string; objectId: string; path: string }
    | { command: 'open'; objectId: string };

export type CabinetsMessage =
    | { type: 'cabinetsResult'; requestId: number; nodes: CabinetNode[] }
    | { type: 'cabinetsResult'; requestId: number; error: string }
    | { type: 'refreshNode'; nodeId: string };

function node(
    connectionName: string,
    id: string,
    type: CabinetNodeType,
    info: ObjectInfo,
    fields: Pick<CabinetNode, 'icon' | 'tooltip' | 'path' | 'description'>
): CabinetNode {
    return {
        id,
        name: info.name,
        type,
        objectId: info.objectId,
        label: info.name,
        expandable: type !== 'document',
        context: { webviewSection: type, connectionName, objectId: info.objectId, nodeId: id },
        ...fields
    };
}

export function cabinetNodes(connectionName: string, cabinets: ObjectInfo[]): CabinetNode[] {
    return cabinets.map(cabinet => {
        const path = '/' + cabinet.name;
        return node(connectionName, `${connectionName}::cabinet::${cabinet.objectId}`, 'cabinet', cabinet, {
            icon: 'archive',
            path,
            tooltip: `${path}\nID: ${cabinet.objectId}`
        });
    });
}

export function folderContentNodes(connectionName: string, parent: CabinetParent, contents: ObjectInfo[]): CabinetNode[] {
    return contents
        .map(item => {
            const id = createChildNodeId(parent.id, item.objectId);
            if (isFolderObjectId(item.objectId)) {
                const path = parent.path + '/' + item.name;
                return node(connectionName, id, 'folder', item, {
                    icon: 'folder',
                    path,
                    tooltip: `${path}\nID: ${item.objectId}`
                });
            }
            const format = item.attributes?.a_content_type as string | undefined;
            return node(connectionName, id, 'document', item, {
                icon: documentIconName(format),
                description: format,
                tooltip: `${item.name}\nType: ${item.type}\nFormat: ${format || 'unknown'}\nID: ${item.objectId}`
            });
        })
        .sort(compareFolderContentNodes);
}

export class CabinetsTab {
    constructor(
        private readonly connectionName: string,
        private readonly connections: OpenConnections,
        private readonly post: (message: CabinetsMessage) => void,
        private readonly openDump: (target: DumpTarget) => Promise<void>
    ) {
    }

    refreshFolder(nodeId: string): void {
        this.post({ type: 'refreshNode', nodeId });
    }

    async handleMessage(message: CabinetsRequest): Promise<void> {
        if (message.command === 'open') {
            await this.openDump({ kind: 'object', objectId: message.objectId });
            return;
        }

        try {
            const nodes = message.command === 'loadCabinets'
                ? await this.loadCabinets()
                : await this.loadChildren({ id: message.nodeId, objectId: message.objectId, path: message.path });
            this.post({ type: 'cabinetsResult', requestId: message.requestId, nodes });
        } catch (error) {
            const text = error instanceof Error ? error.message : String(error);
            this.post({ type: 'cabinetsResult', requestId: message.requestId, error: text });
        }
    }

    private async loadCabinets(): Promise<CabinetNode[]> {
        const connection = this.openConnection();
        return cabinetNodes(this.connectionName, await connection.bridge.getCabinets(connection.sessionId));
    }

    private async loadChildren(parent: CabinetParent): Promise<CabinetNode[]> {
        const connection = this.openConnection();
        const contents = await connection.bridge.getFolderContents(connection.sessionId, parent.objectId, parent.path);
        return folderContentNodes(this.connectionName, parent, contents);
    }

    private openConnection() {
        const connection = this.connections.getOpenConnection(this.connectionName);
        if (!connection) {
            throw new Error(`Not connected to ${this.connectionName}`);
        }
        return connection;
    }
}
