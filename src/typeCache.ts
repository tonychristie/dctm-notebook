import * as vscode from 'vscode';
import { DctmBridge } from './dctmBridge';
import { TypeAttribute, TypeInfo as BridgeTypeInfo } from './bridgeTypes';

// Re-export for consumers that import from typeCache
export type { TypeAttribute };

/**
 * Extended type information with children for cache use.
 * Extends the bridge TypeInfo with children array for hierarchy navigation.
 */
export interface TypeInfo extends BridgeTypeInfo {
    children: string[];
}

/**
 * Cache for repository type information
 * Fetches from DFC Bridge and caches locally for performance
 */
export class TypeCache {
    private typeMap: Map<string, TypeInfo> = new Map();
    private typeNames: Set<string> = new Set();
    private rootTypes: string[] = [];
    private lastRefresh: Date | null = null;
    private refreshPromise: Promise<void> | null = null;

    private readonly refreshEmitter = new vscode.EventEmitter<void>();
    readonly onRefresh: vscode.Event<void> = this.refreshEmitter.event;

    constructor(
        private readonly bridge: DctmBridge,
        private readonly sessionId: string
    ) {}

    dispose(): void {
        this.refreshEmitter.dispose();
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

    // Documentum reserves the dm prefixes (dm_, dmi_, dmr_, dmc_) for its own types.
    getNearestStandardType(typeName: string): string | undefined {
        let type = this.getType(typeName);
        while (type && !type.name.toLowerCase().startsWith('dm')) {
            type = type.superType ? this.getType(type.superType) : undefined;
        }
        return type?.name;
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
     * If a refresh is already in progress, waits for it to complete.
     */
    async refresh(): Promise<void> {
        // If refresh already in progress, wait for it
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        // Create and store the refresh promise
        this.refreshPromise = this.doRefresh();

        try {
            await this.refreshPromise;
        } finally {
            this.refreshPromise = null;
        }
    }

    /**
     * Internal refresh implementation.
     */
    private async doRefresh(): Promise<void> {
        // Fetch type list from bridge (returns TypeSummary[])
        const types = await this.bridge.getTypes(this.sessionId);

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

        this.refreshEmitter.fire();
    }

    /**
     * Fetch detailed type info including attributes.
     * The bridge handles backend type (DFC or REST) internally.
     */
    async fetchTypeDetails(typeName: string, refresh = false): Promise<TypeInfo | undefined> {
        const type = this.typeMap.get(typeName.toLowerCase());
        if (!type) {
            return undefined;
        }

        // If we already have attributes, return cached
        if (!refresh && type.attributes.length > 0) {
            return type;
        }

        try {
            const details = await this.bridge.getTypeDetails(this.sessionId, typeName);

            // Update cached type with attributes (details is now strongly typed as TypeInfo)
            type.attributes = details.attributes;

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
