import { AxiosInstance } from 'axios';
import {
    ObjectInfo,
    UserInfo,
    UserDetails,
    GroupInfo,
    AttributeInfo,
    TypeInfo
} from './bridgeTypes';
import { BridgeImplBase } from './bridgeImplBase';
import { quoteDqlString } from './dqlQueries';

const SUPERUSER_PRIVILEGE = 16;

function isSuperUser(userPrivileges: unknown): boolean {
    return ((userPrivileges as number) & SUPERUSER_PRIVILEGE) !== 0;
}

export class DfcBridgeImpl extends BridgeImplBase {
    constructor(client: AxiosInstance) {
        super(client, 'dfc');
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

        const quotedPath = quoteDqlString(folderPath);
        const folderQuery = `SELECT r_object_id, object_name FROM dm_folder WHERE folder(${quotedPath}) ORDER BY object_name`;
        const docQuery = `SELECT r_object_id, object_name, r_object_type, a_content_type FROM dm_sysobject WHERE folder(${quotedPath}) AND NOT TYPE(dm_folder) ORDER BY object_name`;

        const [folderResults, docResults] = await Promise.all([
            this.executeDql(sessionId, folderQuery),
            this.executeDql(sessionId, docQuery)
        ]);

        const folders: ObjectInfo[] = folderResults.rows.map(row => ({
            objectId: row.r_object_id as string,
            type: 'dm_folder',
            name: row.object_name as string,
            attributes: {}
        }));

        const documents: ObjectInfo[] = docResults.rows.map(row => ({
            objectId: row.r_object_id as string,
            type: row.r_object_type as string,
            name: row.object_name as string,
            attributes: { a_content_type: row.a_content_type }
        }));

        return [...folders, ...documents];
    }

    async getUsers(sessionId: string): Promise<UserInfo[]> {
        // dm_user holds groups as well as users
        const query = `SELECT r_object_id, user_name, user_login_name, user_os_name, user_address,
            user_state, user_source, default_folder, user_group_name, description, user_privileges
            FROM dm_user
            WHERE r_is_group = false
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
            superUser: isSuperUser(row.user_privileges),
            userLoginName: row.user_login_name as string || '',
            userSource: row.user_source as string || '',
            description: row.description as string || ''
        }));
    }

    async getUser(sessionId: string, userName: string): Promise<UserDetails> {
        const query = `SELECT * FROM dm_user WHERE user_name = ${quoteDqlString(userName)} AND r_is_group = false`;
        const result = await this.executeDql(sessionId, query);

        if (result.rows.length === 0) {
            throw new Error(`User not found: ${userName}`);
        }

        const row = result.rows[0];

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
            superUser: isSuperUser(row.user_privileges),
            userLoginName: row.user_login_name as string || '',
            userSource: row.user_source as string || '',
            description: row.description as string || '',
            attributes
        };
    }

    async getGroupsForUser(sessionId: string, userName: string): Promise<GroupInfo[]> {
        const query = `SELECT r_object_id, group_name FROM dm_group WHERE any users_names = ${quoteDqlString(userName)}`;
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
        const query = `SELECT r_object_id, group_name FROM dm_group WHERE any groups_names = ${quoteDqlString(groupName)}`;
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

    async getTypeDetails(sessionId: string, typeName: string): Promise<TypeInfo> {
        const response = await this.client.get(`/api/v1/types/${encodeURIComponent(typeName)}`, { params: { sessionId } });
        return response.data;
    }
}
