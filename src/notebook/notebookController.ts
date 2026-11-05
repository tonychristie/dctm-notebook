import * as vscode from 'vscode';
import { ConnectionManager } from '../connectionManager';
import { RepositoryConnection } from '../repositoryConnection';
import { DqlExecutor, DqlResult } from '../dqlExecutor';
import { ApiExecutor, ApiMethodResponse } from '../apiExecutor';
import { resolveNotebookConnection } from './notebookConnection';
import {
    OutputFormat,
    formatValue,
    getOutputFormat,
    parseApiCommand,
    parseDmApiCommand,
    stripComments
} from './commandParsing';

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
            const { connection, error } = await resolveNotebookConnection(
                this.connectionManager,
                cell.notebook.metadata
            );
            if (!connection) {
                execution.replaceOutput([
                    new vscode.NotebookCellOutput([
                        vscode.NotebookCellOutputItem.error(new Error(error))
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

            const outputFormat = getOutputFormat(cell.metadata);

            // Execute based on language
            const language = cell.document.languageId;

            if (language === 'dql') {
                await this.executeDql(content, execution, outputFormat, connection);
            } else if (language === 'dmapi') {
                await this.executeApi(content, execution, outputFormat, connection);
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
     *
     * @param query The DQL query to execute
     * @param execution The notebook cell execution context
     * @param outputFormat The output format preference ('html' or 'json')
     * @param connection The active connection to use for execution
     */
    private async executeDql(
        query: string,
        execution: vscode.NotebookCellExecution,
        outputFormat: OutputFormat,
        connection: RepositoryConnection
    ): Promise<void> {
        try {
            // Strip comments before execution (DQL supports block comments)
            const cleanQuery = stripComments(query, true);
            if (!cleanQuery) {
                execution.replaceOutput([]);
                execution.end(true, Date.now());
                return;
            }
            const result = await this.dqlExecutor.execute(cleanQuery, connection);
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
    private formatDqlOutput(result: DqlResult, outputFormat: OutputFormat): vscode.NotebookCellOutput {
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
            // Use custom renderer for interactive table with object ID click support
            return new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.json(resultData, 'application/x-dctm-result'),
                vscode.NotebookCellOutputItem.text(text, 'text/plain')
            ]);
        }
    }

    /**
     * Execute an API command
     *
     * @param command The API command to execute
     * @param execution The notebook cell execution context
     * @param outputFormat The output format preference ('html' or 'json')
     * @param connection The active connection to use for execution
     */
    private async executeApi(
        command: string,
        execution: vscode.NotebookCellExecution,
        outputFormat: OutputFormat,
        connection: RepositoryConnection
    ): Promise<void> {
        try {
            // dmAPI supports line comments only
            const cleanCommand = stripComments(command);
            if (!cleanCommand) {
                execution.replaceOutput([]);
                execution.end(true, Date.now());
                return;
            }

            const dmApiCommand = parseDmApiCommand(cleanCommand);

            let result: ApiMethodResponse;

            if (dmApiCommand) {
                result = await this.executeDmApiCommand(
                    dmApiCommand.callType,
                    dmApiCommand.args,
                    connection
                );
            } else {
                result = await this.apiExecutor.execute(parseApiCommand(cleanCommand), connection);
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
     * @param connection The active connection to use for execution
     */
    private async executeDmApiCommand(
        apiType: 'get' | 'exec' | 'set',
        commandString: string,
        connection: RepositoryConnection
    ): Promise<ApiMethodResponse> {
        const bridge = connection.bridge;

        // Check if this is a REST connection - REST doesn't support dmAPI
        if (bridge.isRestSession(connection.sessionId)) {
            throw new Error(
                'dmAPI commands are not available with REST connections. ' +
                'dmAPI requires a DFC connection to the repository.'
            );
        }

        const result = await bridge.executeDmApi(connection.sessionId, apiType, commandString);

        return {
            result: result.result,
            resultType: result.resultType,
            executionTimeMs: result.executionTimeMs
        };
    }

    /**
     * Format API response as notebook output
     */
    private formatApiOutput(
        result: ApiMethodResponse,
        outputFormat: OutputFormat
    ): vscode.NotebookCellOutput {
        const formattedResult = formatValue(result.result);
        const text = `${result.resultType}: ${formattedResult}`;

        // Emit output based on format preference
        // First item in the array is the default rendered view
        if (outputFormat === 'json') {
            return new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.json(result, 'application/json'),
                vscode.NotebookCellOutputItem.text(text, 'text/plain')
            ]);
        } else {
            // Default to custom renderer with clickable object IDs
            // Use the same MIME type as DQL results so the custom renderer handles it
            const apiResultData = {
                type: 'api',
                result: formattedResult,
                resultType: result.resultType,
                executionTimeMs: result.executionTimeMs
            };
            return new vscode.NotebookCellOutput([
                vscode.NotebookCellOutputItem.json(apiResultData, 'application/x-dctm-result'),
                vscode.NotebookCellOutputItem.text(text, 'text/plain')
            ]);
        }
    }

    /**
     * Dispose of the controller
     */
    dispose(): void {
        this.controller.dispose();
    }
}
