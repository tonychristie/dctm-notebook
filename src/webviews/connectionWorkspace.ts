import type { MethodInfo } from '../apiExecutor';
import { byId, vscode } from './common';
import { ApiResult, ApiTabView } from './workspace/apiTab';
import { CabinetsTabView } from './workspace/cabinetsTab';
import { DumpContent, DumpTabView } from './workspace/dumpTab';
import { EntitiesResult, EntityTabName, EntityTabView } from './workspace/entityTab';

type WorkspaceTab = 'cabinets' | EntityTabName | 'dump' | 'api';

interface WorkspaceState {
    connectionName: string;
    repository: string;
    username: string;
    connected: boolean;
    generation: number;
    activeTab: WorkspaceTab;
    apiMethods: Record<string, MethodInfo[]>;
}

const post = (message: object) => vscode.postMessage(message);
const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
const cabinets = new CabinetsTabView(byId('panel-cabinets'), post);
const dump = new DumpTabView(byId('panel-dump'), post);
const api = new ApiTabView(byId('panel-api'), post);
const entityTab = (tab: EntityTabName) => new EntityTabView(tab, byId(`panel-${tab}`), post, () => connectionName);
const entities: Record<EntityTabName, EntityTabView> = {
    types: entityTab('types'),
    users: entityTab('users'),
    groups: entityTab('groups')
};

let connectionName = '';
let activeTab: WorkspaceTab = 'cabinets';
let connected = false;
let loadedGeneration = 0;

function isEntityTab(tab: WorkspaceTab): tab is EntityTabName {
    return tab in entities;
}

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
    if (connected && isEntityTab(tab)) {
        entities[tab].ensureLoaded();
    }
    saveState();
}

function applyState(state: WorkspaceState): void {
    connectionName = state.connectionName;
    connected = state.connected;
    byId('wsName').textContent = state.connectionName;
    byId('wsInfo').textContent = state.username
        ? `${state.repository} as ${state.username}`
        : state.repository;
    byId('wsBanner').hidden = state.connected;
    api.setMethods(state.apiMethods);

    for (const button of tabs) {
        button.disabled = !state.connected;
    }
    document.querySelectorAll<HTMLElement>('[role="tabpanel"]').forEach(panel => {
        panel.inert = !state.connected;
        panel.classList.toggle('disabled', !state.connected);
    });

    if (state.connected && state.generation !== loadedGeneration) {
        loadedGeneration = state.generation;
        cabinets.load();
        Object.values(entities).forEach(view => view.reset());
    }

    showTab(state.activeTab);
}

for (const button of tabs) {
    button.addEventListener('click', () => {
        const tab = button.dataset.tab as WorkspaceTab;
        showTab(tab);
        post({ command: 'selectTab', selected: tab });
    });
}

byId('wsConnect').addEventListener('click', () => post({ command: 'connect' }));
byId('wsNewNotebook').addEventListener('click', () => post({ command: 'newNotebook' }));
byId('wsOpenNotebook').addEventListener('click', () => post({ command: 'openNotebook' }));

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
        case 'apiObjectId':
            api.setObjectId(message.objectId);
            break;
        case 'apiExecuting':
            api.showExecuting(message.method);
            break;
        case 'apiResult':
            api.showResult(message as ApiResult);
            break;
        case 'apiHistory':
            api.showHistory(message.history);
            break;
        case 'entities': {
            const result = message as EntitiesResult;
            entities[result.tab].onResult(result);
            break;
        }
    }
});

post({ command: 'ready' });
