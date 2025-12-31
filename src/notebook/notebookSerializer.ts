import * as vscode from 'vscode';

/**
 * Cell data structure for .dctmbook file format
 */
interface RawNotebookCell {
    kind: 'code' | 'markdown';
    language: string;
    content: string;
    metadata?: Record<string, unknown>;
}

/**
 * .dctmbook file format structure
 */
interface RawNotebookData {
    version: number;
    cells: RawNotebookCell[];
    metadata?: {
        connection?: string;
        repository?: string;
    };
}

/**
 * Serializer for .dctmbook notebook files
 *
 * File format is JSON with the following structure:
 * {
 *   "version": 1,
 *   "cells": [
 *     { "kind": "markdown", "language": "markdown", "content": "# Title" },
 *     { "kind": "code", "language": "dql", "content": "SELECT * FROM dm_document" }
 *   ],
 *   "metadata": {
 *     "connection": "dev-docbase",
 *     "repository": "docbase1"
 *   }
 * }
 */
export class DctmNotebookSerializer implements vscode.NotebookSerializer {

    /**
     * Deserialize notebook file content into NotebookData
     */
    async deserializeNotebook(
        content: Uint8Array,
        _token: vscode.CancellationToken
    ): Promise<vscode.NotebookData> {
        const text = new TextDecoder().decode(content);

        // Handle empty files
        if (!text.trim()) {
            return new vscode.NotebookData([
                new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    '-- Enter your DQL query here\nSELECT r_object_id, object_name FROM dm_document WHERE FOLDER(\'/Temp\')',
                    'dql'
                )
            ]);
        }

        try {
            const raw: RawNotebookData = JSON.parse(text);
            const cells = raw.cells.map(cell => {
                const kind = cell.kind === 'markdown'
                    ? vscode.NotebookCellKind.Markup
                    : vscode.NotebookCellKind.Code;

                const cellData = new vscode.NotebookCellData(
                    kind,
                    cell.content,
                    cell.language
                );

                if (cell.metadata) {
                    cellData.metadata = cell.metadata;
                }

                return cellData;
            });

            const notebookData = new vscode.NotebookData(cells);

            // Store notebook-level metadata
            if (raw.metadata) {
                notebookData.metadata = raw.metadata;
            }

            return notebookData;
        } catch (error) {
            // If parsing fails, create a notebook with the raw content as a code cell
            console.error('Failed to parse .dctmbook file:', error);
            return new vscode.NotebookData([
                new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    text,
                    'dql'
                )
            ]);
        }
    }

    /**
     * Serialize NotebookData to file content
     */
    async serializeNotebook(
        data: vscode.NotebookData,
        _token: vscode.CancellationToken
    ): Promise<Uint8Array> {
        const raw: RawNotebookData = {
            version: 1,
            cells: data.cells.map(cell => ({
                kind: cell.kind === vscode.NotebookCellKind.Markup ? 'markdown' : 'code',
                language: cell.languageId,
                content: cell.value,
                metadata: cell.metadata as Record<string, unknown> | undefined
            })),
            metadata: data.metadata as RawNotebookData['metadata']
        };

        const text = JSON.stringify(raw, null, 2);
        return new TextEncoder().encode(text);
    }
}

/**
 * Supported languages in .dctmbook cells
 */
export const NOTEBOOK_LANGUAGES = ['dql', 'dmapi', 'markdown'];

/**
 * Get display name for a language
 */
export function getLanguageDisplayName(language: string): string {
    switch (language) {
        case 'dql':
            return 'DQL Query';
        case 'dmapi':
            return 'API Command';
        case 'markdown':
            return 'Markdown';
        default:
            return language;
    }
}
