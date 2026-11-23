import { byId, vscode } from './common';
import { CabinetsTabView } from './workspace/cabinetsTab';
import { DumpContent, DumpTabView } from './workspace/dumpTab';

type WorkspaceTab = 'cabinets' | 'dump';

interface WorkspaceState {
    connectionName: string;
    repository: string;
    username: string;
    connected: boolean;
    generation: number;
    activeTab: WorkspaceTab;
}

const post = (message: object) => vscode.postMessage(message);
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const cabinets = new CabinetsTabView(byId('panel-cabinets'), post);
const dump = new DumpTabView(byId('panel-dump'), post);

let connectionName = '';
let activeTab: WorkspaceTab = 'cabinets';
let loadedGeneration = 0;

function saveState(): void {
    vscode.setState({ connectionName, activeTab });
}

function showTab(tab: WorkspaceTab): void {
    activeTab = tab;
    for (const button of tabs) {
        const selected = button.dataset.tab === tab;
        button.setAttribute('aria-selected', String(selected));
        button.tabIndex = selected ? 0 : -1;
        byId(button.getAttribute('aria-controls') ?? '').hidden = !selected;
    }
    saveState();
}

function applyState(state: WorkspaceState): void {
    connectionName = state.connectionName;
    byId('wsName').textContent = state.connectionName;
    byId('wsInfo').textContent = state.username
        ? `${state.repository} as ${state.username}`
        : state.repository;
    byId('wsBanner').hidden = state.connected;

    for (const button of tabs) {
        button.disabled = !state.connected;
    }
    document.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach(panel => {
        panel.inert = !state.connected;
        panel.classList.toggle('disabled', !state.connected);
    });

    showTab(state.activeTab);

    if (state.connected && state.generation !== loadedGeneration) {
        loadedGeneration = state.generation;
        cabinets.load();
    }
}

for (const button of tabs) {
    button.addEventListener('click', () => {
        const tab = button.dataset.tab as WorkspaceTab;
        showTab(tab);
        post({ command: 'selectTab', selected: tab });
    });
}

byId('wsConnect').addEventListener('click', () => post({ command: 'connect' }));

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'state':
            applyState(message as WorkspaceState);
            break;
        case 'selectTab':
            showTab(message.tab);
            break;
        case 'dump':
            dump.setContent(message as DumpContent);
            break;
        case 'cabinetsResult':
            cabinets.onResult(message);
            break;
        case 'refreshNode':
            cabinets.refreshNode(message.nodeId);
            break;
    }
});

post({ command: 'ready' });
