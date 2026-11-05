import * as vscode from 'vscode';

/**
 * Base interface for all tree node data
 */
export interface NodeData {
    id: string;
    name: string;
    type: NodeType;
}

/**
 * Types of nodes in the object browser tree
 */
export type NodeType =
    | 'connection'
    | 'cabinets-container'
    | 'cabinet'
    | 'folder'
    | 'document';

/**
 * Connection node data
 */
export interface ConnectionNodeData extends NodeData {
    type: 'connection';
    connectionName: string;
    repository: string;
    connected: boolean;
    username?: string;
}

/**
 * Container node data
 */
export interface ContainerNodeData extends NodeData {
    type: 'cabinets-container';
    connectionName: string;
}

/**
 * Cabinet node data
 */
export interface CabinetNodeData extends NodeData {
    type: 'cabinet';
    objectId: string;
    path: string;
    connectionName: string;
}

/**
 * Folder node data
 */
export interface FolderNodeData extends NodeData {
    type: 'folder';
    objectId: string;
    path: string;
    parentId: string;
    connectionName: string;
}

/**
 * Document node data
 */
export interface DocumentNodeData extends NodeData {
    type: 'document';
    objectId: string;
    objectType: string;
    format?: string;
    contentSize?: number;
    parentId: string;
    connectionName: string;
}

/**
 * Union type for all node data types
 */
export type AnyNodeData =
    | ConnectionNodeData
    | ContainerNodeData
    | CabinetNodeData
    | FolderNodeData
    | DocumentNodeData;

/**
 * Tree item representing a node in the object browser
 */
export class ObjectBrowserItem extends vscode.TreeItem {
    constructor(
        public readonly data: AnyNodeData,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState
    ) {
        super(data.name, collapsibleState);
        this.contextValue = this.getContextValue();
        this.id = data.id;
        this.tooltip = this.getTooltip();
        this.iconPath = this.getIcon();
        this.description = this.getDescription();

        // Set command for clickable items
        if (data.type === 'document') {
            this.command = {
                command: 'dctm.showObjectProperties',
                title: 'Show Properties',
                arguments: [data]
            };
        }
    }

    /**
     * Get context value for menus - connections include connected/disconnected suffix
     */
    private getContextValue(): string {
        if (this.data.type === 'connection') {
            const connData = this.data as ConnectionNodeData;
            return connData.connected ? 'connection-connected' : 'connection-disconnected';
        }
        return this.data.type;
    }

    private getTooltip(): string {
        switch (this.data.type) {
            case 'connection':
                const connData = this.data as ConnectionNodeData;
                const userInfo = connData.connected && connData.username ? `\nUser: ${connData.username}` : '';
                return `${connData.connectionName}\nRepository: ${connData.repository}${userInfo}\nStatus: ${connData.connected ? 'Connected' : 'Disconnected'}`;
            case 'cabinet':
            case 'folder':
                const folderData = this.data as CabinetNodeData | FolderNodeData;
                return `${folderData.path}\nID: ${folderData.objectId}`;
            case 'document':
                const docData = this.data as DocumentNodeData;
                return `${docData.name}\nType: ${docData.objectType}\nFormat: ${docData.format || 'unknown'}\nID: ${docData.objectId}`;
            default:
                return this.data.name;
        }
    }

    private getIcon(): vscode.ThemeIcon {
        switch (this.data.type) {
            case 'connection':
                const connData = this.data as ConnectionNodeData;
                return new vscode.ThemeIcon(
                    connData.connected ? 'database' : 'debug-disconnect',
                    connData.connected ? undefined : new vscode.ThemeColor('errorForeground')
                );
            case 'cabinets-container':
                return new vscode.ThemeIcon('folder-library');
            case 'cabinet':
                return new vscode.ThemeIcon('archive');
            case 'folder':
                return new vscode.ThemeIcon('folder');
            case 'document':
                return this.getDocumentIcon();
            default:
                return new vscode.ThemeIcon('circle-outline');
        }
    }

    private getDocumentIcon(): vscode.ThemeIcon {
        const docData = this.data as DocumentNodeData;
        const format = docData.format?.toLowerCase() ?? '';

        // Format pattern to icon mapping
        const iconMappings: Array<{ patterns: string[]; icon: string }> = [
            { patterns: ['pdf'], icon: 'file-pdf' },
            { patterns: ['word', 'doc', 'docx', 'text', 'txt', 'excel', 'xls', 'xlsx'], icon: 'file-text' },
            { patterns: ['image', 'jpg', 'jpeg', 'png', 'gif', 'bmp'], icon: 'file-media' },
            { patterns: ['xml', 'html'], icon: 'file-code' },
            { patterns: ['zip', 'rar', 'tar'], icon: 'file-zip' }
        ];

        for (const { patterns, icon } of iconMappings) {
            if (patterns.some(p => format.includes(p) || format === p)) {
                return new vscode.ThemeIcon(icon);
            }
        }

        return new vscode.ThemeIcon('file');
    }

    private getDescription(): string | undefined {
        switch (this.data.type) {
            case 'connection':
                const connData = this.data as ConnectionNodeData;
                if (connData.connected && connData.username) {
                    return `${connData.repository} (${connData.username})`;
                }
                return connData.connected ? connData.repository : 'disconnected';
            case 'document':
                const docData = this.data as DocumentNodeData;
                return docData.format;
            default:
                return undefined;
        }
    }
}

/**
 * Helper to create unique node IDs
 */
export function createNodeId(connectionName: string, type: NodeType, identifier: string): string {
    return `${connectionName}::${type}::${identifier}`;
}

/**
 * An object linked into several folders appears once under each, so its id carries the parent chain.
 */
export function createChildNodeId(parentNodeId: string, objectId: string): string {
    return `${parentNodeId}/${objectId}`;
}

export function compareFolderContentNodes(a: NodeData, b: NodeData): number {
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
