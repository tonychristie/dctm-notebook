import { ConnectionManager, ActiveConnection } from './connectionManager';

/**
 * Request to execute a DFC API method
 */
export interface ApiMethodRequest {
    /** Object ID to operate on (optional for session-level operations) */
    objectId?: string;
    /** Type name for type-level operations */
    typeName?: string;
    /** Method name to invoke */
    method: string;
    /** Positional arguments */
    args?: unknown[];
    /** Named arguments (alternative to positional) */
    namedArgs?: Record<string, unknown>;
}

/**
 * Response from API method execution
 */
export interface ApiMethodResponse {
    /** Result of the method invocation */
    result: unknown;
    /** Type of the result */
    resultType: string;
    /** Execution time in milliseconds */
    executionTimeMs: number;
}

/**
 * Information about a DFC method
 */
export interface MethodInfo {
    name: string;
    returnType: string;
    parameters: ParameterInfo[];
    description?: string;
}

/**
 * Information about a method parameter
 */
export interface ParameterInfo {
    name: string;
    type: string;
    required: boolean;
}

/**
 * Common DFC methods organized by category
 */
export const COMMON_DFC_METHODS: Record<string, MethodInfo[]> = {
    'Object Lifecycle': [
        {
            name: 'save',
            returnType: 'void',
            parameters: [],
            description: 'Saves all changes made to the object'
        },
        {
            name: 'destroy',
            returnType: 'void',
            parameters: [],
            description: 'Permanently deletes the object from the repository'
        },
        {
            name: 'fetch',
            returnType: 'void',
            parameters: [
                { name: 'typeName', type: 'string', required: false }
            ],
            description: 'Refreshes object from repository'
        },
        {
            name: 'revert',
            returnType: 'void',
            parameters: [],
            description: 'Reverts unsaved changes'
        }
    ],
    'Version Control': [
        {
            name: 'checkout',
            returnType: 'IDfId',
            parameters: [],
            description: 'Checks out the object for editing'
        },
        {
            name: 'checkin',
            returnType: 'IDfId',
            parameters: [
                { name: 'versionLabels', type: 'boolean', required: true },
                { name: 'versionLabel', type: 'string', required: true }
            ],
            description: 'Checks in the object with a new version'
        },
        {
            name: 'cancelCheckout',
            returnType: 'void',
            parameters: [],
            description: 'Cancels checkout without saving changes'
        },
        {
            name: 'getChronicleId',
            returnType: 'IDfId',
            parameters: [],
            description: 'Gets the chronicle ID (version tree root)'
        },
        {
            name: 'isCheckedOut',
            returnType: 'boolean',
            parameters: [],
            description: 'Returns true if object is checked out'
        },
        {
            name: 'isCheckedOutBy',
            returnType: 'boolean',
            parameters: [
                { name: 'userName', type: 'string', required: true }
            ],
            description: 'Returns true if checked out by specified user'
        }
    ],
    'Attribute Getters': [
        {
            name: 'getString',
            returnType: 'string',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Gets string value of an attribute'
        },
        {
            name: 'getInt',
            returnType: 'int',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Gets integer value of an attribute'
        },
        {
            name: 'getBoolean',
            returnType: 'boolean',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Gets boolean value of an attribute'
        },
        {
            name: 'getDouble',
            returnType: 'double',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Gets double value of an attribute'
        },
        {
            name: 'getTime',
            returnType: 'IDfTime',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Gets time value of an attribute'
        },
        {
            name: 'getId',
            returnType: 'IDfId',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Gets ID value of an attribute'
        },
        {
            name: 'getObjectId',
            returnType: 'IDfId',
            parameters: [],
            description: 'Gets the r_object_id of the object'
        },
        {
            name: 'getObjectName',
            returnType: 'string',
            parameters: [],
            description: 'Gets the object_name attribute'
        },
        {
            name: 'getTypeName',
            returnType: 'string',
            parameters: [],
            description: 'Gets the r_object_type attribute'
        }
    ],
    'Attribute Setters': [
        {
            name: 'setString',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'value', type: 'string', required: true }
            ],
            description: 'Sets string value of an attribute'
        },
        {
            name: 'setInt',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'value', type: 'int', required: true }
            ],
            description: 'Sets integer value of an attribute'
        },
        {
            name: 'setBoolean',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'value', type: 'boolean', required: true }
            ],
            description: 'Sets boolean value of an attribute'
        },
        {
            name: 'setDouble',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'value', type: 'double', required: true }
            ],
            description: 'Sets double value of an attribute'
        },
        {
            name: 'setTime',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'value', type: 'IDfTime', required: true }
            ],
            description: 'Sets time value of an attribute'
        },
        {
            name: 'setId',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'value', type: 'IDfId', required: true }
            ],
            description: 'Sets ID value of an attribute'
        }
    ],
    'Repeating Attributes': [
        {
            name: 'getRepeatingString',
            returnType: 'string',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'index', type: 'int', required: true }
            ],
            description: 'Gets string value at index in repeating attribute'
        },
        {
            name: 'setRepeatingString',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'index', type: 'int', required: true },
                { name: 'value', type: 'string', required: true }
            ],
            description: 'Sets string value at index in repeating attribute'
        },
        {
            name: 'appendString',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'value', type: 'string', required: true }
            ],
            description: 'Appends string value to repeating attribute'
        },
        {
            name: 'insertString',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'index', type: 'int', required: true },
                { name: 'value', type: 'string', required: true }
            ],
            description: 'Inserts string value at index in repeating attribute'
        },
        {
            name: 'remove',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true },
                { name: 'index', type: 'int', required: true }
            ],
            description: 'Removes value at index from repeating attribute'
        },
        {
            name: 'removeAll',
            returnType: 'void',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Removes all values from repeating attribute'
        },
        {
            name: 'getValueCount',
            returnType: 'int',
            parameters: [
                { name: 'attributeName', type: 'string', required: true }
            ],
            description: 'Gets count of values in repeating attribute'
        }
    ],
    'Folder Operations': [
        {
            name: 'link',
            returnType: 'void',
            parameters: [
                { name: 'folderPath', type: 'string', required: true }
            ],
            description: 'Links object to a folder'
        },
        {
            name: 'unlink',
            returnType: 'void',
            parameters: [
                { name: 'folderPath', type: 'string', required: true }
            ],
            description: 'Unlinks object from a folder'
        },
        {
            name: 'getFolderId',
            returnType: 'IDfId',
            parameters: [
                { name: 'index', type: 'int', required: true }
            ],
            description: 'Gets folder ID at index'
        },
        {
            name: 'getFolderIdCount',
            returnType: 'int',
            parameters: [],
            description: 'Gets count of folders object is linked to'
        }
    ],
    'Content Operations': [
        {
            name: 'getContentSize',
            returnType: 'long',
            parameters: [],
            description: 'Gets content size in bytes'
        },
        {
            name: 'getContentType',
            returnType: 'string',
            parameters: [],
            description: 'Gets content type/format'
        },
        {
            name: 'getFormat',
            returnType: 'IDfFormat',
            parameters: [],
            description: 'Gets format object'
        },
        {
            name: 'setContentType',
            returnType: 'void',
            parameters: [
                { name: 'contentType', type: 'string', required: true }
            ],
            description: 'Sets content type/format'
        },
        {
            name: 'setFile',
            returnType: 'void',
            parameters: [
                { name: 'filePath', type: 'string', required: true }
            ],
            description: 'Sets content from a file path'
        },
        {
            name: 'getFile',
            returnType: 'string',
            parameters: [
                { name: 'filePath', type: 'string', required: true }
            ],
            description: 'Exports content to a file path'
        }
    ],
    'Permissions': [
        {
            name: 'getPermit',
            returnType: 'int',
            parameters: [],
            description: 'Gets current user permission level (1-7)'
        },
        {
            name: 'getACL',
            returnType: 'IDfACL',
            parameters: [],
            description: 'Gets the ACL object'
        },
        {
            name: 'getACLName',
            returnType: 'string',
            parameters: [],
            description: 'Gets ACL name'
        },
        {
            name: 'getACLDomain',
            returnType: 'string',
            parameters: [],
            description: 'Gets ACL domain/owner'
        },
        {
            name: 'grant',
            returnType: 'void',
            parameters: [
                { name: 'accessorName', type: 'string', required: true },
                { name: 'permitLevel', type: 'int', required: true },
                { name: 'extendedPermit', type: 'string', required: false }
            ],
            description: 'Grants permission to user/group'
        },
        {
            name: 'revoke',
            returnType: 'void',
            parameters: [
                { name: 'accessorName', type: 'string', required: true },
                { name: 'extendedPermit', type: 'string', required: false }
            ],
            description: 'Revokes permission from user/group'
        }
    ],
    'Object Info': [
        {
            name: 'getAttrCount',
            returnType: 'int',
            parameters: [],
            description: 'Gets total number of attributes'
        },
        {
            name: 'getCreationDate',
            returnType: 'IDfTime',
            parameters: [],
            description: 'Gets creation date'
        },
        {
            name: 'getModifyDate',
            returnType: 'IDfTime',
            parameters: [],
            description: 'Gets last modification date'
        },
        {
            name: 'getOwnerName',
            returnType: 'string',
            parameters: [],
            description: 'Gets owner user name'
        },
        {
            name: 'getLockOwner',
            returnType: 'string',
            parameters: [],
            description: 'Gets lock owner (if checked out)'
        },
        {
            name: 'isImmutable',
            returnType: 'boolean',
            parameters: [],
            description: 'Returns true if object is immutable'
        },
        {
            name: 'isNew',
            returnType: 'boolean',
            parameters: [],
            description: 'Returns true if object is not yet saved'
        }
    ]
};

