import { ActionHandler, onActions } from './common';
import { applyAttributeFilter, groupActions, onFilterInput } from './dumpPanelShared';

export interface ObjectDumpMessage {
    command: 'refresh' | 'copyValue' | 'dumpObject' | 'goBack' | 'goForward';
    value?: string;
    objectId?: string;
}

function showNotification(root: ParentNode, message: string): void {
    const notification = root.querySelector('.copy-notification');
    if (!notification) {
        return;
    }
    notification.textContent = message;
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 2000);
}

export function registerObjectDumpActions(
    root: Document | HTMLElement,
    send: (message: ObjectDumpMessage) => void
): void {
    const handlers: Record<string, ActionHandler> = {
        ...groupActions,
        refresh: () => send({ command: 'refresh' }),
        copyObjectId: el => send({ command: 'copyValue', value: el.dataset.value }),
        goBack: () => send({ command: 'goBack' }),
        goForward: () => send({ command: 'goForward' }),
        copyValue: el => {
            send({ command: 'copyValue', value: el.dataset.value });
            showNotification(root, 'Copied to clipboard');
        },
        dumpObject: el => send({ command: 'dumpObject', objectId: el.dataset.value })
    };
    onActions(handlers, root);
    onFilterInput(value => applyAttributeFilter(value, 'value', true, root), root);
}
