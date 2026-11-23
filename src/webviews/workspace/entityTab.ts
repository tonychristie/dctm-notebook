import { onActions } from '../common';
import { Tree, TreeNode } from '../tree';
import { EntityItem, EntityTreeNode, entityView } from '../../entityList';

export type EntityTabName = 'types' | 'users' | 'groups';

interface EntityTabConfig {
    kind: 'type' | 'user' | 'group';
    label: string;
    singular: string;
    plural: string;
    icon: string;
    hierarchical: boolean;
}

const CONFIG: Record<EntityTabName, EntityTabConfig> = {
    types: { kind: 'type', label: 'Type', singular: 'type', plural: 'types', icon: 'symbol-class', hierarchical: true },
    users: { kind: 'user', label: 'User', singular: 'user', plural: 'users', icon: 'person', hierarchical: false },
    groups: { kind: 'group', label: 'Group', singular: 'group', plural: 'groups', icon: 'organization', hierarchical: false }
};

interface EntityNode extends TreeNode {
    name: string;
    children: EntityTreeNode[];
}

export type EntitiesResult =
    | { type: 'entities'; tab: EntityTabName; requestId?: number; items: EntityItem[] }
    | { type: 'entities'; tab: EntityTabName; requestId?: number; error: string };

interface PendingRequest {
    resolve(items: EntityItem[]): void;
    reject(error: Error): void;
}

export class EntityTabView {
    private readonly config: EntityTabConfig;
    private readonly tree: Tree<EntityNode>;
    private readonly search: HTMLInputElement;
    private readonly count: HTMLElement;
    private readonly pending = new Map<number, PendingRequest>();
    private nextRequestId = 0;
    private items: EntityItem[] | undefined;
    private requested = false;

    constructor(
        private readonly tab: EntityTabName,
        root: HTMLElement,
        private readonly post: (message: object) => void,
        private readonly connectionName: () => string
    ) {
        this.config = CONFIG[tab];
        this.search = root.querySelector<HTMLInputElement>('.entity-search')!;
        this.count = root.querySelector<HTMLElement>('.entity-count')!;
        this.tree = new Tree<EntityNode>(root.querySelector<HTMLElement>('.tree-container')!, {
            loadChildren: node => Promise.resolve(node.children.map(child => this.treeNode(child))),
            open: node => this.post({ tab: this.tab, command: 'open', name: node.name }),
            openExpandable: true
        });
        onActions({ refreshEntities: () => this.load('refresh') }, root);
        this.search.addEventListener('input', () => {
            if (this.items && this.pending.size === 0) {
                this.render();
            }
        });
    }

    ensureLoaded(): void {
        if (!this.requested) {
            this.requested = true;
            this.load('load');
        }
    }

    // A reopened connection has new caches, so the tab loads again the next time it is shown.
    reset(): void {
        this.requested = false;
    }

    onResult(result: EntitiesResult): void {
        const request = result.requestId === undefined ? undefined : this.pending.get(result.requestId);
        if (request) {
            this.pending.delete(result.requestId!);
            if ('error' in result) {
                request.reject(new Error(result.error));
            } else {
                request.resolve(result.items);
            }
            return;
        }
        if (!('error' in result)) {
            this.items = result.items;
            if (this.requested && this.pending.size === 0) {
                this.render();
            }
        }
    }

    private load(command: 'load' | 'refresh'): void {
        this.count.textContent = '';
        void this.tree.loadRoots(async () => {
            this.items = await this.request(command);
            return this.nodes();
        });
    }

    private render(): void {
        void this.tree.loadRoots(async () => this.nodes());
    }

    private nodes(): EntityNode[] {
        const { singular, plural, hierarchical } = this.config;
        const view = entityView(this.items ?? [], this.search.value, hierarchical);
        this.count.textContent = `${view.count} ${view.count === 1 ? singular : plural}`;
        return view.mode === 'tree'
            ? view.roots.map(node => this.treeNode(node))
            : view.names.map(name => this.treeNode({ name, children: [] }));
    }

    private treeNode(node: EntityTreeNode): EntityNode {
        const { kind, label, icon } = this.config;
        return {
            id: node.name,
            name: node.name,
            children: node.children,
            label: node.name,
            icon,
            expandable: node.children.length > 0,
            tooltip: `${label}: ${node.name}`,
            context: { webviewSection: kind, connectionName: this.connectionName(), name: node.name }
        };
    }

    private request(command: 'load' | 'refresh'): Promise<EntityItem[]> {
        const requestId = ++this.nextRequestId;
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.post({ tab: this.tab, command, requestId });
        });
    }
}
