/**
 * Notebook output renderer for Documentum DQL/API results
 *
 * This renderer handles the custom MIME type 'application/x-dctm-result'
 * and provides interactive features like:
 * - Clickable object IDs that open the dump panel
 * - Column sorting and resizing
 * - Copy functionality
 */

import type { RendererContext, OutputItem } from 'vscode-notebook-renderer';
import { escapeHtml, isObjectIdLink } from '../htmlUtils';
import { formatResultWithLinks } from '../webviewLogic';
import styles from './renderer.css';

interface DqlResultData {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
}

interface ApiResultData {
    type: 'api';
    result: string;
    resultType: string;
    executionTimeMs: number;
}

interface RendererMessage {
    command: string;
    objectId?: string;
    value?: string;
    data?: ExportData;
}

interface ExportData {
    columns: string[];
    rows: Record<string, unknown>[];
    format: 'excel' | 'json';
}

/**
 * Activate the renderer
 */
export function activate(context: RendererContext<void>): { renderOutputItem: (outputItem: OutputItem, element: HTMLElement) => void } {
    const style = document.createElement('style');
    style.textContent = styles;
    document.head.appendChild(style);

    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement): void {
            const data = outputItem.json() as DqlResultData | ApiResultData;

            // Check if this is an API result or DQL result
            if ('type' in data && data.type === 'api') {
                renderApiResult(element, data as ApiResultData, context);
            } else {
                renderDqlResult(element, data as DqlResultData, context);
            }
        }
    };
}

/**
 * Render DQL result as an interactive table
 */
