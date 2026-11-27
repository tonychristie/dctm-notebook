import { EntityCache } from './entityCache';
import { TypeAttribute, TypeInfo as BridgeTypeInfo } from './bridgeTypes';

export type { TypeAttribute };

export interface TypeInfo extends BridgeTypeInfo {
    children: string[];
}

export class TypeCache extends EntityCache<TypeInfo> {
    protected async fetchAll(): Promise<TypeInfo[]> {
        const types = await this.bridge.getTypes(this.sessionId);

        const entries: TypeInfo[] = types.map(type => ({
            name: type.name,
            superType: type.superType,
            isInternal: type.isInternal,
            attributes: [],
            children: []
        }));

        const byName = new Map(entries.map(entry => [entry.name.toLowerCase(), entry]));
        for (const entry of entries) {
            if (entry.superType) {
                byName.get(entry.superType.toLowerCase())?.children.push(entry.name);
            }
        }
        for (const entry of entries) {
            entry.children.sort();
        }

        return entries;
    }

    protected nameOf(type: TypeInfo): string {
        return type.name;
    }

    getRootTypes(): string[] {
        return this.getNames().filter(name => !this.get(name)?.superType);
    }

    getChildTypes(typeName: string): string[] {
        return this.get(typeName)?.children ?? [];
    }

    // Documentum reserves the dm prefixes (dm_, dmi_, dmr_, dmc_) for its own types.
    getNearestStandardType(typeName: string): string | undefined {
        let type = this.get(typeName);
        while (type && !type.name.toLowerCase().startsWith('dm')) {
            type = type.superType ? this.get(type.superType) : undefined;
        }
        return type?.name;
    }

    isTypeName(name: string): boolean {
        return this.get(name) !== undefined;
    }

    async fetchTypeDetails(typeName: string, refresh = false): Promise<TypeInfo | undefined> {
        const type = this.get(typeName);
        if (!type) {
            return undefined;
        }

        if (!refresh && type.attributes.length > 0) {
            return type;
        }

        const details = await this.bridge.getTypeDetails(this.sessionId, typeName);
        type.attributes = details.attributes;
        return type;
    }
}
