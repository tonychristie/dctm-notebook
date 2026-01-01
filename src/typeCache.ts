import { ConnectionManager } from './connectionManager';

/**
 * Attribute information for a type
 */
export interface TypeAttribute {
    name: string;
    dataType: string;
    length: number;
    isRepeating: boolean;
    isInherited: boolean;
}

/**
 * Type information from the repository
 */
export interface TypeInfo {
    name: string;
    superType: string | null;
    isInternal: boolean;
    attributes: TypeAttribute[];
    children: string[];
}

/**
 * Cache for repository type information
 * Fetches from DFC Bridge and caches locally for performance
 */
export class TypeCache {
    private connectionManager: ConnectionManager;
    private typeMap: Map<string, TypeInfo> = new Map();
    private typeNames: Set<string> = new Set();
    private rootTypes: string[] = [];
    private lastRefresh: Date | null = null;
    private refreshing: boolean = false;

    // Event callbacks
    private onRefreshCallbacks: Array<() => void> = [];

    constructor(connectionManager: ConnectionManager) {
        this.connectionManager = connectionManager;
    }

    /**
     * Register callback for when cache is refreshed
     */
    onRefresh(callback: () => void): void {
        this.onRefreshCallbacks.push(callback);
    }

    /**
     * Check if cache has data
     */
    hasData(): boolean {
        return this.typeMap.size > 0;
    }

    /**
     * Get all type names (for semantic highlighting)
     */
    getTypeNames(): string[] {
        return Array.from(this.typeNames);
    }

    /**
     * Get root types (types with no super type or super type is dm_sysobject)
     */
    getRootTypes(): string[] {
        return this.rootTypes;
    }

    /**
     * Get type info by name (case-insensitive)
     */
    getType(typeName: string): TypeInfo | undefined {
        return this.typeMap.get(typeName.toLowerCase());
    }

    /**
     * Get child types of a given type (case-insensitive)
     */
    getChildTypes(typeName: string): string[] {
        const type = this.typeMap.get(typeName.toLowerCase());
        return type?.children || [];
    }

    /**
     * Check if a string is a known type name
     */
    isTypeName(name: string): boolean {
        return this.typeNames.has(name.toLowerCase());
    }

    /**
     * Get attributes for a type (optionally including inherited, case-insensitive)
     */
    getAttributes(typeName: string, includeInherited: boolean = true): TypeAttribute[] {
        const type = this.typeMap.get(typeName.toLowerCase());
        if (!type) {
            return [];
        }

        if (includeInherited) {
            return type.attributes;
        } else {
            return type.attributes.filter(a => !a.isInherited);
        }
    }

    /**
     * Search types by name pattern
     */
    searchTypes(pattern: string): string[] {
        const lowerPattern = pattern.toLowerCase();
        return Array.from(this.typeNames)
            .filter(name => name.includes(lowerPattern))
            .sort();
    }

    /**
     * Refresh cache from the bridge.
     * The bridge handles backend type (DFC or REST) internally.
     */
    async refresh(): Promise<void> {
        if (this.refreshing) {
            return;
        }

        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            throw new Error('No active connection');
        }

        this.refreshing = true;
        try {
            const bridge = this.connectionManager.getDfcBridge();

            // Fetch type list from bridge
            const typesResponse = await bridge.getTypes(connection.sessionId!);
            const types = typesResponse as Array<{
                name: string;
                superType: string | null;
                isInternal: boolean;
            }>;

            // Clear existing cache
            this.typeMap.clear();
            this.typeNames.clear();
            this.rootTypes = [];

            // Build type map and name set
            const childrenMap = new Map<string, string[]>();

            for (const type of types) {
                const typeName = type.name.toLowerCase();
                this.typeNames.add(typeName);

                // Initialize type info (attributes fetched on demand)
                this.typeMap.set(typeName, {
                    name: type.name,
                    superType: type.superType,
                    isInternal: type.isInternal,
                    attributes: [],
                    children: []
                });

                // Track parent-child relationships
                if (type.superType) {
                    const parentName = type.superType.toLowerCase();
                    if (!childrenMap.has(parentName)) {
                        childrenMap.set(parentName, []);
                    }
                    childrenMap.get(parentName)!.push(typeName);
                } else {
                    // Root type (no super type)
                    this.rootTypes.push(typeName);
                }
            }

            // Populate children arrays
            for (const [parent, children] of childrenMap) {
                const typeInfo = this.typeMap.get(parent);
                if (typeInfo) {
                    typeInfo.children = children.sort();
                }
            }

            // Sort root types
            this.rootTypes.sort();

            this.lastRefresh = new Date();

            // Notify listeners
            for (const callback of this.onRefreshCallbacks) {
                callback();
            }
        } finally {
            this.refreshing = false;
        }
    }

    /**
     * Fetch detailed type info including attributes.
     * The bridge handles backend type (DFC or REST) internally.
     */
    async fetchTypeDetails(typeName: string): Promise<TypeInfo | undefined> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            return undefined;
        }

        const type = this.typeMap.get(typeName.toLowerCase());
        if (!type) {
            return undefined;
        }

        // If we already have attributes, return cached
        if (type.attributes.length > 0) {
            return type;
        }

        try {
            const bridge = this.connectionManager.getDfcBridge();
            const details = await bridge.getTypeDetails(connection.sessionId!, typeName);

            const typeDetails = details as {
                name: string;
                superType: string | null;
                attributes: Array<{
                    name: string;
                    dataType: string;
                    length: number;
                    isRepeating: boolean;
                    isInherited: boolean;
                }>;
            };

            // Update cached type with attributes
            type.attributes = typeDetails.attributes.map(a => ({
                name: a.name,
                dataType: a.dataType,
                length: a.length,
                isRepeating: a.isRepeating,
                isInherited: a.isInherited
            }));

            return type;
        } catch {
            // Return type without attributes on error
            return type;
        }
    }

    /**
     * Clear the cache
     */
    clear(): void {
        this.typeMap.clear();
        this.typeNames.clear();
        this.rootTypes = [];
        this.lastRefresh = null;
    }

    /**
     * Get last refresh time
     */
    getLastRefresh(): Date | null {
        return this.lastRefresh;
    }

    /**
     * Get cache statistics
     */
    getStats(): { typeCount: number; lastRefresh: Date | null } {
        return {
            typeCount: this.typeMap.size,
            lastRefresh: this.lastRefresh
        };
    }
}
