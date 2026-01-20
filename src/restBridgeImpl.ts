/**
 * REST Bridge Implementation
 *
 * Pure REST implementation of the unified bridge interface.
 * Uses REST endpoints via the REST Bridge microservice.
 *
 * This class contains NO connection type checking - it assumes
 * all calls are for REST sessions. The routing happens at a higher level.
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

export class RestBridgeImpl implements IUnifiedBridge {
    constructor(private client: AxiosInstance) {}

    async getCabinets(sessionId: string): Promise<ObjectInfo[]> {
        const response = await this.client.get('/api/v1/cabinets', { params: { sessionId } });
        return response.data;
    }

    async getFolderContents(sessionId: string, folderId: string, _folderPath?: string): Promise<ObjectInfo[]> {
        // REST API uses folder ID directly - path is not needed
        const response = await this.client.get(`/api/v1/objects/${folderId}/contents`, { params: { sessionId } });
        return response.data;
    }

    async getUsers(sessionId: string, pattern?: string): Promise<UserInfo[]> {
        const params: Record<string, string> = { sessionId };
        if (pattern) {
            params.pattern = pattern;
        }
        const response = await this.client.get('/api/v1/users', { params });
        return response.data;
    }

    async getUser(sessionId: string, userName: string): Promise<UserDetails> {
        const response = await this.client.get(`/api/v1/users/${encodeURIComponent(userName)}`, { params: { sessionId } });
        const restUser = response.data;

        // Build attributes array from REST response
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

    async getGroups(sessionId: string, pattern?: string): Promise<GroupInfo[]> {
        const params: Record<string, string> = { sessionId };
        if (pattern) {
            params.pattern = pattern;
        }
        const response = await this.client.get('/api/v1/groups', { params });
        return response.data;
    }

    async getGroup(sessionId: string, groupName: string): Promise<GroupDetails> {
        const response = await this.client.get(`/api/v1/groups/${encodeURIComponent(groupName)}`, { params: { sessionId } });
        const restGroup = response.data;

        // Build attributes array from REST response
        const attributes: AttributeInfo[] = [
            { name: 'group_name', value: restGroup.groupName, dataType: 'string' },
            { name: 'description', value: restGroup.description, dataType: 'string' },
            { name: 'group_class', value: restGroup.groupClass, dataType: 'string' },
            { name: 'group_admin', value: restGroup.groupAdmin, dataType: 'string' },
            { name: 'is_private', value: restGroup.isPrivate, dataType: 'boolean' }
        ].sort((a, b) => a.name.localeCompare(b.name));

        return { ...restGroup, attributes };
    }

    async getGroupsForUser(sessionId: string, userName: string): Promise<GroupInfo[]> {
        const response = await this.client.get(`/api/v1/users/${encodeURIComponent(userName)}/groups`, { params: { sessionId } });
        return response.data;
    }

    async getParentGroups(sessionId: string, groupName: string): Promise<GroupInfo[]> {
        const response = await this.client.get(`/api/v1/groups/${encodeURIComponent(groupName)}/parents`, { params: { sessionId } });
        return response.data;
    }
}
