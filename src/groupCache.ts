import { EntityCache } from './entityCache';
import { GroupInfo as BridgeGroupInfo } from './bridgeTypes';

export interface GroupAttribute {
    name: string;
    value: unknown;
    dataType: string;
}

export interface GroupInfo {
    groupName: string;
    groupAddress: string;
    groupSource: string;
    description: string;
    groupClass: string;
    groupAdmin: string;
    owner: string;
    isPrivate: boolean;
    isDynamic: boolean;
    aliasSetId: string;
    acl: string;
    members: string[];
    groupMembers: string[];
    attributes: GroupAttribute[];
}

function toGroupInfo(group: BridgeGroupInfo, attributes: GroupAttribute[]): GroupInfo {
    return {
        groupName: group.groupName,
        groupAddress: group.groupAddress || '',
        groupSource: group.groupSource || '',
        description: group.description || '',
        groupClass: group.groupClass || '',
        groupAdmin: group.groupAdmin || '',
        owner: group.ownerName || '',
        isPrivate: group.isPrivate || false,
        isDynamic: group.isDynamic || false,
        aliasSetId: '',
        acl: '',
        members: group.usersNames || [],
        groupMembers: group.groupsNames || [],
        attributes
    };
}

export class GroupCache extends EntityCache<GroupInfo> {
    protected async fetchAll(): Promise<GroupInfo[]> {
        const groups = await this.bridge.getGroups(this.sessionId);
        return groups.map(group => toGroupInfo(group, []));
    }

    protected nameOf(group: GroupInfo): string {
        return group.groupName;
    }

    async fetchGroupDetails(groupName: string, refresh = false): Promise<GroupInfo> {
        const group = this.get(groupName);
        if (!refresh && group && group.attributes.length > 0) {
            return group;
        }

        const bridgeGroup = await this.bridge.getGroup(this.sessionId, groupName);
        const fetched = toGroupInfo(
            bridgeGroup,
            bridgeGroup.attributes.map(attr => ({ name: attr.name, value: attr.value, dataType: attr.dataType }))
        );
        fetched.members = [...fetched.members].sort();
        fetched.groupMembers = [...fetched.groupMembers].sort();
        this.setEntry(fetched);
        return fetched;
    }

    async getParentGroups(groupName: string): Promise<string[]> {
        const groups = await this.bridge.getParentGroups(this.sessionId, groupName);
        return groups.map(g => g.groupName).sort();
    }
}
