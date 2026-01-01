import * as vscode from 'vscode';
import { ConnectionManager } from '../connectionManager';
import { DqlExecutor, DqlResult } from '../dqlExecutor';
import { ApiExecutor, ApiMethodRequest, ApiMethodResponse } from '../apiExecutor';

/**
 * Notebook controller for executing DQL queries and API commands
 *
 * This controller handles execution of cells in .dctmbook notebooks,
 * connecting to Documentum via the DFC Bridge and rendering results inline.
 */
export class DctmNotebookController {
    readonly controllerId = 'dctm-notebook-controller';
    readonly notebookType = 'dctmbook';
    readonly label = 'Documentum Notebook';
    readonly supportedLanguages = ['dql', 'dmapi'];

    private readonly controller: vscode.NotebookController;
    private executionOrder = 0;

    private connectionManager: ConnectionManager;
    private dqlExecutor: DqlExecutor;
    private apiExecutor: ApiExecutor;

    constructor(
        connectionManager: ConnectionManager,
        dqlExecutor: DqlExecutor,
        apiExecutor: ApiExecutor
    ) {
        this.connectionManager = connectionManager;
        this.dqlExecutor = dqlExecutor;
        this.apiExecutor = apiExecutor;

        this.controller = vscode.notebooks.createNotebookController(
            this.controllerId,
            this.notebookType,
            this.label
        );

        this.controller.supportedLanguages = this.supportedLanguages;
        this.controller.supportsExecutionOrder = true;
        this.controller.executeHandler = this.executeHandler.bind(this);
    }

    /**
     * Execute handler for notebook cells
     */
    private async executeHandler(
        cells: vscode.NotebookCell[],
        _notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        for (const cell of cells) {
            await this.executeCell(cell);
        }
    }

    /**
     * Execute a single notebook cell
     */
    private async executeCell(cell: vscode.NotebookCell): Promise<void> {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());

