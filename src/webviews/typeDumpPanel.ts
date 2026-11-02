import { onActions, readWebviewData, vscode } from './common';
import { applyAttributeFilter, groupActions, onFilterInput } from './dumpPanelShared';

const { typeName } = readWebviewData<{ typeName?: string }>();
let showInherited = true;
let currentFilter = '';

function applyFilters(): void {
    applyAttributeFilter(currentFilter, 'type', showInherited);
}

onActions({
    ...groupActions,
    refresh: () => vscode.postMessage({ command: 'refresh' }),
    generateDql: () => vscode.postMessage({ command: 'generateDql' }),
    openType: el => vscode.postMessage({ command: 'openType', typeName: el.dataset.value }),
    copyTypeName: () => vscode.postMessage({ command: 'copyValue', value: typeName }),
    copyValue: el => vscode.postMessage({ command: 'copyValue', value: el.dataset.value })
});

onFilterInput(value => {
    currentFilter = value;
    applyFilters();
});

document.getElementById('showInherited')?.addEventListener('change', event => {
    showInherited = (event.target as HTMLInputElement).checked;
    applyFilters();
});