function renderDqlResult(
    element: HTMLElement,
    data: DqlResultData,
    context: RendererContext<void>
): void {
    // State
    let sortColumn: number | null = null;
    let sortDirection: 'asc' | 'desc' = 'asc';
    let selectedCell: { row: number; col: number } | null = null;
    let selectedRow: number | null = null;
    let sortedRows = [...data.rows];

    // Resize state
    let resizing: { colIdx: number; th: HTMLElement } | null = null;
    let startX = 0;
    let startWidth = 0;

    // Build container
    element.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'dql-result-container';
    element.appendChild(container);

    // Handle empty results
    if (data.rows.length === 0) {
        container.innerHTML = `<div class="empty-result">
            Query executed successfully. No rows returned.
            <br><small>Execution time: ${data.executionTime}ms</small>
        </div>`;
        return;
    }

    // Toolbar
    const toolbar = document.createElement('div');
    toolbar.className = 'toolbar';
    toolbar.innerHTML = `
        <span class="status">${data.rowCount} row(s) in ${data.executionTime}ms</span>
    `;

    const copyAllBtn = document.createElement('button');
    copyAllBtn.textContent = 'Copy All';
    copyAllBtn.title = 'Copy all rows as TSV';
    copyAllBtn.onclick = () => copyAllRows();
    toolbar.appendChild(copyAllBtn);

    const copyRowBtn = document.createElement('button');
    copyRowBtn.textContent = 'Copy Row';
    copyRowBtn.title = 'Copy selected row';
    copyRowBtn.onclick = () => copySelectedRow();
    toolbar.appendChild(copyRowBtn);

    const exportExcelBtn = document.createElement('button');
    exportExcelBtn.textContent = 'Export Excel';
    exportExcelBtn.title = 'Export results to Excel file (.xlsx)';
    exportExcelBtn.onclick = () => exportToExcel();
    toolbar.appendChild(exportExcelBtn);

    const exportJsonBtn = document.createElement('button');
    exportJsonBtn.textContent = 'Export JSON';
    exportJsonBtn.title = 'Export results to JSON file (.json)';
    exportJsonBtn.onclick = () => exportToJson();
    toolbar.appendChild(exportJsonBtn);

    container.appendChild(toolbar);

    // Table container
    const tableContainer = document.createElement('div');
    tableContainer.className = 'table-container';
    // Cells cannot take focus, so the container must be focusable for its keydown listener to fire.
    tableContainer.tabIndex = 0;
    container.appendChild(tableContainer);

    const table = document.createElement('table');
    if (data.columns.length > 5) {
        table.className = 'wide';
    }
    tableContainer.appendChild(table);

    const thead = document.createElement('thead');
    table.appendChild(thead);

    const headerRow = document.createElement('tr');
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    table.appendChild(tbody);

    // Context menu
    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.display = 'none';
    container.appendChild(contextMenu);

    // Notification
    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    container.appendChild(notification);

    function showNotification(msg: string): void {
        notification.textContent = msg;
        notification.classList.add('show');
        setTimeout(() => notification.classList.remove('show'), 2000);
    }

    function dumpObject(objectId: string): void {
        // Send message to extension host
        if (context.postMessage) {
            context.postMessage({ command: 'dumpObject', objectId } as RendererMessage);
        }
    }

    function copyAllRows(): void {
        const header = data.columns.join('\t');
        const body = sortedRows.map(row =>
            data.columns.map(col => {
                const val = row[col];
                return val === null || val === undefined ? '' : String(val);
            }).join('\t')
        ).join('\n');
        const text = header + '\n' + body;
        navigator.clipboard.writeText(text).then(() => {
            showNotification(`Copied ${sortedRows.length} rows to clipboard`);
        });
    }

    function copySelectedRow(): void {
        if (selectedRow === null) {
            showNotification('No row selected');
            return;
        }
        const row = sortedRows[selectedRow];
        if (!row) {
            return;
        }
        const text = data.columns.map(col => {
            const val = row[col];
            return val === null || val === undefined ? '' : String(val);
        }).join('\t');
        navigator.clipboard.writeText(text).then(() => {
            showNotification('Row copied to clipboard');
        });
    }

    function exportToExcel(): void {
        // Send message to extension host to create Excel file
        if (context.postMessage) {
            context.postMessage({
                command: 'exportData',
                data: {
                    columns: data.columns,
                    rows: sortedRows,
                    format: 'excel'
                }
            } as RendererMessage);
            showNotification('Exporting to Excel...');
        }
    }

    function exportToJson(): void {
        // Send message to extension host to create JSON file
        if (context.postMessage) {
            context.postMessage({
                command: 'exportData',
                data: {
                    columns: data.columns,
                    rows: sortedRows,
                    format: 'json'
                }
            } as RendererMessage);
            showNotification('Exporting to JSON...');
        }
    }

    function sortTable(colIdx: number): void {
        if (sortColumn === colIdx) {
            sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
        } else {
            sortColumn = colIdx;
            sortDirection = 'asc';
        }
        renderTable();
    }

    function renderTable(): void {
        // Render headers
        headerRow.innerHTML = data.columns.map((col, idx) => {
            let sortClass = '';
            if (sortColumn === idx) {
                sortClass = sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc';
            }
            return `<th class="${sortClass}" data-col-idx="${idx}">
                <span class="header-content">${escapeHtml(col)}<span class="sort-indicator"></span></span>
                <span class="resize-handle" data-col-idx="${idx}"></span>
            </th>`;
        }).join('');

        // Add sort click handlers
        headerRow.querySelectorAll('.header-content').forEach((el, idx) => {
            (el as HTMLElement).onclick = () => sortTable(idx);
        });

        // Sort rows
        sortedRows = [...data.rows];
        if (sortColumn !== null) {
            const col = data.columns[sortColumn];
            sortedRows.sort((a, b) => {
                let aVal = a[col];
                let bVal = b[col];
                if (aVal === null || aVal === undefined) {
                    aVal = '';
                }
                if (bVal === null || bVal === undefined) {
                    bVal = '';
                }
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }
                const aStr = String(aVal).toLowerCase();
                const bStr = String(bVal).toLowerCase();
                if (aStr < bStr) {
                    return sortDirection === 'asc' ? -1 : 1;
                }
                if (aStr > bStr) {
                    return sortDirection === 'asc' ? 1 : -1;
                }
                return 0;
            });
        }

        // Render body
        tbody.innerHTML = sortedRows.map((row, rowIdx) => {
            const cells = data.columns.map((col, colIdx) => {
                const value = row[col];
                let displayValue: string;
                if (value === null || value === undefined) {
                    displayValue = '<span class="null-value">NULL</span>';
                } else if (isObjectIdLink(value) && (col === 'r_object_id' || col.endsWith('_id'))) {
                    displayValue = `<span class="object-id" data-object-id="${escapeHtml(String(value))}">${escapeHtml(String(value))}</span>`;
                } else {
                    displayValue = escapeHtml(String(value));
                }
                const dataValue = value === null || value === undefined ? '' : String(value);
                return `<td data-row="${rowIdx}" data-col="${colIdx}" data-value="${escapeHtml(dataValue)}" title="${escapeHtml(dataValue || 'NULL')}">${displayValue}</td>`;
            }).join('');
            return `<tr data-row-idx="${rowIdx}">${cells}</tr>`;
        }).join('');

        attachEventHandlers();
    }

    function attachEventHandlers(): void {
        // Resize handlers
        headerRow.querySelectorAll('.resize-handle').forEach(handle => {
            (handle as HTMLElement).onmousedown = (e: MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
                const colIdx = parseInt((handle as HTMLElement).getAttribute('data-col-idx') || '0');
                const th = (handle as HTMLElement).parentElement!;
                resizing = { colIdx, th };
                startX = e.pageX;
                startWidth = th.offsetWidth;
                (handle as HTMLElement).classList.add('resizing');
                document.body.style.cursor = 'col-resize';
                document.body.style.userSelect = 'none';
                // On document, not the table, so the drag continues when the mouse leaves the table.
                document.addEventListener('mousemove', onResizeMove);
                document.addEventListener('mouseup', onResizeEnd);
            };
        });

        // Cell click handler
        tbody.onclick = (e: MouseEvent) => {
            const td = (e.target as HTMLElement).closest('td');
            if (!td) {
                return;
            }

            // Clear previous selection
            tbody.querySelectorAll('td.selected').forEach(el => el.classList.remove('selected'));

            // Select this cell
            td.classList.add('selected');
            selectedCell = {
                row: parseInt(td.getAttribute('data-row') || '0'),
                col: parseInt(td.getAttribute('data-col') || '0')
            };
            selectedRow = selectedCell.row;

            // Handle object ID click
            const objIdSpan = (e.target as HTMLElement).closest('.object-id') as HTMLElement | null;
            if (objIdSpan) {
                const objId = objIdSpan.getAttribute('data-object-id');
                if (objId) {
                    dumpObject(objId);
                }
            }
        };

        // Context menu handler
        tbody.oncontextmenu = (e: MouseEvent) => {
            const td = (e.target as HTMLElement).closest('td');
            if (!td) {
                return;
            }

            e.preventDefault();
            const value = td.getAttribute('data-value') || '';
            const rowIdx = parseInt(td.getAttribute('data-row') || '0');
            const colIdx = parseInt(td.getAttribute('data-col') || '0');
            const objIdSpan = td.querySelector('.object-id');
            const isObjId = !!objIdSpan;

            selectedRow = rowIdx;
            showContextMenu(e, value, isObjId, rowIdx, colIdx);
        };
    }

    function showContextMenu(e: MouseEvent, cellValue: string, isObjId: boolean, rowIdx: number, colIdx: number): void {
        contextMenu.innerHTML = '';

        // Copy cell
        const copyCell = document.createElement('div');
        copyCell.className = 'context-menu-item';
        copyCell.textContent = 'Copy Cell';
        copyCell.onclick = () => {
            navigator.clipboard.writeText(cellValue).then(() => {
                showNotification('Cell copied');
            });
            hideContextMenu();
        };
        contextMenu.appendChild(copyCell);

        // Copy row
        const copyRow = document.createElement('div');
        copyRow.className = 'context-menu-item';
        copyRow.textContent = 'Copy Row';
        copyRow.onclick = () => {
            selectedRow = rowIdx;
            copySelectedRow();
            hideContextMenu();
        };
        contextMenu.appendChild(copyRow);

        // Copy column
        const copyCol = document.createElement('div');
        copyCol.className = 'context-menu-item';
        copyCol.textContent = 'Copy Column';
        copyCol.onclick = () => {
            const col = data.columns[colIdx];
            const values = sortedRows.map(r => {
                const v = r[col];
                return v === null || v === undefined ? '' : String(v);
            }).join('\n');
            navigator.clipboard.writeText(values).then(() => {
                showNotification('Column copied');
            });
            hideContextMenu();
        };
        contextMenu.appendChild(copyCol);

        // Dump object (for object IDs)
        if (isObjId) {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            contextMenu.appendChild(sep);

            const dumpObj = document.createElement('div');
            dumpObj.className = 'context-menu-item';
            dumpObj.textContent = 'Dump Object';
            dumpObj.onclick = () => {
                dumpObject(cellValue);
                hideContextMenu();
            };
            contextMenu.appendChild(dumpObj);
        }

        container.style.minHeight = '';
        contextMenu.style.display = 'block';
        document.addEventListener('click', onOutsideClick);
        const menuHeight = contextMenu.offsetHeight;
        const menuWidth = contextMenu.offsetWidth;

        // Anything below the output is drawn under the next cell's editor, so grow the
        // output to fit the menu; VS Code moves the following cells down.
        if (container.offsetHeight < menuHeight) {
            container.style.minHeight = menuHeight + 'px';
        }

        const rect = container.getBoundingClientRect();
        const top = Math.max(rect.top, Math.min(e.clientY, rect.bottom - menuHeight));
        const left = Math.max(rect.left, Math.min(e.clientX, rect.right - menuWidth));
        contextMenu.style.top = top + 'px';
        contextMenu.style.left = left + 'px';
    }

    function hideContextMenu(): void {
        contextMenu.style.display = 'none';
        container.style.minHeight = '';
        document.removeEventListener('click', onOutsideClick);
    }

    const onOutsideClick = (e: MouseEvent): void => {
        if (!contextMenu.contains(e.target as Node)) {
            hideContextMenu();
        }
    };

    const onResizeMove = (e: MouseEvent): void => {
        if (!resizing) {
            return;
        }
        const diff = e.pageX - startX;
        const newWidth = Math.max(60, startWidth + diff);
        resizing.th.style.width = newWidth + 'px';
        resizing.th.style.minWidth = newWidth + 'px';
        resizing.th.style.maxWidth = newWidth + 'px';
        table.querySelectorAll(`td:nth-child(${resizing.colIdx + 1})`).forEach(td => {
            (td as HTMLElement).style.maxWidth = newWidth + 'px';
        });
    };

    const onResizeEnd = (): void => {
        document.removeEventListener('mousemove', onResizeMove);
        document.removeEventListener('mouseup', onResizeEnd);
        if (!resizing) {
            return;
        }
        const handle = resizing.th.querySelector('.resize-handle');
        if (handle) {
            handle.classList.remove('resizing');
        }
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizing = null;
    };

    tableContainer.addEventListener('keydown', (e: KeyboardEvent) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectedCell) {
            const td = tbody.querySelector(`td[data-row="${selectedCell.row}"][data-col="${selectedCell.col}"]`) as HTMLElement | null;
            if (td) {
                navigator.clipboard.writeText(td.getAttribute('data-value') || '').then(() => {
                    showNotification('Cell copied');
                });
            }
        }
    });

    // Initial render
    renderTable();
}

/**
 * Render API result with clickable object IDs
 */
function renderApiResult(
    element: HTMLElement,
    data: ApiResultData,
    context: RendererContext<void>
): void {
    // Helper to dump an object
    function dumpObject(objectId: string): void {
        if (context.postMessage) {
            context.postMessage({ command: 'dumpObject', objectId } as RendererMessage);
        }
    }

    // Build container
    element.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'api-result-container';
    element.appendChild(container);

    // Meta info
    const meta = document.createElement('div');
    meta.className = 'result-meta';
    meta.textContent = `Result type: ${data.resultType} | Execution time: ${data.executionTimeMs}ms`;
    container.appendChild(meta);

    // Result content
    const content = document.createElement('div');
    content.className = 'result-content';
    const pre = document.createElement('pre');
    pre.innerHTML = formatResultWithLinks(data.result);
    content.appendChild(pre);
    container.appendChild(content);

    // Add click handler for object IDs
    container.addEventListener('click', (e: MouseEvent) => {
        const target = e.target as HTMLElement;
        if (target.classList.contains('object-id')) {
            const objectId = target.getAttribute('data-object-id');
            if (objectId) {
                dumpObject(objectId);
            }
        }
    });
}
