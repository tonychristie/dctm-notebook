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

export const groupActions: Record<string, ActionHandler> = {
    toggleGroup: header => {
        const content = header.nextElementSibling;
        if (content) {
            setCollapsed(content, !content.classList.contains('collapsed'));
        }
    },
    collapseAll: () => document.querySelectorAll('.group-content').forEach(el => setCollapsed(el, true)),
    expandAll: () => document.querySelectorAll('.group-content').forEach(el => setCollapsed(el, false))
};

export function applyAttributeFilter(filter: string, secondField: 'type' | 'value', showInherited: boolean = true): void {
    document.querySelectorAll<HTMLElement>('.attribute').forEach(el => {
        const matches = matchesFilter(filter, el.dataset.name ?? '', el.dataset[secondField] ?? '');
        el.classList.toggle('hidden', !matches);
    });

    document.querySelectorAll<HTMLElement>('.group[data-group]').forEach(group => {
        const visibleCount = group.querySelectorAll('.attribute:not(.hidden)').length;
        const countEl = group.querySelector('.group-header .count');
        if (countEl) {
            countEl.textContent = String(visibleCount);
        }
        const visible = isGroupVisible(group.dataset.inherited === 'true', showInherited, visibleCount);
        group.style.display = visible ? 'block' : 'none';
    });
}

export function onFilterInput(handler: (value: string) => void): void {
    document.getElementById('filter')?.addEventListener('input', event => {
        handler((event.target as HTMLInputElement).value);
    });
}
