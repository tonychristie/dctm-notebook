import { DqlSchema } from './completion';

// The members of TypeCache that completion reads, so this module needs no vscode import.
export interface SchemaTypeCache {
    getNames(): string[];
    fetchTypeDetails(typeName: string): Promise<{ attributes: { name: string }[] } | undefined>;
}

export function typeCacheSchema(typeCache: SchemaTypeCache): DqlSchema {
    return {
        typeNames: () => typeCache.getNames(),
        attributes: async typeName => {
            try {
                return (await typeCache.fetchTypeDetails(typeName))?.attributes.map(a => a.name) ?? [];
            } catch {
                // A failed lookup, for example on an expired session, must not empty the whole list.
                return [];
            }
        }
    };
}
