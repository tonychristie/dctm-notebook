import * as vscode from 'vscode';
import type { ConnectionManager } from './connectionManager';
import { bindNotebook, boundConnectionName, pickBinding } from './notebook/notebookConnection';

const LINKS_KEY = 'dctm.documentLinks';

type Links = Record<string, string>;

function notebookOf(document: vscode.TextDocument): vscode.NotebookDocument | undefined {
    const uri = document.uri.toString();
    return vscode.workspace.notebookDocuments.find(notebook =>
        notebook.notebookType === 'dctmbook' &&
        notebook.getCells().some(cell => cell.document.uri.toString() === uri)
    );
}

// A folder rename or delete reports only the folder.
function isAtOrUnder(key: string, uri: string): boolean {
    return key === uri || key.startsWith(`${uri}/`);
}

export class DocumentConnections implements vscode.Disposable {
    private readonly untitledLinks = new Map<string, string>();
    private readonly changeEmitter = new vscode.EventEmitter<void>();
    readonly onDidChange: vscode.Event<void> = this.changeEmitter.event;
    private readonly subscriptions: vscode.Disposable[];

    constructor(private readonly state: vscode.Memento) {
        this.subscriptions = [
            vscode.workspace.onDidRenameFiles(event => void this.moveLinks(event.files)),
            vscode.workspace.onDidDeleteFiles(event => void this.removeLinks(event.files)),
            // A new untitled document can reuse the URI of a closed one.
            vscode.workspace.onDidCloseTextDocument(document => this.untitledLinks.delete(document.uri.toString())),
            vscode.workspace.onDidChangeNotebookDocument(event => {
                if (event.metadata) {
                    this.changeEmitter.fire();
                }
            })
        ];
    }

    notebookConnectionName(notebook: vscode.NotebookDocument): string | undefined {
        return boundConnectionName(notebook.metadata);
    }

    connectionName(document: vscode.TextDocument): string | undefined {
        const notebook = notebookOf(document);
        if (notebook) {
            return this.notebookConnectionName(notebook);
        }
        const key = document.uri.toString();
        return document.uri.scheme === 'untitled' ? this.untitledLinks.get(key) : this.links()[key];
    }

    async link(document: vscode.TextDocument, connectionName: string): Promise<void> {
        const notebook = notebookOf(document);
        if (notebook) {
            await bindNotebook(notebook, connectionName);
            return;
        }

        const key = document.uri.toString();
        if (document.uri.scheme === 'untitled') {
            this.untitledLinks.set(key, connectionName);
        } else {
            await this.state.update(LINKS_KEY, { ...this.links(), [key]: connectionName });
        }
        this.changeEmitter.fire();
    }

    async moveLinks(files: readonly { readonly oldUri: vscode.Uri; readonly newUri: vscode.Uri }[]): Promise<void> {
        let changed = false;
        const links: Links = {};
        for (const [key, name] of Object.entries(this.links())) {
            const file = files.find(f => isAtOrUnder(key, f.oldUri.toString()));
            if (file) {
                links[file.newUri.toString() + key.slice(file.oldUri.toString().length)] = name;
                changed = true;
            } else {
                links[key] = name;
            }
        }
        if (changed) {
            await this.state.update(LINKS_KEY, links);
            this.changeEmitter.fire();
        }
    }

    async removeLinks(uris: readonly vscode.Uri[]): Promise<void> {
        const removed = uris.map(uri => uri.toString());
        const links = this.links();
        const kept = Object.fromEntries(Object.entries(links).filter(([key]) =>
            !removed.some(uri => isAtOrUnder(key, uri))
        ));
        if (Object.keys(kept).length !== Object.keys(links).length) {
            await this.state.update(LINKS_KEY, kept);
            this.changeEmitter.fire();
        }
    }

    private links(): Links {
        return this.state.get<Links>(LINKS_KEY, {});
    }

    dispose(): void {
        this.subscriptions.forEach(subscription => subscription.dispose());
        this.changeEmitter.dispose();
    }
}

export function registerDocumentConnections(
    context: vscode.ExtensionContext,
    connectionManager: ConnectionManager
): DocumentConnections {
    const documents = new DocumentConnections(context.workspaceState);

    context.subscriptions.push(
        documents,
        vscode.commands.registerCommand('dctm.linkConnection', async () => {
            const document = vscode.window.activeTextEditor?.document;
            if (!document || document.languageId !== 'dql') {
                vscode.window.showWarningMessage('No DQL editor is active');
                return;
            }
            const selected = await pickBinding(
                connectionManager.getConnections(),
                documents.connectionName(document),
                'file'
            );
            if (selected) {
                await documents.link(document, selected);
            }
        })
    );

    return documents;
}
