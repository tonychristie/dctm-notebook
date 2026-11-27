import * as vscode from 'vscode';
import { ConnectionManager } from '../connectionManager';
import { RepositoryConnection } from '../repositoryConnection';
import { DqlExecutor, DqlResult, dqlStatement } from '../dqlExecutor';
import { ApiExecutor, ApiMethodResponse } from '../apiExecutor';
import { NotebookConnectionResult, resolveNotebookConnection } from './notebookConnection';
import {
    OutputFormat,
    formatValue,
    getOutputFormat,
    parseApiCommand,
    parseDmApiCommand,
    stripComments
} from './commandParsing';

// A constructed Error carries a stack, and a name of 'Error' adds an 'Error: ' prefix in the renderer.
export function errorOutput(message: string): vscode.NotebookCellOutput {
    return new vscode.NotebookCellOutput([vscode.NotebookCellOutputItem.error({ name: '', message })]);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

// The connection is resolved once for the run, so a cancelled picker is not shown again for each cell.
export async function executeCells<Cell>(
    cells: readonly Cell[],
    resolve: () => Promise<NotebookConnectionResult>,
    execute: (cell: Cell, connection: RepositoryConnection) => Promise<void>,
    fail: (cell: Cell, message: string) => void
): Promise<void> {
    let result: NotebookConnectionResult;
    try {
        result = await resolve();
    } catch (error) {
        result = { error: errorMessage(error) };
    }

    for (const cell of cells) {
        if (result.connection) {
            await execute(cell, result.connection);
        } else {
            fail(cell, result.error);
        }
    }
}

export type CellExecution = Pick<vscode.NotebookCellExecution, 'replaceOutput' | 'end'>;
export type CellDocument = Pick<vscode.TextDocument, 'getText' | 'languageId'>;

export class NotebookCellRunner {
    constructor(
        private readonly dqlExecutor: Pick<DqlExecutor, 'execute'>,
        private readonly apiExecutor: Pick<ApiExecutor, 'execute'>
    ) {}

    /**
     * Execute a single notebook cell
     */
    async run(
        execution: CellExecution,
        document: CellDocument,
        metadata: { [key: string]: unknown },
        connection: RepositoryConnection
    ): Promise<void> {
        try {
            const content = document.getText().trim();
            if (!content) {
                execution.replaceOutput([]);
                execution.end(true, Date.now());
                return;
            }

            const outputFormat = getOutputFormat(metadata);

            // Execute based on language
            const language = document.languageId;

            if (language === 'dql') {
                await this.executeDql(content, execution, outputFormat, connection);
            } else if (language === 'dmapi') {
                await this.executeApi(content, execution, outputFormat, connection);
            } else {
                execution.replaceOutput([errorOutput(`Unsupported language: ${language}`)]);
                execution.end(false, Date.now());
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            execution.replaceOutput([errorOutput(errorMessage)]);
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
        execution: CellExecution,
        outputFormat: OutputFormat,
        connection: RepositoryConnection
    ): Promise<void> {
        try {
            if (!dqlStatement(query)) {
                execution.replaceOutput([]);
                execution.end(true, Date.now());
                return;
            }
            const result = await this.dqlExecutor.execute(query, connection);
            const output = this.formatDqlOutput(result, outputFormat);

            execution.replaceOutput([output]);
            execution.end(true, Date.now());
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            execution.replaceOutput([errorOutput(errorMessage)]);
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
        execution: CellExecution,
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
                    dmApiCommand.value,
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
            execution.replaceOutput([errorOutput(errorMessage)]);
            execution.end(false, Date.now());
        }
    }

    /**
     * Execute a dmAPI command via the bridge's /dmapi endpoint
     *
     * @param apiType The type of dmAPI call: 'get', 'exec', or 'set'
     * @param commandString The full command string from inside the quotes
     * @param value The second argument of dmAPISet, sent unchanged
     * @param connection The active connection to use for execution
     */
    private async executeDmApiCommand(
        apiType: 'get' | 'exec' | 'set',
        commandString: string,
        value: string | undefined,
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

        const result = await bridge.executeDmApi(connection.sessionId, apiType, commandString, value);

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
}

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
    private readonly runner: NotebookCellRunner;
    private executionOrder = 0;

    private connectionManager: ConnectionManager;

    constructor(
        connectionManager: ConnectionManager,
        dqlExecutor: DqlExecutor,
        apiExecutor: ApiExecutor
    ) {
        this.connectionManager = connectionManager;
        this.runner = new NotebookCellRunner(dqlExecutor, apiExecutor);

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
        notebook: vscode.NotebookDocument,
        _controller: vscode.NotebookController
    ): Promise<void> {
        await executeCells(
            cells,
            () => resolveNotebookConnection(this.connectionManager, notebook),
            (cell, connection) => this.runner.run(this.startExecution(cell), cell.document, cell.metadata, connection),
            (cell, message) => this.failCell(cell, message)
        );
    }

    private startExecution(cell: vscode.NotebookCell): vscode.NotebookCellExecution {
        const execution = this.controller.createNotebookCellExecution(cell);
        execution.executionOrder = ++this.executionOrder;
        execution.start(Date.now());
        return execution;
    }

    private failCell(cell: vscode.NotebookCell, message: string): void {
        const execution = this.startExecution(cell);
        execution.replaceOutput([errorOutput(message)]);
        execution.end(false, Date.now());
    }

    /**
     * Dispose of the controller
     */
    dispose(): void {
        this.controller.dispose();
    }
}
