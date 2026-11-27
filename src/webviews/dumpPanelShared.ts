import { ActionHandler, onActions } from './common';
import { isGroupVisible, matchesFilter } from '../webviewLogic';

const EXPANDED = '▼';
const COLLAPSED = '▶';

function setCollapsed(content: Element, collapsed: boolean): void {
    content.classList.toggle('collapsed', collapsed);
    const toggle = content.previousElementSibling?.querySelector('.toggle');
    if (toggle) {
        toggle.textContent = collapsed ? COLLAPSED : EXPANDED;
    }
}

function dumpRoot(el: Element): ParentNode {
    return el.closest('.dump-content') ?? document;
}

export const groupActions: Record<string, ActionHandler> = {
    toggleGroup: header => {
        const content = header.nextElementSibling;
        if (content) {
            setCollapsed(content, !content.classList.contains('collapsed'));
        }
    },
    collapseAll: el => dumpRoot(el).querySelectorAll('.group-content').forEach(content => setCollapsed(content, true)),
    expandAll: el => dumpRoot(el).querySelectorAll('.group-content').forEach(content => setCollapsed(content, false))
};

export function applyAttributeFilter(
    filter: string,
    secondField: 'type' | 'value',
    showInherited: boolean = true,
    root: ParentNode = document
): void {
    root.querySelectorAll<HTMLElement>('.attribute').forEach(el => {
        const matches = matchesFilter(filter, el.dataset.name ?? '', el.dataset[secondField] ?? '');
        el.classList.toggle('hidden', !matches);
    });

    root.querySelectorAll<HTMLElement>('.group[data-group]').forEach(group => {
        const visibleCount = group.querySelectorAll('.attribute:not(.hidden)').length;
        const countEl = group.querySelector('.group-header .count');
        if (countEl) {
            countEl.textContent = String(visibleCount);
        }
        const visible = isGroupVisible(group.dataset.inherited === 'true', showInherited, visibleCount);
        group.style.display = visible ? 'block' : 'none';
    });
}

export interface DumpMessage {
    command: string;
    [field: string]: string | undefined;
}

export interface DumpActions {
    handlers: Record<string, ActionHandler>;
    filterField: 'type' | 'value';
}

// The filter box and the Show inherited box are read at each event, as the dump content is replaced on each load.
function applyDumpFilter(root: HTMLElement, actions: DumpActions): void {
    const filter = root.querySelector<HTMLInputElement>('#filter')?.value ?? '';
    const showInherited = root.querySelector<HTMLInputElement>('#showInherited')?.checked ?? true;
    applyAttributeFilter(filter, actions.filterField, showInherited, root);
}

export function registerDumpActions(root: HTMLElement, current: () => DumpActions | undefined): void {
    onActions(action => current()?.handlers[action], root);
    root.addEventListener('input', event => {
        const actions = current();
        if (actions && (event.target as HTMLElement).id === 'filter') {
            applyDumpFilter(root, actions);
        }
    });
    root.addEventListener('change', event => {
        const actions = current();
        if (actions && (event.target as HTMLElement).id === 'showInherited') {
            applyDumpFilter(root, actions);
        }
    });
}
