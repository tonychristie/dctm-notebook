import { ConnectionManager } from '../connectionManager';
import { RepositoryConnection } from '../repositoryConnection';

export type NotebookConnectionResult =
    | { connection: RepositoryConnection; error?: undefined }
    | { connection?: undefined; error: string };

export function boundConnectionName(metadata: { [key: string]: unknown } | undefined): string | undefined {
    const name = metadata?.connection;
    return typeof name === 'string' && name ? name : undefined;
}

export async function resolveNotebookConnection(
    connectionManager: ConnectionManager,
    metadata: { [key: string]: unknown } | undefined
): Promise<NotebookConnectionResult> {
    const boundName = boundConnectionName(metadata);

    if (!boundName) {
        const selected = connectionManager.getSelectedConnection();
        return selected
            ? { connection: selected }
            : { error: 'Not connected to Documentum. Use "Documentum: Connect" first.' };
    }

    if (!connectionManager.getConnections().some(c => c.name === boundName)) {
        return { error: `Connection "${boundName}" not found. Update the notebook binding.` };
    }

    const connection = await connectionManager.openConnection(boundName);
    return connection
        ? { connection }
        : { error: `Notebook is bound to "${boundName}" but not connected.` };
}
