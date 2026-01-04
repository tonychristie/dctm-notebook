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
    | 'types-container'
    | 'users-container'
    | 'groups-container'
    | 'cabinet'
    | 'folder'
    | 'document'
    | 'type'
    | 'user'
    | 'group';

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
 * Container node data (Cabinets, Types, Users, Groups)
 */
export interface ContainerNodeData extends NodeData {
    type: 'cabinets-container' | 'types-container' | 'users-container' | 'groups-container';
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
 * Type node data
 */
export interface TypeNodeData extends NodeData {
    type: 'type';
    typeName: string;
    superType?: string;
    isSystemType: boolean;
    connectionName: string;
}

/**
 * User node data
 */
export interface UserNodeData extends NodeData {
    type: 'user';
    userName: string;
    userLoginName: string;
    connectionName: string;
}

/**
 * Group node data
 */
export interface GroupNodeData extends NodeData {
    type: 'group';
    groupName: string;
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
    | DocumentNodeData
    | TypeNodeData
    | UserNodeData
    | GroupNodeData;

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
            case 'type':
                const typeData = this.data as TypeNodeData;
                return `${typeData.typeName}${typeData.superType ? `\nSuper: ${typeData.superType}` : ''}\n${typeData.isSystemType ? 'System type' : 'Custom type'}`;
            case 'user':
                const userData = this.data as UserNodeData;
                return `${userData.userName}\nLogin: ${userData.userLoginName}`;
            case 'group':
                const groupData = this.data as GroupNodeData;
                return groupData.groupName;
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
            case 'types-container':
                return new vscode.ThemeIcon('symbol-class');
            case 'users-container':
                return new vscode.ThemeIcon('organization');
            case 'groups-container':
                return new vscode.ThemeIcon('people');
            case 'cabinet':
                return new vscode.ThemeIcon('archive');
            case 'folder':
                return new vscode.ThemeIcon('folder');
            case 'document':
                return this.getDocumentIcon();
            case 'type':
                const typeData = this.data as TypeNodeData;
                return new vscode.ThemeIcon(
                    typeData.isSystemType ? 'symbol-class' : 'symbol-struct'
                );
            case 'user':
                return new vscode.ThemeIcon('person');
            case 'group':
                return new vscode.ThemeIcon('organization');
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
            case 'type':
                const typeData = this.data as TypeNodeData;
                return typeData.superType;
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
 * Escape a string for use in DQL queries.
 * Escapes single quotes by doubling them to prevent SQL injection.
 *
 * @param value The string to escape
 * @returns The escaped string safe for use in DQL
 */
export function escapeDqlString(value: string): string {
    if (!value) {
        return value;
    }
    return value.replace(/'/g, "''");
}
