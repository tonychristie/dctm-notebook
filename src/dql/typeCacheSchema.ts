import { DqlSchema } from './completion';

// The members of TypeCache that completion reads, so this module needs no vscode import.
export interface SchemaTypeCache {
    getNames(): string[];
    fetchTypeDetails(typeName: string): Promise<{ attributes: { name: string }[] } | undefined>;
}

export function typeCacheSchema(typeCache: SchemaTypeCache): DqlSchema {
    return {
        typeNames: () => typeCache.getNames(),
        attributes: async typeName => (await typeCache.fetchTypeDetails(typeName))?.attributes.map(a => a.name) ?? []
    };
}
