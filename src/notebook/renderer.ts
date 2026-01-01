/**
 * Notebook output renderer for Documentum notebooks.
 *
 * This renderer handles the 'x-application/dctm-result' MIME type
 * to ensure HTML tables are displayed by default instead of JSON.
 */

import type { ActivationFunction, OutputItem, RendererContext } from 'vscode-notebook-renderer';

/**
 * Result data structure for DQL query results
 */
interface DqlResultData {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
}

/**
 * Result data structure for API command results
 */
interface ApiResultData {
    result: unknown;
    resultType: string;
    executionTimeMs: number;
}

type ResultData = DqlResultData | ApiResultData;

/**
 * Escape HTML special characters
 */
function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

/**
 * Check if data is a DQL result
 */
function isDqlResult(data: ResultData): data is DqlResultData {
    return 'columns' in data && 'rows' in data;
}

/**
 * Generate HTML table for DQL results
 */
function renderDqlResult(data: DqlResultData): string {
    if (data.rows.length === 0) {
        return `<div style="color: var(--vscode-descriptionForeground); padding: 8px;">
            Query executed successfully. No rows returned.
            <br><small>Execution time: ${data.executionTime}ms</small>
        </div>`;
    }

    const headerCells = data.columns
        .map(col => `<th style="text-align: left; padding: 6px 12px; border-bottom: 2px solid var(--vscode-panel-border); font-weight: 600; white-space: nowrap;">${escapeHtml(col)}</th>`)
        .join('');

    const bodyRows = data.rows.map(row => {
        const cells = data.columns.map(col => {
            const value = row[col];
            const displayValue = value === null || value === undefined
                ? '<span style="color: var(--vscode-descriptionForeground); font-style: italic;">NULL</span>'
                : escapeHtml(String(value));
            return `<td style="padding: 4px 12px; border-bottom: 1px solid var(--vscode-panel-border); white-space: nowrap; vertical-align: top;">${displayValue}</td>`;
        }).join('');
        return `<tr>${cells}</tr>`;
    }).join('');

    return `
        <div style="font-family: var(--vscode-font-family); font-size: 12px;">
            <div style="margin-bottom: 8px; color: var(--vscode-descriptionForeground);">
                ${data.rowCount} row(s) in ${data.executionTime}ms
            </div>
            <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                <table style="border-collapse: collapse; table-layout: auto;">
                    <thead style="position: sticky; top: 0; background: var(--vscode-editor-background);">
                        <tr>${headerCells}</tr>
                    </thead>
                    <tbody>${bodyRows}</tbody>
                </table>
            </div>
        </div>
    `;
}

/**
 * Format a value for display
 */
function formatValue(value: unknown): string {
    if (value === null || value === undefined) {
        return 'null';
    }
    if (typeof value === 'object') {
        return JSON.stringify(value, null, 2);
    }
    return String(value);
}

/**
 * Render API result
 */
function renderApiResult(data: ApiResultData): string {
    const formattedResult = formatValue(data.result);

    return `
        <div style="font-family: var(--vscode-font-family); font-size: 12px;">
            <div style="margin-bottom: 8px; color: var(--vscode-descriptionForeground);">
                Result type: ${data.resultType} | Execution time: ${data.executionTimeMs}ms
            </div>
            <div style="background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; font-family: var(--vscode-editor-font-family);">
                <pre style="margin: 0; white-space: pre-wrap;">${escapeHtml(formattedResult)}</pre>
            </div>
        </div>
    `;
}

/**
 * Activation function for the notebook renderer
 */
export const activate: ActivationFunction = (_context: RendererContext<void>) => {
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement) {
            const data = outputItem.json() as ResultData;

            if (isDqlResult(data)) {
                element.innerHTML = renderDqlResult(data);
            } else {
                element.innerHTML = renderApiResult(data as ApiResultData);
            }
        }
    };
};
