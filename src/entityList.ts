export interface EntityItem {
    name: string;
    parent?: string;
}

export interface EntityTreeNode {
    name: string;
    children: EntityTreeNode[];
}

export type EntityView =
    | { mode: 'tree'; roots: EntityTreeNode[]; count: number }
    | { mode: 'list'; names: string[]; count: number };

export function filterEntityNames(items: EntityItem[], filter: string): string[] {
    const lower = filter.toLowerCase();
    return items.map(item => item.name).filter(name => name.toLowerCase().includes(lower));
}

// Parents are matched without case, as TypeCache matches a supertype to its type.
export function buildEntityTree(items: EntityItem[]): EntityTreeNode[] {
    const nodes = new Map(items.map(item => [item.name.toLowerCase(), { name: item.name, children: [] as EntityTreeNode[] }]));
    const roots: EntityTreeNode[] = [];
    for (const item of items) {
        const node = nodes.get(item.name.toLowerCase())!;
        if (item.parent) {
            nodes.get(item.parent.toLowerCase())?.children.push(node);
        } else {
            roots.push(node);
        }
    }
    return roots;
}

export function entityView(items: EntityItem[], filter: string, hierarchical: boolean): EntityView {
    if (hierarchical && !filter) {
        return { mode: 'tree', roots: buildEntityTree(items), count: items.length };
    }
    const names = filterEntityNames(items, filter);
    return { mode: 'list', names, count: names.length };
}
