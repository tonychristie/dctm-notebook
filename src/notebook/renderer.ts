import type { RendererContext, OutputItem } from 'vscode-notebook-renderer';
import { formatResultWithLinks } from '../webviewLogic';
import { renderResultsGrid, ResultsGridData } from '../results/resultsGrid';
import gridStyles from '../results/resultsGrid.css';
import styles from './renderer.css';

interface ApiResultData {
    type: 'api';
    result: string;
    resultType: string;
    executionTimeMs: number;
}

export function activate(context: RendererContext<void>): { renderOutputItem: (outputItem: OutputItem, element: HTMLElement) => void } {
    const style = document.createElement('style');
    style.textContent = gridStyles + '\n' + styles;
    document.head.appendChild(style);

    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement): void {
            const data = outputItem.json() as ResultsGridData | ApiResultData;

            if ('type' in data && data.type === 'api') {
                renderApiResult(element, data as ApiResultData, context);
            } else {
                element.classList.add('notebook-output');
                renderResultsGrid(element, data as ResultsGridData, {
                    dumpObject: objectId => context.postMessage?.({ command: 'dumpObject', objectId }),
                    exportData: (format, columns, rows) =>
                        context.postMessage?.({ command: 'exportData', data: { columns, rows, format } })
                });
            }
        }
    };
}

function renderApiResult(
    element: HTMLElement,
    data: ApiResultData,
    context: RendererContext<void>
): void {
    element.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'api-result-container';
    element.appendChild(container);

    const meta = document.createElement('div');
    meta.className = 'result-meta';
    meta.textContent = `Result type: ${data.resultType} | Execution time: ${data.executionTimeMs}ms`;
    container.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'result-content';
    const pre = document.createElement('pre');
    pre.innerHTML = formatResultWithLinks(data.result);
    content.appendChild(pre);
    container.appendChild(content);

    container.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('object-id')) {
            const objectId = target.getAttribute('data-object-id');
            if (objectId) {
                context.postMessage?.({ command: 'dumpObject', objectId });
            }
        }
    });
}
