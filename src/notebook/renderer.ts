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

interface DqlResultData {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
}

interface RendererMessage {
    command: string;
    objectId?: string;
    value?: string;
}

/**
 * Activate the renderer
 */
export function activate(context: RendererContext<void>): { renderOutputItem: (outputItem: OutputItem, element: HTMLElement) => void } {
    return {
        renderOutputItem(outputItem: OutputItem, element: HTMLElement): void {
            const data = outputItem.json() as DqlResultData;
            renderDqlResult(element, data, context);
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
    const tableId = `dql-table-${Date.now()}`;

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

    // Calculate column width based on number of columns
    // For <= 5 columns, use 20% each; for more, use fixed width with scroll
    const numColumns = data.columns.length;
    const columnWidth = numColumns <= 5 ? `${100 / numColumns}%` : '180px';
    const tableWidth = numColumns <= 5 ? '100%' : 'auto';

    // Create styles
    const style = document.createElement('style');
    style.textContent = `
        .dql-result-container table {
            border-collapse: collapse;
            table-layout: fixed;
            width: ${tableWidth};
        }
        .dql-result-container th {
            text-align: left;
            padding: 6px 12px;
            border-bottom: 2px solid var(--vscode-panel-border);
            font-weight: 600;
            white-space: nowrap;
            user-select: none;
            position: relative;
            min-width: 80px;
            width: ${columnWidth};
            max-width: 300px;
        }
        .dql-result-container th:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .dql-result-container th .sort-indicator {
            margin-left: 4px;
            opacity: 0.5;
        }
        .dql-result-container th.sorted-asc .sort-indicator::after { content: ' \\25B2'; }
        .dql-result-container th.sorted-desc .sort-indicator::after { content: ' \\25BC'; }
        .dql-result-container th .resize-handle {
            position: absolute;
            right: 0;
            top: 0;
            bottom: 0;
            width: 5px;
            cursor: col-resize;
            background: transparent;
        }
        .dql-result-container th .resize-handle:hover,
        .dql-result-container th .resize-handle.resizing {
            background: var(--vscode-focusBorder);
        }
        .dql-result-container th .header-content {
            cursor: pointer;
            display: inline-block;
        }
        .dql-result-container td {
            text-align: left;
            padding: 4px 12px;
            border-bottom: 1px solid var(--vscode-panel-border);
            vertical-align: top;
            width: ${columnWidth};
            max-width: 300px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
            cursor: pointer;
        }
        .dql-result-container td:hover {
            background: var(--vscode-list-hoverBackground);
        }
        .dql-result-container td.selected {
            background: var(--vscode-list-activeSelectionBackground);
            color: var(--vscode-list-activeSelectionForeground);
        }
        .dql-result-container tr:hover td {
            background: var(--vscode-list-hoverBackground);
        }
        .dql-result-container .null-value {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .dql-result-container .object-id {
            color: var(--vscode-textLink-foreground);
            text-decoration: underline;
            cursor: pointer;
        }
        .dql-result-container .context-menu {
            position: fixed;
            background: var(--vscode-menu-background);
            border: 1px solid var(--vscode-menu-border);
            border-radius: 4px;
            padding: 4px 0;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 1000;
            min-width: 150px;
        }
        .dql-result-container .context-menu-item {
            padding: 6px 12px;
            cursor: pointer;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .dql-result-container .context-menu-item:hover {
            background: var(--vscode-menu-selectionBackground);
            color: var(--vscode-menu-selectionForeground);
        }
        .dql-result-container .context-menu-separator {
            height: 1px;
            background: var(--vscode-menu-separatorBackground);
            margin: 4px 0;
        }
        .dql-result-container .toolbar {
            display: flex;
            gap: 8px;
            margin-bottom: 8px;
            align-items: center;
        }
        .dql-result-container .toolbar button {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
            border: none;
            padding: 4px 8px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 11px;
        }
        .dql-result-container .toolbar button:hover {
            background: var(--vscode-button-secondaryHoverBackground);
        }
        .dql-result-container .status {
            color: var(--vscode-descriptionForeground);
            flex-grow: 1;
        }
        .dql-result-container .copy-notification {
            position: fixed;
            bottom: 20px;
            right: 20px;
            background: var(--vscode-notifications-background);
            color: var(--vscode-notifications-foreground);
            padding: 8px 16px;
            border-radius: 4px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.2);
            z-index: 1001;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .dql-result-container .copy-notification.show {
            opacity: 1;
        }
    `;

    // Build container
    element.innerHTML = '';
    element.appendChild(style);

    const container = document.createElement('div');
    container.className = 'dql-result-container';
    container.style.cssText = 'font-family: var(--vscode-font-family); font-size: 12px;';
    element.appendChild(container);

    // Handle empty results
    if (data.rows.length === 0) {
        container.innerHTML = `<div style="color: var(--vscode-descriptionForeground); padding: 8px;">
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

    container.appendChild(toolbar);

    // Table container
    const tableContainer = document.createElement('div');
    tableContainer.style.cssText = 'overflow-x: auto; max-height: 400px; overflow-y: auto;';
    container.appendChild(tableContainer);

    const table = document.createElement('table');
    table.id = tableId;
    tableContainer.appendChild(table);

    const thead = document.createElement('thead');
    thead.style.cssText = 'position: sticky; top: 0; background: var(--vscode-editor-background);';
    table.appendChild(thead);

    const headerRow = document.createElement('tr');
    headerRow.id = `${tableId}-header`;
    thead.appendChild(headerRow);

    const tbody = document.createElement('tbody');
    tbody.id = `${tableId}-body`;
    table.appendChild(tbody);

    // Context menu
    const contextMenu = document.createElement('div');
    contextMenu.id = `${tableId}-context-menu`;
    contextMenu.className = 'context-menu';
    contextMenu.style.display = 'none';
    container.appendChild(contextMenu);

    // Notification
    const notification = document.createElement('div');
    notification.id = `${tableId}-notification`;
    notification.className = 'copy-notification';
    container.appendChild(notification);

    // Helper functions
    function escapeHtml(text: unknown): string {
        if (text === null || text === undefined) return '';
        const div = document.createElement('div');
        div.textContent = String(text);
        return div.innerHTML;
    }

    function isObjectId(value: unknown): boolean {
        if (typeof value !== 'string') return false;
        return /^[0-9a-f]{16}$/i.test(value);
    }

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
        if (!row) return;
        const text = data.columns.map(col => {
            const val = row[col];
            return val === null || val === undefined ? '' : String(val);
        }).join('\t');
        navigator.clipboard.writeText(text).then(() => {
            showNotification('Row copied to clipboard');
        });
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
                if (aVal === null || aVal === undefined) aVal = '';
                if (bVal === null || bVal === undefined) bVal = '';
                if (typeof aVal === 'number' && typeof bVal === 'number') {
                    return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                }
                const aStr = String(aVal).toLowerCase();
                const bStr = String(bVal).toLowerCase();
                if (aStr < bStr) return sortDirection === 'asc' ? -1 : 1;
                if (aStr > bStr) return sortDirection === 'asc' ? 1 : -1;
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
                } else if (isObjectId(value) && (col === 'r_object_id' || col.endsWith('_id'))) {
                    displayValue = `<span class="object-id" data-object-id="${escapeHtml(value)}">${escapeHtml(value)}</span>`;
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
            };
        });

        // Cell click handler
        tbody.onclick = (e: MouseEvent) => {
            const td = (e.target as HTMLElement).closest('td');
            if (!td) return;

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
            if (!td) return;

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

        contextMenu.style.left = e.pageX + 'px';
        contextMenu.style.top = e.pageY + 'px';
        contextMenu.style.display = 'block';
    }

    function hideContextMenu(): void {
        contextMenu.style.display = 'none';
    }

    // Global event handlers
    document.addEventListener('mousemove', (e: MouseEvent) => {
        if (!resizing) return;
        const diff = e.pageX - startX;
        const newWidth = Math.max(60, startWidth + diff);
        resizing.th.style.width = newWidth + 'px';
        resizing.th.style.minWidth = newWidth + 'px';
        resizing.th.style.maxWidth = newWidth + 'px';
        // Update td cells in this column
        const tds = document.querySelectorAll(`#${tableId} td:nth-child(${resizing.colIdx + 1})`);
        tds.forEach(td => {
            (td as HTMLElement).style.maxWidth = newWidth + 'px';
        });
    });

    document.addEventListener('mouseup', () => {
        if (!resizing) return;
        const handle = resizing.th.querySelector('.resize-handle');
        if (handle) handle.classList.remove('resizing');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
        resizing = null;
    });

    document.addEventListener('click', (e: MouseEvent) => {
        if (!(e.target as HTMLElement).closest('.context-menu')) {
            hideContextMenu();
        }
    });

    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.ctrlKey && e.key === 'c' && selectedCell) {
            const td = document.querySelector(`#${tableId} td[data-row="${selectedCell.row}"][data-col="${selectedCell.col}"]`) as HTMLElement | null;
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
