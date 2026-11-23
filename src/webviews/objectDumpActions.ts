import { DumpActions, DumpMessage, groupActions, registerDumpActions } from './dumpPanelShared';

function showNotification(root: ParentNode, message: string): void {
    const notification = root.querySelector('.copy-notification');
    if (!notification) {
        return;
    }
    notification.textContent = message;
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 2000);
}

export function objectDumpActions(root: ParentNode, send: (message: DumpMessage) => void): DumpActions {
    return {
        filterField: 'value',
        handlers: {
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
        }
    };
}

export function registerObjectDumpActions(root: Document | HTMLElement, send: (message: DumpMessage) => void): void {
    const actions = objectDumpActions(root, send);
    registerDumpActions(root, () => actions);
}
