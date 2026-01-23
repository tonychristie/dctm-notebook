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
    AttributeInfo,
    TypeSummary,
    TypeInfo
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
        // Use the dedicated /groups endpoint which properly handles repeating attributes
        const response = await this.client.get('/api/v1/groups', { params: { sessionId } });
        return response.data;
    }

    async getGroup(sessionId: string, groupName: string): Promise<GroupDetails> {
        // Use the dedicated /groups/{name} endpoint which properly handles repeating attributes
        const response = await this.client.get(`/api/v1/groups/${encodeURIComponent(groupName)}`, { params: { sessionId } });
        const group = response.data;

        // Build attributes array from response (matching RestBridgeImpl pattern)
        const attributes: AttributeInfo[] = [
            { name: 'group_name', value: group.groupName, dataType: 'string' },
            { name: 'description', value: group.description, dataType: 'string' },
            { name: 'group_class', value: group.groupClass, dataType: 'string' },
            { name: 'group_admin', value: group.groupAdmin, dataType: 'string' },
            { name: 'is_private', value: group.isPrivate, dataType: 'boolean' },
            { name: 'owner_name', value: group.ownerName, dataType: 'string' },
            { name: 'group_address', value: group.groupAddress, dataType: 'string' },
            { name: 'group_source', value: group.groupSource, dataType: 'string' },
            { name: 'is_dynamic', value: group.isDynamic, dataType: 'boolean' }
        ].sort((a, b) => a.name.localeCompare(b.name));

        return { ...group, attributes };
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

    async getTypes(sessionId: string): Promise<TypeSummary[]> {
        const response = await this.client.get('/api/v1/types', { params: { sessionId } });
        return response.data;
    }

    async getTypeDetails(sessionId: string, typeName: string): Promise<TypeInfo> {
        const response = await this.client.get(`/api/v1/types/${encodeURIComponent(typeName)}`, { params: { sessionId } });
        return response.data;
    }
}
