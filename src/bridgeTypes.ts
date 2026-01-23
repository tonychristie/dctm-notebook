/**
 * Shared types for the Documentum Bridge implementations.
 *
 * These types define the contract between the bridge and its consumers.
 * Both DFC and REST implementations return data in these formats.
 */

/**
 * Standard object info returned by unified methods.
 * Used for cabinets, folders, and documents.
 */
export interface ObjectInfo {
    objectId: string;
    type: string;
    name: string;
    attributes: Record<string, unknown>;
}

/**
 * User information from the repository.
 */
export interface UserInfo {
    objectId: string;
    userName: string;
    userOsName: string;
    userAddress: string;
    userState: string;
    defaultFolder: string;
    userGroupName: string;
    superUser: boolean;
    userLoginName?: string;
    userSource?: string;
    description?: string;
}

/**
 * Detailed user information including all attributes.
 */
export interface UserDetails extends UserInfo {
    attributes: AttributeInfo[];
}

/**
 * Group information from the repository.
 */
export interface GroupInfo {
    objectId: string;
    groupName: string;
    description: string;
    groupClass: string;
    groupAdmin: string;
    isPrivate: boolean;
    usersNames: string[];
    groupsNames: string[];
    groupAddress?: string;
    groupSource?: string;
    ownerName?: string;
    isDynamic?: boolean;
}

/**
 * Detailed group information including all attributes.
 */
export interface GroupDetails extends GroupInfo {
    attributes: AttributeInfo[];
}

/**
 * Generic attribute information.
 */
export interface AttributeInfo {
    name: string;
    value: unknown;
    dataType: string;
}

/**
 * Attribute information for a type definition.
 */
export interface TypeAttribute {
    name: string;
    dataType: string;
    length: number;
    isRepeating: boolean;
    isInherited: boolean;
}

/**
 * Type information from the repository.
 */
export interface TypeInfo {
    name: string;
    superType: string | null;
    isInternal: boolean;
    attributes: TypeAttribute[];
}

/**
 * Summary type info returned by getTypes (without attributes).
 */
export interface TypeSummary {
    name: string;
    superType: string | null;
    isInternal: boolean;
}

/**
 * Unified bridge interface for Documentum operations.
 *
 * This interface abstracts the connection type (DFC or REST).
 * Implementations handle the routing internally - callers don't
 * need to know the underlying connection type.
 */
export interface IUnifiedBridge {
    /**
     * Get cabinets from the repository.
     */
    getCabinets(sessionId: string): Promise<ObjectInfo[]>;

    /**
     * Get folder contents (subfolders and documents).
     * @param sessionId Active session ID
     * @param folderId The folder object ID
     * @param folderPath The folder path (required for DFC sessions)
     */
    getFolderContents(sessionId: string, folderId: string, folderPath?: string): Promise<ObjectInfo[]>;

    /**
     * Get users from the repository.
     * @param sessionId Active session ID
     * @param pattern Optional filter pattern
     */
    getUsers(sessionId: string, pattern?: string): Promise<UserInfo[]>;

    /**
     * Get a single user by username.
     */
    getUser(sessionId: string, userName: string): Promise<UserDetails>;

    /**
     * Get groups from the repository.
     * @param sessionId Active session ID
     * @param pattern Optional filter pattern
     */
    getGroups(sessionId: string, pattern?: string): Promise<GroupInfo[]>;

    /**
     * Get a single group by name.
     */
    getGroup(sessionId: string, groupName: string): Promise<GroupDetails>;

    /**
     * Get groups that contain a user.
     */
    getGroupsForUser(sessionId: string, userName: string): Promise<GroupInfo[]>;

    /**
     * Get parent groups (groups that contain this group).
     */
    getParentGroups(sessionId: string, groupName: string): Promise<GroupInfo[]>;

    /**
     * Get list of all types in the repository.
     */
    getTypes(sessionId: string): Promise<TypeSummary[]>;

    /**
     * Get detailed type information including attributes.
     */
    getTypeDetails(sessionId: string, typeName: string): Promise<TypeInfo>;
}
