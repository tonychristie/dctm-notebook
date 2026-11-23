import { ActionHandler } from './common';
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

// Listens on the root, so a filter box in content that is replaced later still works.
export function onFilterInput(handler: (value: string) => void, root: Document | HTMLElement = document): void {
    root.addEventListener('input', event => {
        const target = event.target as HTMLInputElement;
        if (target.id === 'filter') {
            handler(target.value);
        }
    });
}