/**
 * Executor for DFC API method calls
 */
export class ApiExecutor {
    private connectionManager: ConnectionManager;

    constructor(connectionManager: ConnectionManager) {
        this.connectionManager = connectionManager;
    }

    /**
     * Execute a DFC API method
     */
    async execute(request: ApiMethodRequest): Promise<ApiMethodResponse> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection) {
            throw new Error('No active connection');
        }

        if (connection.type === 'dfc') {
            return this.executeDfc(connection, request);
        } else {
            return this.executeRest(connection, request);
        }
    }

    /**
     * Execute via DFC Bridge
     */
    private async executeDfc(
        connection: ActiveConnection,
        request: ApiMethodRequest
    ): Promise<ApiMethodResponse> {
        const bridge = this.connectionManager.getDfcBridge();

        const response = await bridge.executeApi(
            connection.sessionId!,
            request.typeName || '',
            request.method,
            {
                objectId: request.objectId,
                args: request.args,
                namedArgs: request.namedArgs
            }
        );

        // Cast response to expected shape
        const apiResponse = response as {
            result: unknown;
            resultType: string;
            executionTimeMs: number;
        };

        return {
            result: apiResponse.result,
            resultType: apiResponse.resultType || 'unknown',
            executionTimeMs: apiResponse.executionTimeMs || 0
        };
    }

    /**
     * Execute via REST API (limited functionality)
     */
    private async executeRest(
        _connection: ActiveConnection,
        _request: ApiMethodRequest
    ): Promise<ApiMethodResponse> {
        // REST API has limited method execution support
        // Most operations need to be translated to specific REST endpoints
        throw new Error(
            'API method execution is only supported via DFC connection. ' +
            'REST connections support limited operations through specific endpoints.'
        );
    }

    /**
     * Get available methods for a category
     */
    getMethodsByCategory(category: string): MethodInfo[] {
        return COMMON_DFC_METHODS[category] || [];
    }

    /**
     * Get all method categories
     */
    getCategories(): string[] {
        return Object.keys(COMMON_DFC_METHODS);
    }

    /**
     * Find method info by name
     */
    findMethod(methodName: string): MethodInfo | undefined {
        for (const methods of Object.values(COMMON_DFC_METHODS)) {
            const found = methods.find(m => m.name === methodName);
            if (found) {
                return found;
            }
        }
        return undefined;
    }

    /**
     * Get all methods as flat list
     */
    getAllMethods(): MethodInfo[] {
        return Object.values(COMMON_DFC_METHODS).flat();
    }

    /**
     * Search methods by name pattern
     */
    searchMethods(pattern: string): MethodInfo[] {
        const lowerPattern = pattern.toLowerCase();
        return this.getAllMethods().filter(m =>
            m.name.toLowerCase().includes(lowerPattern) ||
            (m.description && m.description.toLowerCase().includes(lowerPattern))
        );
    }
}
