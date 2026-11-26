import { escapeHtml, isObjectIdLink } from '../htmlUtils';
import { SortDirection, sortRows } from './sortRows';
import { toTsv, toTsvRow } from './tsv';

export interface ResultsGridData {
    columns: string[];
    rows: Record<string, unknown>[];
    rowCount: number;
    executionTime: number;
}

export type ExportFormat = 'excel' | 'json';

export interface ResultsGridActions {
    dumpObject(objectId: string): void;
    exportData(format: ExportFormat, columns: string[], rows: Record<string, unknown>[]): void;
}

export function renderResultsGrid(
    element: HTMLElement,
    data: ResultsGridData,
    actions: ResultsGridActions
): void {
    let sortColumn: number | null = null;
    let sortDirection: SortDirection = 'asc';
    // The row object, not its index, so the selection stays on the same row after a sort.
    let selected: { row: Record<string, unknown>; col: number } | null = null;
    let sortedRows = [...data.rows];

    let resizing: { colIdx: number; th: HTMLElement } | null = null;
    let startX = 0;
    let startWidth = 0;

    element.innerHTML = '';

    const container = document.createElement('div');
    container.className = 'dql-result-container';
    element.appendChild(container);

    if (data.rows.length === 0) {
        container.innerHTML = `<div class="empty-result">
            Query executed successfully. No rows returned.
            <br><small>Execution time: ${data.executionTime}ms</small>
        </div>`;
        return;
    }

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
    exportExcelBtn.onclick = () => exportRows('excel', 'Exporting to Excel...');
    toolbar.appendChild(exportExcelBtn);

    const exportJsonBtn = document.createElement('button');
    exportJsonBtn.textContent = 'Export JSON';
    exportJsonBtn.title = 'Export results to JSON file (.json)';
    exportJsonBtn.onclick = () => exportRows('json', 'Exporting to JSON...');
    toolbar.appendChild(exportJsonBtn);

    container.appendChild(toolbar);

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

    const contextMenu = document.createElement('div');
    contextMenu.className = 'context-menu';
    contextMenu.style.display = 'none';
    container.appendChild(contextMenu);

    const notification = document.createElement('div');
    notification.className = 'copy-notification';
    container.appendChild(notification);

    function showNotification(msg: string): void {
        notification.textContent = msg;
        notification.classList.add('show');
        setTimeout(() => notification.classList.remove('show'), 2000);
    }

    function copyAllRows(): void {
        navigator.clipboard.writeText(toTsv(data.columns, sortedRows)).then(() => {
            showNotification(`Copied ${sortedRows.length} rows to clipboard`);
        });
    }

    function copySelectedRow(): void {
        if (!selected) {
            showNotification('No row selected');
            return;
        }
        navigator.clipboard.writeText(toTsvRow(data.columns, selected.row)).then(() => {
            showNotification('Row copied to clipboard');
        });
    }

    function exportRows(format: ExportFormat, message: string): void {
        actions.exportData(format, data.columns, sortedRows);
        showNotification(message);
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

        headerRow.querySelectorAll('.header-content').forEach((el, idx) => {
            (el as HTMLElement).onclick = () => sortTable(idx);
        });

        sortedRows = sortColumn === null
            ? [...data.rows]
            : sortRows(data.rows, data.columns[sortColumn], sortDirection);

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

        selectedCellElement()?.classList.add('selected');
        attachEventHandlers();
    }

    function selectedCellElement(): HTMLElement | null {
        if (!selected) {
            return null;
        }
        const rowIdx = sortedRows.indexOf(selected.row);
        return tbody.querySelector(`td[data-row="${rowIdx}"][data-col="${selected.col}"]`);
    }

    function selectCell(td: HTMLElement): void {
        selected = {
            row: sortedRows[parseInt(td.getAttribute('data-row') || '0')],
            col: parseInt(td.getAttribute('data-col') || '0')
        };
        tbody.querySelectorAll('td.selected').forEach(el => el.classList.remove('selected'));
        td.classList.add('selected');
    }

    function attachEventHandlers(): void {
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

        tbody.onclick = (e: MouseEvent) => {
            const td = (e.target as HTMLElement).closest('td');
            if (!td) {
                return;
            }

            selectCell(td);

            const objIdSpan = (e.target as HTMLElement).closest('.object-id') as HTMLElement | null;
            if (objIdSpan) {
                const objId = objIdSpan.getAttribute('data-object-id');
                if (objId) {
                    actions.dumpObject(objId);
                }
            }
        };

        tbody.oncontextmenu = (e: MouseEvent) => {
            const td = (e.target as HTMLElement).closest('td');
            if (!td) {
                return;
            }

            e.preventDefault();
            const value = td.getAttribute('data-value') || '';
            const colIdx = parseInt(td.getAttribute('data-col') || '0');
            const isObjId = !!td.querySelector('.object-id');

            selectCell(td);
            showContextMenu(e, value, isObjId, colIdx);
        };
    }

    function showContextMenu(e: MouseEvent, cellValue: string, isObjId: boolean, colIdx: number): void {
        contextMenu.innerHTML = '';

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

        const copyRow = document.createElement('div');
        copyRow.className = 'context-menu-item';
        copyRow.textContent = 'Copy Row';
        copyRow.onclick = () => {
            copySelectedRow();
            hideContextMenu();
        };
        contextMenu.appendChild(copyRow);

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

        if (isObjId) {
            const sep = document.createElement('div');
            sep.className = 'context-menu-separator';
            contextMenu.appendChild(sep);

            const dumpObj = document.createElement('div');
            dumpObj.className = 'context-menu-item';
            dumpObj.textContent = 'Dump Object';
            dumpObj.onclick = () => {
                actions.dumpObject(cellValue);
                hideContextMenu();
            };
            contextMenu.appendChild(dumpObj);
        }

        container.style.minHeight = '';
        contextMenu.style.display = 'block';
        document.addEventListener('click', onOutsideClick);
        const menuHeight = contextMenu.offsetHeight;
        const menuWidth = contextMenu.offsetWidth;

        // In a notebook, anything below the output is drawn under the next cell's editor, so grow
        // the output to fit the menu; VS Code moves the following cells down.
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
        if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
            const td = selectedCellElement();
            if (td) {
                navigator.clipboard.writeText(td.getAttribute('data-value') || '').then(() => {
                    showNotification('Cell copied');
                });
            }
        }
    });

    renderTable();
}
