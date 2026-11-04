import { AxiosInstance, AxiosRequestConfig } from 'axios';
import {
    IUnifiedBridge,
    ObjectInfo,
    UserInfo,
    UserDetails,
    GroupInfo,
    GroupDetails,
    TypeSummary,
    TypeInfo,
    toGroupDetails
} from './bridgeTypes';

export type ConnectionType = 'dfc' | 'rest';

export interface DqlResult {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
}

export interface DmApiResult {
    result: unknown;
    resultType: string;
    executionTimeMs: number;
}

export interface ApiOptions {
    objectId?: string;
    args?: unknown[];
    namedArgs?: Record<string, unknown>;
}

// A bridge session exists only on the bridge that created it, so every call
// on a session must go through the client the session was created with.
export abstract class BridgeImplBase implements IUnifiedBridge {
    constructor(protected readonly client: AxiosInstance, readonly connectionType: ConnectionType) {}

    abstract getCabinets(sessionId: string): Promise<ObjectInfo[]>;
    abstract getFolderContents(sessionId: string, folderId: string, folderPath?: string): Promise<ObjectInfo[]>;
    abstract getUsers(sessionId: string): Promise<UserInfo[]>;
    abstract getUser(sessionId: string, userName: string): Promise<UserDetails>;
    abstract getGroupsForUser(sessionId: string, userName: string): Promise<GroupInfo[]>;
    abstract getParentGroups(sessionId: string, groupName: string): Promise<GroupInfo[]>;
    abstract getTypeDetails(sessionId: string, typeName: string): Promise<TypeInfo>;

    async executeDql(sessionId: string, query: string, timeoutMs?: number): Promise<DqlResult> {
        const response = await this.client.post('/api/v1/dql', { sessionId, query }, this.requestConfig(timeoutMs));

        const columns = (response.data.columns || []).map(
            (col: { name: string }) => col.name
        );

        return {
            columns,
            rows: response.data.rows || [],
            rowCount: response.data.rowCount || 0
        };
    }

    async executeApi(
        sessionId: string,
        typeName: string,
        method: string,
        options: ApiOptions,
        timeoutMs?: number
    ): Promise<unknown> {
        const response = await this.client.post('/api/v1/api', {
            sessionId,
            objectId: options.objectId,
            typeName: typeName || undefined,
            method,
            args: options.args,
            namedArgs: options.namedArgs
        }, this.requestConfig(timeoutMs));
        return response.data;
    }

    async executeDmApi(
        sessionId: string,
        apiType: 'get' | 'exec' | 'set',
        command: string,
        timeoutMs?: number
    ): Promise<DmApiResult> {
        const response = await this.client.post('/api/v1/dmapi', { sessionId, apiType, command }, this.requestConfig(timeoutMs));
        return response.data;
    }

    async disconnect(sessionId: string): Promise<void> {
        await this.client.post('/api/v1/disconnect', { sessionId });
    }

    async getGroups(sessionId: string): Promise<GroupInfo[]> {
        const response = await this.client.get('/api/v1/groups', { params: { sessionId } });
        return response.data;
    }

    async getGroup(sessionId: string, groupName: string): Promise<GroupDetails> {
        const response = await this.client.get(`/api/v1/groups/${encodeURIComponent(groupName)}`, { params: { sessionId } });
        return toGroupDetails(response.data);
    }

    async getTypes(sessionId: string): Promise<TypeSummary[]> {
        const response = await this.client.get('/api/v1/types', { params: { sessionId } });
        return response.data;
    }

    async getObject(sessionId: string, objectId: string): Promise<ObjectInfo> {
        const response = await this.client.get(`/api/v1/objects/${objectId}`, { params: { sessionId } });
        return response.data;
    }

    async checkout(sessionId: string, objectId: string): Promise<ObjectInfo> {
        const response = await this.client.put(`/api/v1/objects/${objectId}/lock`, null, { params: { sessionId } });
        return response.data;
    }

    async cancelCheckout(sessionId: string, objectId: string): Promise<void> {
        await this.client.delete(`/api/v1/objects/${objectId}/lock`, { params: { sessionId } });
    }

    async checkin(sessionId: string, objectId: string, versionLabel: string = 'CURRENT'): Promise<ObjectInfo> {
        const response = await this.client.post(`/api/v1/objects/${objectId}/versions`, null, { params: { sessionId, versionLabel } });
        return response.data;
    }

    private requestConfig(timeoutMs?: number): AxiosRequestConfig | undefined {
        return timeoutMs === undefined ? undefined : { timeout: timeoutMs };
    }
}
