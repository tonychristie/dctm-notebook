import { onActions, readWebviewData, vscode } from './common';
import { applyAttributeFilter, groupActions, onFilterInput } from './dumpPanelShared';

const { groupName } = readWebviewData<{ groupName?: string }>();

onActions({
    ...groupActions,
    refresh: () => vscode.postMessage({ command: 'refresh' }),
    generateDql: () => vscode.postMessage({ command: 'generateDql' }),
    copyGroupName: () => vscode.postMessage({ command: 'copyValue', value: groupName }),
    copyValue: el => vscode.postMessage({ command: 'copyValue', value: el.dataset.value }),
    dumpObject: el => vscode.postMessage({ command: 'dumpObject', objectId: el.dataset.value }),
    openGroup: el => vscode.postMessage({ command: 'openGroup', groupName: el.dataset.value }),
    openUser: el => vscode.postMessage({ command: 'openUser', userName: el.dataset.value })
});

onFilterInput(value => applyAttributeFilter(value, 'value'));
