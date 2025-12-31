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

            // Execute based on language
            const language = cell.document.languageId;

            if (language === 'dql') {
                await this.executeDql(content, execution);
            } else if (language === 'dmapi') {
                await this.executeApi(content, execution);
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
     * Execute a DQL query and render results
     */
    private async executeDql(
        query: string,
        execution: vscode.NotebookCellExecution
    ): Promise<void> {
        try {
            const result = await this.dqlExecutor.execute(query);
            const output = this.formatDqlOutput(result);

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
    private formatDqlOutput(result: DqlResult): vscode.NotebookCellOutput {
        // Generate HTML table for display
        const html = this.generateHtmlTable(result);

        // Plain text summary
        const text = `${result.rowCount} row(s) returned in ${result.executionTime}ms`;

        return new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(html, 'text/html'),
            vscode.NotebookCellOutputItem.json({
                columns: result.columns,
                rows: result.rows,
                rowCount: result.rowCount,
                executionTime: result.executionTime
            }),
            vscode.NotebookCellOutputItem.text(text, 'text/plain')
        ]);
    }

    /**
     * Generate an HTML table for DQL results
     */
    private generateHtmlTable(result: DqlResult): string {
        if (result.rows.length === 0) {
            return `<div style="color: var(--vscode-descriptionForeground); padding: 8px;">
                Query executed successfully. No rows returned.
                <br><small>Execution time: ${result.executionTime}ms</small>
            </div>`;
        }

        const headerCells = result.columns
            .map(col => `<th style="text-align: left; padding: 6px 12px; border-bottom: 2px solid var(--vscode-panel-border); font-weight: 600;">${this.escapeHtml(col)}</th>`)
            .join('');

        const bodyRows = result.rows.map(row => {
            const cells = result.columns.map(col => {
                const value = row[col];
                const displayValue = value === null || value === undefined
                    ? '<span style="color: var(--vscode-descriptionForeground); font-style: italic;">NULL</span>'
                    : this.escapeHtml(String(value));
                return `<td style="padding: 4px 12px; border-bottom: 1px solid var(--vscode-panel-border); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${displayValue}</td>`;
            }).join('');
            return `<tr>${cells}</tr>`;
        }).join('');

        return `
            <div style="font-family: var(--vscode-font-family); font-size: 12px;">
                <div style="margin-bottom: 8px; color: var(--vscode-descriptionForeground);">
                    ${result.rowCount} row(s) in ${result.executionTime}ms
                </div>
                <div style="overflow-x: auto; max-height: 400px; overflow-y: auto;">
                    <table style="width: 100%; border-collapse: collapse;">
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
     * Execute an API command
     */
    private async executeApi(
        command: string,
        execution: vscode.NotebookCellExecution
    ): Promise<void> {
        try {
            const request = this.parseApiCommand(command);
            const result = await this.apiExecutor.execute(request);
            const output = this.formatApiOutput(result, command);

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
     * Parse an API command string into a request object
     *
     * Supports formats:
     * - dmAPIGet("method,session,arg1,arg2")
     * - dmAPIExec("method,session,arg1,arg2")
     * - dmAPISet("method,session,arg1,arg2,value")
     * - method arg1 arg2 (simple format)
     */
    private parseApiCommand(command: string): ApiMethodRequest {
        const trimmed = command.trim();

        // Match dmAPI format: dmAPIGet("method,session,args...")
        const dmApiMatch = trimmed.match(/^dmAPI(Get|Exec|Set)\s*\(\s*["'](.+?)["']\s*\)$/i);
        if (dmApiMatch) {
            const parts = dmApiMatch[2].split(',').map(s => s.trim());
            const method = parts[0];
            // Skip session (parts[1]) as we use the active connection
            // Args are strings from the dmAPI command string
            const args: unknown[] = parts.slice(2);

            return {
                method,
                args
            };
        }

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
        _command: string
    ): vscode.NotebookCellOutput {
        const formattedResult = this.formatValue(result.result);

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

        const text = `${result.resultType}: ${formattedResult}`;

        return new vscode.NotebookCellOutput([
            vscode.NotebookCellOutputItem.text(html, 'text/html'),
            vscode.NotebookCellOutputItem.json(result),
            vscode.NotebookCellOutputItem.text(text, 'text/plain')
        ]);
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
