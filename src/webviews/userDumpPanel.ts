import { onActions, readWebviewData, vscode } from './common';
import { applyAttributeFilter, groupActions, onFilterInput } from './dumpPanelShared';

const { userName } = readWebviewData<{ userName?: string }>();

onActions({
    ...groupActions,
    refresh: () => vscode.postMessage({ command: 'refresh' }),
    generateDql: () => vscode.postMessage({ command: 'generateDql' }),
    copyUserName: () => vscode.postMessage({ command: 'copyValue', value: userName }),
    copyValue: el => vscode.postMessage({ command: 'copyValue', value: el.dataset.value }),
    dumpObject: el => vscode.postMessage({ command: 'dumpObject', objectId: el.dataset.value }),
    openGroup: el => vscode.postMessage({ command: 'openGroup', groupName: el.dataset.value })
});

onFilterInput(value => applyAttributeFilter(value, 'value'));
