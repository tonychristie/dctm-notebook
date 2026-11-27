export interface TreeNode {
    id: string;
    label: string;
    icon: string;
    expandable: boolean;
    description?: string;
    tooltip?: string;
    context?: object;
}

export interface TreeOptions<T extends TreeNode> {
    loadChildren(node: T): Promise<T[]>;
    open(node: T): void;
    // When true, clicking or pressing Enter on an expandable node opens it, and only its twistie expands it.
    openExpandable?: boolean;
}

interface TreeEntry<T> {
    node: T;
    item: HTMLLIElement;
    twistie: HTMLElement;
    group?: HTMLUListElement;
    loadGeneration: number;
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export class Tree<T extends TreeNode> {
    private readonly entries = new Map<string, TreeEntry<T>>();
    private rootGeneration = 0;
    private loadRootsAgain: (() => void) | undefined;

    constructor(private readonly container: HTMLElement, private readonly options: TreeOptions<T>) {
        container.addEventListener('click', event => this.onClick(event));
        container.addEventListener('keydown', event => this.onKeyDown(event));
    }

    async loadRoots(load: () => Promise<T[]>): Promise<void> {
        const generation = ++this.rootGeneration;
        this.loadRootsAgain = () => void this.loadRoots(load);
        this.entries.clear();
        this.container.replaceChildren(this.message('Loading...'));

        try {
            const nodes = await load();
            if (generation !== this.rootGeneration) {
                return;
            }
            const list = document.createElement('ul');
            list.className = 'tree';
            list.setAttribute('role', 'tree');
            list.append(...nodes.map(node => this.renderItem(node, 1)));
            this.container.replaceChildren(list);
            this.focusable(list.querySelector<HTMLLIElement>('[role="treeitem"]'));
        } catch (error) {
            if (generation === this.rootGeneration) {
                this.container.replaceChildren(this.errorMessage(errorText(error), 'roots'));
            }
        }
    }

    async reload(nodeId: string): Promise<void> {
        const entry = this.entries.get(nodeId);
        if (!entry) {
            return;
        }
        const wasExpanded = this.isExpanded(entry);
        this.removeGroup(entry);
        if (wasExpanded) {
            await this.expand(entry);
        }
    }

    private renderItem(node: T, level: number): HTMLLIElement {
        const item = document.createElement('li');
        item.setAttribute('role', 'treeitem');
        item.setAttribute('aria-level', String(level));
        item.setAttribute('aria-selected', 'false');
        item.tabIndex = -1;
        item.dataset.id = node.id;
        if (node.expandable) {
            item.setAttribute('aria-expanded', 'false');
        }

        const row = document.createElement('div');
        row.className = 'tree-row';
        row.style.paddingLeft = `${(level - 1) * 16 + 4}px`;
        if (node.tooltip) {
            row.title = node.tooltip;
        }
        if (node.context) {
            row.dataset.vscodeContext = JSON.stringify(node.context);
        }

        const twistie = document.createElement('span');
        twistie.className = node.expandable ? 'twistie codicon codicon-chevron-right' : 'twistie';
        const icon = document.createElement('span');
        icon.className = `tree-icon codicon codicon-${node.icon}`;
        const label = document.createElement('span');
        label.className = 'tree-label';
        label.textContent = node.label;
        row.append(twistie, icon, label);

        if (node.description) {
            const description = document.createElement('span');
            description.className = 'tree-description';
            description.textContent = node.description;
            row.append(description);
        }

        item.append(row);
        this.entries.set(node.id, { node, item, twistie, loadGeneration: 0 });
        return item;
    }

    private message(text: string, className = 'tree-message'): HTMLElement {
        const element = document.createElement('div');
        element.className = className;
        element.textContent = text;
        return element;
    }

    private errorMessage(text: string, retry: string): HTMLElement {
        const element = this.message(text, 'tree-error');
        const button = document.createElement('button');
        button.textContent = 'Retry';
        button.dataset.treeRetry = retry;
        element.append(' ', button);
        return element;
    }

    private isExpanded(entry: TreeEntry<T>): boolean {
        return entry.item.getAttribute('aria-expanded') === 'true';
    }

    private setExpanded(entry: TreeEntry<T>, expanded: boolean): void {
        entry.item.setAttribute('aria-expanded', String(expanded));
        entry.twistie.classList.toggle('codicon-chevron-right', !expanded);
        entry.twistie.classList.toggle('codicon-chevron-down', expanded);
        if (entry.group) {
            entry.group.hidden = !expanded;
        }
    }

    private removeGroup(entry: TreeEntry<T>): void {
        entry.group?.remove();
        entry.group = undefined;
        entry.loadGeneration++;
        for (const [id, other] of this.entries) {
            if (!other.item.isConnected) {
                this.entries.delete(id);
            }
        }
    }

    private async expand(entry: TreeEntry<T>): Promise<void> {
        this.setExpanded(entry, true);
        if (entry.group) {
            return;
        }

        const group = document.createElement('ul');
        group.setAttribute('role', 'group');
        group.append(this.groupMessage(this.message('Loading...'), entry));
        entry.group = group;
        entry.item.append(group);
        const generation = ++entry.loadGeneration;

        try {
            const children = await this.options.loadChildren(entry.node);
            if (generation !== entry.loadGeneration) {
                return;
            }
            const level = Number(entry.item.getAttribute('aria-level')) + 1;
            group.replaceChildren(...(children.length > 0
                ? children.map(child => this.renderItem(child, level))
                : [this.groupMessage(this.message('Empty'), entry)]));
        } catch (error) {
            if (generation === entry.loadGeneration) {
                group.replaceChildren(this.groupMessage(this.errorMessage(errorText(error), entry.node.id), entry));
            }
        }
    }

    private groupMessage(content: HTMLElement, entry: TreeEntry<T>): HTMLLIElement {
        const item = document.createElement('li');
        item.setAttribute('role', 'none');
        const level = Number(entry.item.getAttribute('aria-level'));
        content.style.paddingLeft = `${level * 16 + 24}px`;
        item.append(content);
        return item;
    }

    private toggle(entry: TreeEntry<T>): void {
        if (this.isExpanded(entry)) {
            this.setExpanded(entry, false);
        } else {
            void this.expand(entry);
        }
    }

    private activate(entry: TreeEntry<T>): void {
        if (entry.node.expandable && !this.options.openExpandable) {
            this.toggle(entry);
        } else {
            this.options.open(entry.node);
        }
    }

    private entryFor(target: EventTarget | null): TreeEntry<T> | undefined {
        const item = (target as Element | null)?.closest<HTMLLIElement>('[role="treeitem"]');
        return item ? this.entries.get(item.dataset.id ?? '') : undefined;
    }

    private onClick(event: MouseEvent): void {
        const retry = (event.target as Element).closest<HTMLElement>('[data-tree-retry]');
        if (retry) {
            this.retry(retry.dataset.treeRetry ?? '');
            return;
        }
        if (!(event.target as Element).closest('.tree-row')) {
            return;
        }
        const entry = this.entryFor(event.target);
        if (entry) {
            this.focus(entry.item);
            if (entry.node.expandable && (event.target as Element).closest('.twistie')) {
                this.toggle(entry);
            } else {
                this.activate(entry);
            }
        }
    }

    private retry(target: string): void {
        if (target === 'roots') {
            this.loadRootsAgain?.();
            return;
        }
        const entry = this.entries.get(target);
        if (entry) {
            this.removeGroup(entry);
            void this.expand(entry);
        }
    }

    private visibleItems(): HTMLLIElement[] {
        return Array.from(this.container.querySelectorAll<HTMLLIElement>('[role="treeitem"]'))
            .filter(item => !item.parentElement?.closest('[role="group"][hidden]'));
    }

    private onKeyDown(event: KeyboardEvent): void {
        const entry = this.entryFor(event.target);
        if (!entry || (event.target as Element) !== entry.item) {
            return;
        }

        const items = this.visibleItems();
        const index = items.indexOf(entry.item);
        switch (event.key) {
            case 'ArrowDown':
                this.focus(items[index + 1]);
                break;
            case 'ArrowUp':
                this.focus(items[index - 1]);
                break;
            case 'ArrowRight':
                if (entry.node.expandable && !this.isExpanded(entry)) {
                    void this.expand(entry);
                } else if (this.isExpanded(entry)) {
                    this.focus(entry.group?.querySelector<HTMLLIElement>('[role="treeitem"]'));
                }
                break;
            case 'ArrowLeft':
                if (this.isExpanded(entry)) {
                    this.setExpanded(entry, false);
                } else {
                    this.focus(entry.item.parentElement?.closest<HTMLLIElement>('[role="treeitem"]'));
                }
                break;
            case 'Enter':
                this.activate(entry);
                break;
            default:
                return;
        }
        event.preventDefault();
    }

    private focusable(item: HTMLLIElement | null | undefined): void {
        if (item) {
            item.tabIndex = 0;
        }
    }

    private focus(item: HTMLLIElement | null | undefined): void {
        if (!item) {
            return;
        }
        this.container.querySelectorAll<HTMLLIElement>('[role="treeitem"]').forEach(other => {
            other.tabIndex = -1;
            other.setAttribute('aria-selected', 'false');
        });
        item.tabIndex = 0;
        item.setAttribute('aria-selected', 'true');
        item.focus();
    }
}
