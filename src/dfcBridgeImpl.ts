/**
 * DFC Bridge Implementation
 *
 * Pure DFC/DQL implementation of the unified bridge interface.
 * Uses DQL queries via the DFC Bridge microservice.
 *
 * This class contains NO connection type checking - it assumes
 * all calls are for DFC sessions. The routing happens at a higher level.
 */

import { AxiosInstance } from 'axios';
import {
    IUnifiedBridge,
    ObjectInfo,
    UserInfo,
    UserDetails,
    GroupInfo,
    GroupDetails,
    AttributeInfo
} from './bridgeTypes';

export class DfcBridgeImpl implements IUnifiedBridge {
    constructor(private client: AxiosInstance) {}

    /**
     * Execute a DQL query and return the result.
     */
    private async executeDql(sessionId: string, query: string): Promise<{
        columns: string[];
        rows: Record<string, unknown>[];
        rowCount: number;
    }> {
        const response = await this.client.post('/api/v1/dql', { sessionId, query });

        // Bridge returns columns as ColumnInfo objects, extract just the names
        const columns = (response.data.columns || []).map(
            (col: { name: string }) => col.name
        );

        return {
            columns,
            rows: response.data.rows || [],
            rowCount: response.data.rowCount || 0
        };
    }

    async getCabinets(sessionId: string): Promise<ObjectInfo[]> {
        const query = "SELECT r_object_id, object_name FROM dm_cabinet ORDER BY object_name";
        const result = await this.executeDql(sessionId, query);

        return result.rows.map(row => ({
            objectId: row.r_object_id as string,
            type: 'dm_cabinet',
            name: row.object_name as string,
            attributes: {}
        }));
    }