        try {
            // Check connection
            const connection = this.connectionManager.getActiveConnection();
            if (!connection) {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error(
                            new Error('Not connected to Documentum. Use "Documentum: Connect" first.')
                        )
                    ])
                ]);
                execution.end(false, Date.now());
                return;
            }

            const content = cell.document.getText().trim();
            if (!content) {
                execution.replaceOutput([]);
                execution.end(true, Date.now());
                return;
            }

            // Get output format preference from cell metadata, default to 'html'
            const outputFormat = (cell.metadata?.outputFormat as string) || 'html';

            // Execute based on language
            const language = cell.document.languageId;

            if (language === 'dql') {
                await this.executeDql(content, execution, outputFormat);
            } else if (language === 'dmapi') {
                await this.executeApi(content, execution, outputFormat);
            } else {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error(
                            new Error(`Unsupported language: ${language}`)
                        )
                    ])
                ]);
                execution.end(false, Date.now());
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(
                        new Error(errorMessage)
                    )
                ])
            ]);
            execution.end(false, Date.now());
        }
    }

    /**
     * Strip comments from DQL queries.
     * Handles both line comments (--) and block comments.
     */
    private stripDqlComments(query: string): string {
        // Remove block comments (/* ... */) - non-greedy match across lines
        let stripped = query.replace(/\/\*[\s\S]*?\*\//g, '');

        // Remove line comments (-- to end of line)
        stripped = stripped.replace(/--.*$/gm, '');

        // Clean up extra whitespace and empty lines
        stripped = stripped
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');

        return stripped.trim();
    }

    /**
     * Strip comments from dmAPI commands.
     * Handles line comments (--)
     */
    private stripDmApiComments(command: string): string {
        // Remove line comments (-- to end of line)
        let stripped = command.replace(/--.*$/gm, '');

        // Clean up extra whitespace and empty lines
        stripped = stripped
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join('\n');

        return stripped.trim();
    }

    /**
     * Execute a DQL query and render results
     */
    private async executeDql(
        query: string,
        execution: vscode.NotebookCellExecution,
        outputFormat: string
    ): Promise<void> {
        try {
            // Strip comments before execution
            const cleanQuery = this.stripDqlComments(query);
            if (!cleanQuery) {
                execution.replaceOutput([]);
                execution.end(true, Date.now());
                return;
            }
            const result = await this.dqlExecutor.execute(cleanQuery);
            const output = this.formatDqlOutput(result, outputFormat);

            execution.replaceOutput([output]);
            execution.end(true, Date.now());
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(
                        new Error(`DQL Error: ${errorMessage}`)
                    )
                ])
            ]);
            execution.end(false, Date.now());
        }
    }

    /**
     * Format DQL results as notebook output
     */
    private formatDqlOutput(result: DqlResult, outputFormat: string): vscode.NotebookCellOutput {
        // Plain text summary
        const text = `${result.rowCount} row(s) returned in ${result.executionTime}ms`;

        const resultData = {
            columns: result.columns,
            rows: result.rows,
            rowCount: result.rowCount,
            executionTime: result.executionTime
        };

        // Emit output based on format preference
        // First item in the array is the default rendered view
        if (outputFormat === 'json') {
            return new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.json(resultData, 'application/json'),
                vscode.NotebookCellOutputItem.text(text, 'text/plain')
            ]);
        } else {
            // Default to HTML
            const html = this.generateHtmlTable(result);
            return new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(html, 'text/html'),
                vscode.NotebookCellOutputItem.text(text, 'text/plain')
            ]);
        }
    }

    /**
     * Generate an HTML table for DQL results with sorting, copying, and context menu
     */
    private generateHtmlTable(result: DqlResult): string {
        if (result.rows.length === 0) {
            return `<div style="color: var(--vscode-descriptionForeground); padding: 8px;">
                Query executed successfully. No rows returned.
                <br><small>Execution time: ${result.executionTime}ms</small>
            </div>`;
        }

        // Embed the data as JSON for client-side sorting
        const dataJson = JSON.stringify({
            columns: result.columns,
            rows: result.rows
        });

        const tableId = `dql-table-${Date.now()}`;

        return `
            <div style="font-family: var(--vscode-font-family); font-size: 12px;" class="dql-result-container">
                <style>
                    .dql-result-container table {
                        border-collapse: collapse;
                        table-layout: fixed;
                        width: auto;
                        min-width: 100%;
                    }
                    .dql-result-container th {
                        text-align: left;
                        padding: 6px 12px;
                        border-bottom: 2px solid var(--vscode-panel-border);
                        font-weight: 600;
                        white-space: nowrap;
                        user-select: none;
                        position: relative;
                        min-width: 60px;
                    }
                    .dql-result-container th:hover {
                        background: var(--vscode-list-hoverBackground);
                    }
                    .dql-result-container th .sort-indicator {
                        margin-left: 4px;
                        opacity: 0.5;
                    }
                    .dql-result-container th.sorted-asc .sort-indicator::after { content: ' ▲'; }
                    .dql-result-container th.sorted-desc .sort-indicator::after { content: ' ▼'; }
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
                        padding: 4px 12px;
                        border-bottom: 1px solid var(--vscode-panel-border);
                        vertical-align: top;
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
                </style>
                <div class="toolbar">
                    <span class="status">${result.rowCount} row(s) in ${result.executionTime}ms</span>
                    <button onclick="copyAllRows_${tableId}()" title="Copy all rows as TSV">Copy All</button>
                    <button onclick="copySelectedRow_${tableId}()" title="Copy selected row">Copy Row</button>
                </div>
                <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                    <table id="${tableId}">
                        <thead style="position: sticky; top: 0; background: var(--vscode-editor-background);">
                            <tr id="${tableId}-header"></tr>
                        </thead>
                        <tbody id="${tableId}-body"></tbody>
                    </table>
                </div>
                <div id="${tableId}-context-menu" class="context-menu" style="display: none;"></div>
                <div id="${tableId}-notification" class="copy-notification"></div>
                <script>
                    (function() {
                        const tableId = '${tableId}';
                        const data = ${dataJson};
                        let sortColumn = null;
                        let sortDirection = 'asc';
                        let selectedCell = null;
                        let selectedRow = null;

                        function escapeHtml(text) {
                            if (text === null || text === undefined) return '';
                            const div = document.createElement('div');
                            div.textContent = String(text);
                            return div.innerHTML;
                        }

                        function isObjectId(value) {
                            if (typeof value !== 'string') return false;
                            return /^[0-9a-f]{16}$/i.test(value);
                        }

                        // Column resize state
                        let resizing = null;
                        let startX = 0;
                        let startWidth = 0;

                        function renderTable() {
                            const headerRow = document.getElementById(tableId + '-header');
                            const tbody = document.getElementById(tableId + '-body');

                            // Render headers with resize handles
                            headerRow.innerHTML = data.columns.map((col, idx) => {
                                let sortClass = '';
                                if (sortColumn === idx) {
                                    sortClass = sortDirection === 'asc' ? 'sorted-asc' : 'sorted-desc';
                                }
                                return '<th class="' + sortClass + '" data-col-idx="' + idx + '">' +
                                    '<span class="header-content" onclick="sortTable_${tableId}(' + idx + ')">' +
                                    escapeHtml(col) + '<span class="sort-indicator"></span></span>' +
                                    '<span class="resize-handle" data-col-idx="' + idx + '"></span></th>';
                            }).join('');

                            // Sort rows if needed
                            let rows = [...data.rows];
                            if (sortColumn !== null) {
                                const col = data.columns[sortColumn];
                                rows.sort((a, b) => {
                                    let aVal = a[col];
                                    let bVal = b[col];
                                    if (aVal === null || aVal === undefined) aVal = '';
                                    if (bVal === null || bVal === undefined) bVal = '';
                                    if (typeof aVal === 'number' && typeof bVal === 'number') {
                                        return sortDirection === 'asc' ? aVal - bVal : bVal - aVal;
                                    }
                                    aVal = String(aVal).toLowerCase();
                                    bVal = String(bVal).toLowerCase();
                                    if (aVal < bVal) return sortDirection === 'asc' ? -1 : 1;
                                    if (aVal > bVal) return sortDirection === 'asc' ? 1 : -1;
                                    return 0;
                                });
                            }

                            // Render body
                            tbody.innerHTML = rows.map((row, rowIdx) => {
                                const cells = data.columns.map((col, colIdx) => {
                                    const value = row[col];
                                    let displayValue, cellClass = '';
                                    if (value === null || value === undefined) {
                                        displayValue = '<span class="null-value">NULL</span>';
                                    } else if (isObjectId(value) && (col === 'r_object_id' || col.endsWith('_id'))) {
                                        displayValue = '<span class="object-id" data-object-id="' + escapeHtml(value) + '">' + escapeHtml(value) + '</span>';
                                    } else {
                                        displayValue = escapeHtml(String(value));
                                    }
                                    return '<td data-row="' + rowIdx + '" data-col="' + colIdx + '" data-value="' +
                                        escapeHtml(value === null || value === undefined ? '' : String(value)) +
                                        '" title="' + escapeHtml(value === null || value === undefined ? 'NULL' : String(value)) +
                                        '">' + displayValue + '</td>';
                                }).join('');
                                return '<tr data-row-idx="' + rowIdx + '">' + cells + '</tr>';
                            }).join('');

                            // Store sorted rows for copying
                            window['sortedRows_' + tableId] = rows;

                            // Attach resize handlers after rendering
                            attachResizeHandlers();
                        }

                        function attachResizeHandlers() {
                            const handles = document.querySelectorAll('#' + tableId + ' .resize-handle');
                            handles.forEach(handle => {
                                handle.addEventListener('mousedown', function(e) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const colIdx = parseInt(this.getAttribute('data-col-idx'));
                                    const th = this.parentElement;
                                    resizing = { colIdx, th };
                                    startX = e.pageX;
                                    startWidth = th.offsetWidth;
                                    this.classList.add('resizing');
                                    document.body.style.cursor = 'col-resize';
                                    document.body.style.userSelect = 'none';
                                });
                            });
                        }

                        document.addEventListener('mousemove', function(e) {
                            if (!resizing) return;
                            const diff = e.pageX - startX;
                            const newWidth = Math.max(60, startWidth + diff);
                            resizing.th.style.width = newWidth + 'px';
                            resizing.th.style.minWidth = newWidth + 'px';
                            resizing.th.style.maxWidth = newWidth + 'px';
                            // Also update td cells in this column
                            const tds = document.querySelectorAll('#' + tableId + ' td:nth-child(' + (resizing.colIdx + 1) + ')');
                            tds.forEach(td => {
                                td.style.maxWidth = newWidth + 'px';
                            });
                        });

                        document.addEventListener('mouseup', function(e) {
                            if (!resizing) return;
                            const handle = resizing.th.querySelector('.resize-handle');
                            if (handle) handle.classList.remove('resizing');
                            document.body.style.cursor = '';
                            document.body.style.userSelect = '';
                            resizing = null;
                        });

                        window['sortTable_${tableId}'] = function(colIdx) {
                            if (sortColumn === colIdx) {
                                sortDirection = sortDirection === 'asc' ? 'desc' : 'asc';
                            } else {
                                sortColumn = colIdx;
                                sortDirection = 'asc';
                            }
                            renderTable();
                        };

                        window['copyAllRows_${tableId}'] = function() {
                            const rows = window['sortedRows_' + tableId] || data.rows;
                            const header = data.columns.join('\\t');
                            const body = rows.map(row =>
                                data.columns.map(col => {
                                    const val = row[col];
                                    return val === null || val === undefined ? '' : String(val);
                                }).join('\\t')
                            ).join('\\n');
                            const text = header + '\\n' + body;
                            navigator.clipboard.writeText(text).then(() => {
                                showNotification('Copied ' + rows.length + ' rows to clipboard');
                            });
                        };

                        window['copySelectedRow_${tableId}'] = function() {
                            if (selectedRow === null) {
                                showNotification('No row selected');
                                return;
                            }
                            const rows = window['sortedRows_' + tableId] || data.rows;
                            const row = rows[selectedRow];
                            if (!row) return;
                            const text = data.columns.map(col => {
                                const val = row[col];
                                return val === null || val === undefined ? '' : String(val);
                            }).join('\\t');
                            navigator.clipboard.writeText(text).then(() => {
                                showNotification('Row copied to clipboard');
                            });
                        };

                        function showNotification(msg) {
                            const notif = document.getElementById(tableId + '-notification');
                            notif.textContent = msg;
                            notif.classList.add('show');
                            setTimeout(() => notif.classList.remove('show'), 2000);
                        }

                        function showContextMenu(e, cellValue, isObjectId, rowIdx, colIdx) {
                            e.preventDefault();
                            const menu = document.getElementById(tableId + '-context-menu');
                            menu.innerHTML = '';

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
                            menu.appendChild(copyCell);

                            // Copy row
                            const copyRow = document.createElement('div');
                            copyRow.className = 'context-menu-item';
                            copyRow.textContent = 'Copy Row';
                            copyRow.onclick = () => {
                                selectedRow = rowIdx;
                                window['copySelectedRow_${tableId}']();
                                hideContextMenu();
                            };
                            menu.appendChild(copyRow);

                            // Copy column
                            const copyCol = document.createElement('div');
                            copyCol.className = 'context-menu-item';
                            copyCol.textContent = 'Copy Column';
                            copyCol.onclick = () => {
                                const rows = window['sortedRows_' + tableId] || data.rows;
                                const col = data.columns[colIdx];
                                const values = rows.map(r => {
                                    const v = r[col];
                                    return v === null || v === undefined ? '' : String(v);
                                }).join('\\n');
                                navigator.clipboard.writeText(values).then(() => {
                                    showNotification('Column copied');
                                });
                                hideContextMenu();
                            };
                            menu.appendChild(copyCol);

                            // Dump object (for object IDs)
                            if (isObjectId) {
                                const sep = document.createElement('div');
                                sep.className = 'context-menu-separator';
                                menu.appendChild(sep);

                                const dumpObj = document.createElement('div');
                                dumpObj.className = 'context-menu-item';
                                dumpObj.textContent = 'Dump Object';
                                dumpObj.onclick = () => {
                                    // Use VS Code command API via postMessage (will be handled by extension)
                                    const vscode = acquireVsCodeApi ? acquireVsCodeApi() : null;
                                    if (vscode) {
                                        vscode.postMessage({ command: 'dumpObject', objectId: cellValue });
                                    }
                                    hideContextMenu();
                                };
                                menu.appendChild(dumpObj);
                            }

                            menu.style.left = e.pageX + 'px';
                            menu.style.top = e.pageY + 'px';
                            menu.style.display = 'block';
                        }

                        function hideContextMenu() {
                            document.getElementById(tableId + '-context-menu').style.display = 'none';
                        }

                        // Event listeners
                        document.getElementById(tableId + '-body').addEventListener('click', function(e) {
                            const td = e.target.closest('td');
                            if (!td) return;

                            // Clear previous selection
                            document.querySelectorAll('#' + tableId + ' td.selected').forEach(el => el.classList.remove('selected'));

                            // Select this cell
                            td.classList.add('selected');
                            selectedCell = { row: parseInt(td.dataset.row), col: parseInt(td.dataset.col) };
                            selectedRow = parseInt(td.dataset.row);

                            // Handle object ID click
                            const objIdSpan = e.target.closest('.object-id');
                            if (objIdSpan) {
                                const objId = objIdSpan.dataset.objectId;
                                const vscode = typeof acquireVsCodeApi !== 'undefined' ? acquireVsCodeApi() : null;
                                if (vscode) {
                                    vscode.postMessage({ command: 'dumpObject', objectId: objId });
                                }
                            }
                        });

                        document.getElementById(tableId + '-body').addEventListener('contextmenu', function(e) {
                            const td = e.target.closest('td');
                            if (!td) return;

                            const value = td.dataset.value;
                            const rowIdx = parseInt(td.dataset.row);
                            const colIdx = parseInt(td.dataset.col);
                            const objIdSpan = td.querySelector('.object-id');
                            const isObjId = !!objIdSpan;

                            selectedRow = rowIdx;
                            showContextMenu(e, value, isObjId, rowIdx, colIdx);
                        });

                        document.addEventListener('click', function(e) {
                            if (!e.target.closest('.context-menu')) {
                                hideContextMenu();
                            }
                        });

                        // Keyboard shortcuts
                        document.addEventListener('keydown', function(e) {
                            if (e.ctrlKey && e.key === 'c' && selectedCell) {
                                const td = document.querySelector('#' + tableId + ' td[data-row="' + selectedCell.row + '"][data-col="' + selectedCell.col + '"]');
                                if (td) {
                                    navigator.clipboard.writeText(td.dataset.value).then(() => {
                                        showNotification('Cell copied');
                                    });
                                }
                            }
                        });

                        // Initial render
                        renderTable();
                    })();
                </script>
            </div>
        `;
    }

    /**
     * Execute an API command
     */
    private async executeApi(
        command: string,
        execution: vscode.NotebookCellExecution,
        outputFormat: string
    ): Promise<void> {
        try {
            // Strip comments before execution
            const cleanCommand = this.stripDmApiComments(command);
            if (!cleanCommand) {
                execution.replaceOutput([]);
                execution.end(true, Date.now());
                return;
            }
            const trimmed = cleanCommand.trim();

            // Check if this is a dmAPI command (dmAPIGet, dmAPIExec, dmAPISet)
            const dmApiMatch = trimmed.match(/^dmAPI(Get|Exec|Set)\s*\(\s*["'](.+?)["']\s*\)$/i);

            let result: ApiMethodResponse;

            if (dmApiMatch) {
                // Use the new dmAPI endpoint for server-level API calls
                result = await this.executeDmApiCommand(dmApiMatch[1].toLowerCase() as 'get' | 'exec' | 'set', dmApiMatch[2]);
            } else {
                // Use the object API endpoint for method invocations
                const request = this.parseApiCommand(command);
                result = await this.apiExecutor.execute(request);
            }

            const output = this.formatApiOutput(result, outputFormat);

            execution.replaceOutput([output]);
            execution.end(true, Date.now());
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            execution.replaceOutput([
                new vscode.NotebookCellOutput([
                    vscode.NotebookCellOutputItem.error(
                        new Error(`API Error: ${errorMessage}`)
                    )
                ])
            ]);
            execution.end(false, Date.now());
        }
    }

    /**
     * Execute a dmAPI command via the bridge's /dmapi endpoint
     *
     * @param apiType The type of dmAPI call: 'get', 'exec', or 'set'
     * @param commandString The full command string from inside the quotes
     */
    private async executeDmApiCommand(
        apiType: 'get' | 'exec' | 'set',
        commandString: string
    ): Promise<ApiMethodResponse> {
        const connection = this.connectionManager.getActiveConnection();
        if (!connection || !connection.sessionId) {
            throw new Error('No active connection');
        }

        const bridge = this.connectionManager.getDfcBridge();
        const result = await bridge.executeDmApi(connection.sessionId, apiType, commandString);

        return {
            result: result.result,
            resultType: result.resultType,
            executionTimeMs: result.executionTimeMs
        };
    }

    /**
     * Parse an API command string into a request object
     *
     * Supports simple format: method arg1 arg2
     * (dmAPI format is handled separately in executeApi)
     */
    private parseApiCommand(command: string): ApiMethodRequest {
        const trimmed = command.trim();

        // Match simple format: method arg1 arg2
        const parts = trimmed.split(/\s+/);
        if (parts.length > 0) {
            // Args are strings from the command line format
            const args: unknown[] = parts.slice(1);
            return {
                method: parts[0],
                args
            };
        }

        throw new Error(`Invalid API command format: ${command}`);
    }

    /**
     * Format API response as notebook output
     */
    private formatApiOutput(
        result: ApiMethodResponse,
        outputFormat: string
    ): vscode.NotebookCellOutput {
        const formattedResult = this.formatValue(result.result);
        const text = `${result.resultType}: ${formattedResult}`;

        // Emit output based on format preference
        // First item in the array is the default rendered view
        if (outputFormat === 'json') {
            return new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.json(result, 'application/json'),
                vscode.NotebookCellOutputItem.text(text, 'text/plain')
            ]);
        } else {
            // Default to HTML
            const html = `
                <div style="font-family: var(--vscode-font-family); font-size: 12px;">
                    <div style="margin-bottom: 8px; color: var(--vscode-descriptionForeground);">
                        Result type: ${result.resultType} | Execution time: ${result.executionTimeMs}ms
                    </div>
                    <div style="background: var(--vscode-textCodeBlock-background); padding: 8px; border-radius: 4px; font-family: var(--vscode-editor-font-family);">
                        <pre style="margin: 0; white-space: pre-wrap;">${this.escapeHtml(formattedResult)}</pre>
                    </div>
                </div>
            `;
            return new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.text(html, 'text/html'),
                vscode.NotebookCellOutputItem.text(text, 'text/plain')
            ]);
        }
    }

    /**
     * Format a value for display
     */
    private formatValue(value: unknown): string {
        if (value === null || value === undefined) {
            return 'null';
        }
        if (typeof value === 'object') {
            return JSON.stringify(value, null, 2);
        }
        return String(value);
    }

    /**
     * Escape HTML special characters
     */
    private escapeHtml(text: string): string {
        return text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Dispose of the controller
     */
    dispose(): void {
        this.controller.dispose();
    }
}
