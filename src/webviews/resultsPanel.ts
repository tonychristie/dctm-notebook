import { renderResultsGrid, ResultsGridData } from '../results/resultsGrid';
import { byId, readWebviewData, vscode } from './common';

renderResultsGrid(byId('results'), readWebviewData<ResultsGridData>(), {
    dumpObject: objectId => vscode.postMessage({ command: 'dumpObject', objectId }),
    exportData: (format, columns, rows) => vscode.postMessage({ command: 'exportData', data: { format, columns, rows } })
});