    async getFolderContents(sessionId: string, _folderId: string, folderPath?: string): Promise<ObjectInfo[]> {
        if (!folderPath) {
            throw new Error('folderPath is required for DFC sessions');
        }

        const items: ObjectInfo[] = [];

        // Escape path for DQL
        const escapedPath = folderPath.replace(/'/g, "''");

        // Get subfolders
        const folderQuery = `SELECT r_object_id, object_name FROM dm_folder WHERE folder('${escapedPath}') ORDER BY object_name`;
        const folderResults = await this.executeDql(sessionId, folderQuery);

        for (const row of folderResults.rows) {
            items.push({
                objectId: row.r_object_id as string,
                type: 'dm_folder',
                name: row.object_name as string,
                attributes: {}
            });
        }

        // Get documents (non-folder sysobjects)
        const docQuery = `SELECT r_object_id, object_name, r_object_type, a_content_type FROM dm_sysobject WHERE folder('${escapedPath}') AND r_object_type != 'dm_folder' ORDER BY object_name`;
        const docResults = await this.executeDql(sessionId, docQuery);

        for (const row of docResults.rows) {
            items.push({
                objectId: row.r_object_id as string,
                type: row.r_object_type as string,
                name: row.object_name as string,
                attributes: { a_content_type: row.a_content_type }
            });
        }

        return items;
    }

    async getUsers(sessionId: string, _pattern?: string): Promise<UserInfo[]> {
        // r_is_group = false filters out groups (dm_user table contains both users and groups)
        const query = `SELECT r_object_id, user_name, user_login_name, user_os_name, user_address,
            user_state, user_source, default_folder, user_group_name, description
            FROM dm_user
            WHERE user_state = 0 AND r_is_group = false
            ORDER BY user_name`;

        const result = await this.executeDql(sessionId, query);

        return result.rows.map(row => ({
            objectId: row.r_object_id as string,
            userName: row.user_name as string,
            userOsName: row.user_os_name as string || '',
            userAddress: row.user_address as string || '',
            userState: String(row.user_state || 0),
            defaultFolder: row.default_folder as string || '',
            userGroupName: row.user_group_name as string || '',
            superUser: false,
            userLoginName: row.user_login_name as string || '',
            userSource: row.user_source as string || '',
            description: row.description as string || ''
        }));
    }

    async getUser(sessionId: string, userName: string): Promise<UserDetails> {
        // Fetch all user attributes
        const query = `SELECT * FROM dm_user WHERE user_name = '${userName.replace(/'/g, "''")}' AND r_is_group = false`;
        const result = await this.executeDql(sessionId, query);

        if (result.rows.length === 0) {
            throw new Error(`User not found: ${userName}`);
        }

        const row = result.rows[0];

        // Build attributes array
        const attributes: AttributeInfo[] = [];
        for (const [key, value] of Object.entries(row)) {
            attributes.push({ name: key, value, dataType: typeof value });
        }
        attributes.sort((a, b) => a.name.localeCompare(b.name));

        return {
            objectId: row.r_object_id as string,
            userName: row.user_name as string,
            userOsName: row.user_os_name as string || '',
            userAddress: row.user_address as string || '',
            userState: String(row.user_state || 0),
            defaultFolder: row.default_folder as string || '',
            userGroupName: row.user_group_name as string || '',
            superUser: row.r_is_superuser as boolean || false,
            attributes
        };
    }

    async getGroups(sessionId: string, _pattern?: string): Promise<GroupInfo[]> {
        const query = `SELECT r_object_id, group_name, group_address, group_source, description,
            group_class, group_admin, owner_name, is_private, is_dynamic
            FROM dm_group
            ORDER BY group_name`;

        const result = await this.executeDql(sessionId, query);

        return result.rows.map(row => ({
            objectId: row.r_object_id as string,
            groupName: row.group_name as string,
            description: row.description as string || '',
            groupClass: row.group_class as string || '',
            groupAdmin: row.group_admin as string || '',
            isPrivate: row.is_private as boolean || false,
            usersNames: [],
            groupsNames: [],
            groupAddress: row.group_address as string || '',
            groupSource: row.group_source as string || '',
            ownerName: row.owner_name as string || '',
            isDynamic: row.is_dynamic as boolean || false
        }));
    }

    async getGroup(sessionId: string, groupName: string): Promise<GroupDetails> {
        // Fetch all group attributes
        const query = `SELECT * FROM dm_group WHERE group_name = '${groupName.replace(/'/g, "''")}'`;
        const result = await this.executeDql(sessionId, query);

        if (result.rows.length === 0) {
            throw new Error(`Group not found: ${groupName}`);
        }

        const row = result.rows[0];

        // Build attributes array
        const attributes: AttributeInfo[] = [];
        for (const [key, value] of Object.entries(row)) {
            if (key !== 'users_names' && key !== 'groups_names') {
                attributes.push({ name: key, value, dataType: typeof value });
            }
        }
        attributes.sort((a, b) => a.name.localeCompare(b.name));

        // Get members (users_names is repeating)
        let usersNames: string[] = [];
        if (row.users_names) {
            if (Array.isArray(row.users_names)) {
                usersNames = row.users_names as string[];
            } else if (typeof row.users_names === 'string') {
                usersNames = [row.users_names];
            }
        }

        // Get group members (groups_names is repeating)
        let groupsNames: string[] = [];
        if (row.groups_names) {
            if (Array.isArray(row.groups_names)) {
                groupsNames = row.groups_names as string[];
            } else if (typeof row.groups_names === 'string') {
                groupsNames = [row.groups_names];
            }
        }

        return {
            objectId: row.r_object_id as string,
            groupName: row.group_name as string,
            description: row.description as string || '',
            groupClass: row.group_class as string || '',
            groupAdmin: row.group_admin as string || '',
            isPrivate: row.is_private as boolean || false,
            usersNames: usersNames.sort(),
            groupsNames: groupsNames.sort(),
            attributes
        };
    }

    async getGroupsForUser(sessionId: string, userName: string): Promise<GroupInfo[]> {
        const query = `SELECT r_object_id, group_name FROM dm_group WHERE any users_names = '${userName.replace(/'/g, "''")}'`;
        const result = await this.executeDql(sessionId, query);

        return result.rows.map(row => ({
            objectId: row.r_object_id as string,
            groupName: row.group_name as string,
            description: '',
            groupClass: '',
            groupAdmin: '',
            isPrivate: false,
            usersNames: [],
            groupsNames: []
        }));
    }

    async getParentGroups(sessionId: string, groupName: string): Promise<GroupInfo[]> {
        const query = `SELECT r_object_id, group_name FROM dm_group WHERE any groups_names = '${groupName.replace(/'/g, "''")}'`;
        const result = await this.executeDql(sessionId, query);

        return result.rows.map(row => ({
            objectId: row.r_object_id as string,
            groupName: row.group_name as string,
            description: '',
            groupClass: '',
            groupAdmin: '',
            isPrivate: false,
            usersNames: [],
            groupsNames: []
        }));
    }
}
