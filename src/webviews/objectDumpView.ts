import { byId, onActions, vscode } from './common';

const objectIdInput = byId<HTMLInputElement>('objectId');
const dumpBtn = byId<HTMLButtonElement>('dumpBtn');
const statusEl = byId<HTMLElement>('status');
const historySection = byId<HTMLElement>('historySection');
const historyList = byId<HTMLElement>('historyList');

function dumpObject(objectId: string): void {
    vscode.postMessage({ command: 'dumpObject', objectId });
}

function updateHistoryDisplay(history: string[]): void {
    historySection.style.display = history.length === 0 ? 'none' : 'block';
    historyList.replaceChildren(...history.map(id => {
        const item = document.createElement('li');
        item.className = 'history-item';
        item.dataset.action = 'dumpFromHistory';
        item.dataset.value = id;
        item.textContent = id;
        return item;
    }));
}

dumpBtn.addEventListener('click', () => {
    const objectId = objectIdInput.value.trim();
    if (objectId) {
        dumpObject(objectId);
    }
});

objectIdInput.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
        dumpBtn.click();
    }
});

onActions({
    clearHistory: () => vscode.postMessage({ command: 'clearHistory' }),
    dumpFromHistory: el => {
        const objectId = el.dataset.value ?? '';
        objectIdInput.value = objectId;
        dumpObject(objectId);
    }
});

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.command) {
        case 'updateConnection':
            objectIdInput.disabled = !message.connected;
            dumpBtn.disabled = !message.connected;
            statusEl.className = 'status ' + (message.connected ? 'connected' : 'disconnected');
            statusEl.textContent = message.connected
                ? 'Connected to ' + message.repositoryName
                : 'Not connected';
            break;
        case 'updateHistory':
            updateHistoryDisplay(message.history);
            break;
    }
});

vscode.postMessage({ command: 'ready' });
