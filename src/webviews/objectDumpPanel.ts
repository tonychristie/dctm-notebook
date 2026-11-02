import { onActions, readWebviewData, vscode } from './common';
import { applyAttributeFilter, groupActions, onFilterInput } from './dumpPanelShared';

const { objectId } = readWebviewData<{ objectId?: string }>();

function showNotification(message: string): void {
    const notification = document.getElementById('notification');
    if (!notification) {
        return;
    }
    notification.textContent = message;
    notification.classList.add('show');
    setTimeout(() => notification.classList.remove('show'), 2000);
}

onActions({
    ...groupActions,
    refresh: () => vscode.postMessage({ command: 'refresh', objectId }),
    copyObjectId: () => vscode.postMessage({ command: 'copyValue', value: objectId }),
    goBack: () => vscode.postMessage({ command: 'goBack' }),
    goForward: () => vscode.postMessage({ command: 'goForward' }),
    copyValue: el => {
        vscode.postMessage({ command: 'copyValue', value: el.dataset.value });
        showNotification('Copied to clipboard');
    },
    dumpObject: el => vscode.postMessage({ command: 'dumpObject', objectId: el.dataset.value })
});

onFilterInput(value => applyAttributeFilter(value, 'value'));
