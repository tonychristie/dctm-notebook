import { onActions, vscode } from './common';

onActions({
    exportCsv: () => {
        vscode.postMessage({ command: 'exportCsv' });
    },
    copyAll: () => {
        vscode.postMessage({ command: 'copyAll' });
    }
});
