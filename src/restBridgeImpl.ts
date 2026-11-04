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

export class RestBridgeImpl extends BridgeImplBase {
    constructor(client: AxiosInstance) {
        super(client, 'rest');
    }

    async getCabinets(sessionId: string): Promise<ObjectInfo[]> {
        const response = await this.client.get('/api/v1/cabinets', { params: { sessionId } });
        return response.data;
    }

    async getFolderContents(sessionId: string, folderId: string, _folderPath?: string): Promise<ObjectInfo[]> {
        const response = await this.client.get(`/api/v1/objects/${folderId}/contents`, { params: { sessionId } });
        return response.data;
    }

    async getUsers(sessionId: string): Promise<UserInfo[]> {
        const response = await this.client.get('/api/v1/users', { params: { sessionId } });
        return response.data;
    }

    async getUser(sessionId: string, userName: string): Promise<UserDetails> {
        const response = await this.client.get(`/api/v1/users/${encodeURIComponent(userName)}`, { params: { sessionId } });
        const restUser = response.data;

        const attributes: AttributeInfo[] = [
            { name: 'user_name', value: restUser.userName, dataType: 'string' },
            { name: 'user_os_name', value: restUser.userOsName, dataType: 'string' },
            { name: 'user_address', value: restUser.userAddress, dataType: 'string' },
            { name: 'user_state', value: restUser.userState, dataType: 'string' },
            { name: 'default_folder', value: restUser.defaultFolder, dataType: 'string' },
            { name: 'user_group_name', value: restUser.userGroupName, dataType: 'string' },
            { name: 'r_is_superuser', value: restUser.superUser, dataType: 'boolean' }
        ].sort((a, b) => a.name.localeCompare(b.name));

        return { ...restUser, attributes };
    }

    async getGroupsForUser(sessionId: string, userName: string): Promise<GroupInfo[]> {
        const response = await this.client.get(`/api/v1/users/${encodeURIComponent(userName)}/groups`, { params: { sessionId } });
        return response.data;
    }

    async getParentGroups(sessionId: string, groupName: string): Promise<GroupInfo[]> {
        const response = await this.client.get(`/api/v1/groups/${encodeURIComponent(groupName)}/parents`, { params: { sessionId } });
        return response.data;
    }

    async getTypeDetails(sessionId: string, typeName: string): Promise<TypeInfo> {
        const response = await this.client.get(`/api/v1/types/${encodeURIComponent(typeName)}`, { params: { sessionId } });
        const data = response.data;

        // The REST bridge may send 'repeating' and 'inherited' instead of 'isRepeating' and 'isInherited'
        return {
            name: data.name,
            superType: data.superType,
            isInternal: data.isInternal ?? false,
            attributes: (data.attributes || []).map((a: Record<string, unknown>) => ({
                name: a.name as string,
                dataType: a.dataType as string,
                length: a.length as number,
                isRepeating: (a.isRepeating ?? a.repeating ?? false) as boolean,
                isInherited: (a.isInherited ?? a.inherited ?? false) as boolean
            }))
        };
    }
}
