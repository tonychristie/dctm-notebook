import { EntityCache } from './entityCache';
import { UserInfo as BridgeUserInfo } from './bridgeTypes';

export interface UserAttribute {
    name: string;
    value: unknown;
    dataType: string;
}

export interface UserInfo {
    userName: string;
    userLoginName: string;
    userOsName: string;
    userAddress: string;
    userState: number;
    userSource: string;
    defaultFolder: string;
    defaultGroup: string;
    description: string;
    attributes: UserAttribute[];
}

function toUserInfo(user: BridgeUserInfo, attributes: UserAttribute[]): UserInfo {
    return {
        userName: user.userName,
        userLoginName: user.userLoginName || '',
        userOsName: user.userOsName || '',
        userAddress: user.userAddress || '',
        userState: parseInt(user.userState, 10) || 0,
        userSource: user.userSource || '',
        defaultFolder: user.defaultFolder || '',
        defaultGroup: user.userGroupName || '',
        description: user.description || '',
        attributes
    };
}

export class UserCache extends EntityCache<UserInfo> {
    protected async fetchAll(): Promise<UserInfo[]> {
        const users = await this.bridge.getUsers(this.sessionId);
        return users.map(user => toUserInfo(user, []));
    }

    protected nameOf(user: UserInfo): string {
        return user.userName;
    }

    async fetchUserDetails(userName: string, refresh = false): Promise<UserInfo> {
        const user = this.get(userName);
        if (!refresh && user && user.attributes.length > 0) {
            return user;
        }

        const bridgeUser = await this.bridge.getUser(this.sessionId, userName);
        const fetched = toUserInfo(
            bridgeUser,
            bridgeUser.attributes.map(attr => ({ name: attr.name, value: attr.value, dataType: attr.dataType }))
        );
        this.setEntry(fetched);
        return fetched;
    }

    async getUserGroups(userName: string): Promise<string[]> {
        const groups = await this.bridge.getGroupsForUser(this.sessionId, userName);
        return groups.map(g => g.groupName).sort();
    }
}
