import * as vscode from 'vscode';
import { buildGroupQuery, buildTypeQuery, buildUserQuery } from '../dqlQueries';
import type { DocumentConnections } from '../documentConnections';
import { RepositoryConnection } from '../repositoryConnection';

export type EntityKind = 'type' | 'user' | 'group';

export function isEntityKind(value: unknown): value is EntityKind {
    return value === 'type' || value === 'user' || value === 'group';
}

async function entityQuery(connection: RepositoryConnection, kind: EntityKind, name: string): Promise<string | undefined> {
    switch (kind) {
        case 'type': {
            const type = await connection.typeCache.fetchTypeDetails(name);
            return type ? buildTypeQuery(type) : undefined;
        }
        case 'user':
            return buildUserQuery(name);
        case 'group':
            return buildGroupQuery(name);
    }
}

export type QueryDocuments = Pick<DocumentConnections, 'link'>;

export async function openEntityQuery(
    connection: RepositoryConnection | undefined,
    connectionName: string,
    kind: EntityKind,
    name: string,
    documents: QueryDocuments
): Promise<void> {
    if (!connection) {
        vscode.window.showErrorMessage(`Not connected to ${connectionName}`);
        return;
    }
    let content;
    try {
        content = await entityQuery(connection, kind, name);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`Failed to generate DQL for ${name}: ${message}`);
        return;
    }
    if (content === undefined) {
        return;
    }
    const doc = await vscode.workspace.openTextDocument({ content, language: 'dql' });
    // Linked before it shows, so the status bar and the type colours are right at once.
    await documents.link(doc, connectionName);
    await vscode.window.showTextDocument(doc);
}
