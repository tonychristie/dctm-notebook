import { autocompletion, Completion, CompletionContext, CompletionResult, completionKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { SQLDialect } from '@codemirror/lang-sql';
import { HighlightStyle, syntaxHighlighting, syntaxTree } from '@codemirror/language';
import { EditorState, Prec, RangeSetBuilder, StateEffect } from '@codemirror/state';
import {
    Decoration,
    DecorationSet,
    drawSelection,
    EditorView,
    keymap,
    lineNumbers,
    placeholder,
    ViewPlugin,
    ViewUpdate
} from '@codemirror/view';
import { tags } from '@lezer/highlight';
import { escapeHtml } from '../../htmlUtils';
import type { DqlCompletionKind, DqlCompletionResult } from '../../dql/completion';
import { findTypeNames } from '../../dql/typeNames';
import { dqlCategoryOf, dqlWordsOfKind } from '../../dql/vocabulary';
import { renderResultsGrid, ResultsGridData } from '../../results/resultsGrid';
import { onActions } from '../common';

export interface DqlHistoryEntry {
    query: string;
    timestamp: string;
    rowCount?: number;
    error: boolean;
}

export type DqlOutcome = { result: ResultsGridData } | { error: string };

export interface DqlState {
    running: boolean;
    outcome?: DqlOutcome;
    history: DqlHistoryEntry[];
}

export interface DqlCompletionAnswer {
    requestId: number;
    result?: DqlCompletionResult;
}

const dialect = SQLDialect.define({
    keywords: [...dqlWordsOfKind('keyword'), ...dqlWordsOfKind('constant')].join(' '),
    types: '',
    doubleQuotedStrings: true
});

// A webview cannot read the theme's token colours, so the highlighting uses theme colour variables.
// symbolIcon-keywordForeground defaults to the plain foreground, so keywords use the debug boolean colour.
const highlightStyle = HighlightStyle.define([
    { tag: tags.keyword, color: 'var(--vscode-debugTokenExpression-boolean)' },
    { tag: tags.string, color: 'var(--vscode-debugTokenExpression-string)' },
    { tag: tags.number, color: 'var(--vscode-debugTokenExpression-number)' },
    { tag: [tags.lineComment, tags.blockComment], color: 'var(--vscode-descriptionForeground)' }
]);

const COMPLETION_TYPES: Record<DqlCompletionKind, string> = {
    keyword: 'keyword',
    function: 'function',
    type: 'class',
    attribute: 'property'
};

const typeNamesChanged = StateEffect.define<null>();
const functionMark = Decoration.mark({ class: 'cm-dql-function' });
const typeMark = Decoration.mark({ class: 'cm-dql-type' });

const PLACEHOLDER = 'Enter a DQL query. Ctrl+Enter runs it.';

export class DqlTabView {
    private readonly editor: EditorView;
    private readonly runButton: HTMLButtonElement;
    private readonly results: HTMLElement;
    private readonly historySection: HTMLElement;
    private readonly historyList: HTMLElement;
    private history: DqlHistoryEntry[] = [];
    private typeNames = new Set<string>();
    private running = false;
    private requestId = 0;
    private pendingCompletion: { id: number; resolve: (result: DqlCompletionResult | undefined) => void } | undefined;

    constructor(
        root: HTMLElement,
        private readonly post: (message: object) => void,
        initialQuery: string,
        onQueryChange: () => void
    ) {
        const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
        this.runButton = find<HTMLButtonElement>('[data-action="runQuery"]');
        this.results = find('.dql-results');
        this.historySection = find('.dql-history');
        this.historyList = find('.dql-history-list');

        this.editor = new EditorView({
            parent: find('.dql-editor'),
            state: EditorState.create({
                doc: initialQuery,
                extensions: [
                    Prec.highest(keymap.of([{ key: 'Mod-Enter', run: () => this.run() }])),
                    lineNumbers(),
                    history(),
                    drawSelection(),
                    dialect.language,
                    syntaxHighlighting(highlightStyle),
                    this.decorations(),
                    autocompletion({ override: [context => this.complete(context)] }),
                    placeholder(PLACEHOLDER),
                    keymap.of([...completionKeymap, ...defaultKeymap, ...historyKeymap]),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) {
                            onQueryChange();
                        }
                    })
                ]
            })
        });

        onActions({
            runQuery: () => this.run(),
            loadHistory: el => {
                const entry = this.history[Number(el.dataset.index)];
                if (entry) {
                    this.setQuery(entry.query);
                }
            }
        }, root);
    }

    query(): string {
        return this.editor.state.doc.toString();
    }

    setTypeNames(names: string[]): void {
        this.typeNames = new Set(names.map(name => name.toLowerCase()));
        this.editor.dispatch({ effects: typeNamesChanged.of(null) });
    }

    setState(state: DqlState): void {
        this.setRunning(state.running);
        if (state.running) {
            this.showMessage('Running query...');
        } else if (state.outcome) {
            this.showOutcome(state.outcome);
        }
        this.showHistory(state.history);
    }

    showRunning(): void {
        this.setRunning(true);
        this.showMessage('Running query...');
    }

    showResult(outcome: DqlOutcome, history: DqlHistoryEntry[]): void {
        this.setRunning(false);
        this.showOutcome(outcome);
        this.showHistory(history);
    }

    onCompletion(answer: DqlCompletionAnswer): void {
        if (this.pendingCompletion?.id === answer.requestId) {
            this.pendingCompletion.resolve(answer.result);
            this.pendingCompletion = undefined;
        }
    }

    private run(): boolean {
        if (this.running) {
            return true;
        }
        const { from, to } = this.editor.state.selection.main;
        const query = from === to ? this.query() : this.editor.state.sliceDoc(from, to);
        if (!query.trim()) {
            this.showMessage('No DQL query to execute');
            return true;
        }
        this.setRunning(true);
        this.post({ tab: 'dql', command: 'run', query });
        return true;
    }

    private setQuery(query: string): void {
        this.editor.dispatch({ changes: { from: 0, to: this.editor.state.doc.length, insert: query } });
        this.editor.focus();
    }

    private setRunning(running: boolean): void {
        this.running = running;
        this.runButton.disabled = running;
    }

    private showMessage(text: string): void {
        this.results.innerHTML = `<div class="dql-message">${escapeHtml(text)}</div>`;
    }

    private showOutcome(outcome: DqlOutcome): void {
        if ('error' in outcome) {
            this.results.innerHTML = `<div class="dql-error">${escapeHtml(outcome.error)}</div>`;
            return;
        }
        renderResultsGrid(this.results, outcome.result, {
            dumpObject: objectId => this.post({ tab: 'dql', command: 'dumpObject', objectId }),
            exportData: (format, columns, rows) => this.post({ tab: 'dql', command: 'export', format, columns, rows })
        });
    }

    private showHistory(history: DqlHistoryEntry[]): void {
        this.history = history;
        this.historySection.hidden = history.length === 0;
        this.historyList.innerHTML = history.map((entry, index) =>
            `<div class="dql-history-item" data-action="loadHistory" data-index="${index}" title="${escapeHtml(entry.query)}">
                <span class="dql-history-query">${escapeHtml(entry.query.split('\n')[0])}</span>
                <span class="dql-history-time">${escapeHtml(entry.timestamp)}</span>
                <span class="${entry.error ? 'dql-history-error' : 'dql-history-rows'}">${
                    entry.error ? 'Error' : `${entry.rowCount} row(s)`}</span>
            </div>`
        ).join('');
    }

    private async complete(context: CompletionContext): Promise<CompletionResult | null> {
        const word = context.matchBefore(/\w*/);
        const wordFrom = word ? word.from : context.pos;
        const afterDot = context.state.sliceDoc(wordFrom - 1, wordFrom) === '.';
        if (!context.explicit && wordFrom === context.pos && !afterDot) {
            return null;
        }

        // An answer can arrive after a newer request, so only the latest request's answer is used.
        this.pendingCompletion?.resolve(undefined);
        const id = ++this.requestId;
        const answer = new Promise<DqlCompletionResult | undefined>(resolve => {
            this.pendingCompletion = { id, resolve };
        });
        this.post({ tab: 'dql', command: 'complete', requestId: id, text: this.query(), offset: context.pos });
        const result = await answer;
        if (!result || result.items.length === 0) {
            return null;
        }
        return {
            from: result.from,
            to: result.to,
            filter: false,
            options: result.items.map((item): Completion => ({
                label: item.label,
                apply: item.insertText,
                type: COMPLETION_TYPES[item.kind]
            }))
        };
    }

    // Functions are coloured only before (, and types only from the connection, so neither is a dialect word.
    private decorations() {
        const build = (editor: EditorView) => this.buildDecorations(editor);
        return ViewPlugin.fromClass(class {
            decorations: DecorationSet;

            constructor(editor: EditorView) {
                this.decorations = build(editor);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged ||
                    update.transactions.some(tr => tr.effects.some(effect => effect.is(typeNamesChanged)))) {
                    this.decorations = build(update.view);
                }
            }
        }, { decorations: plugin => plugin.decorations });
    }

    private buildDecorations(editor: EditorView): DecorationSet {
        const { doc } = editor.state;
        const text = doc.toString();
        const tree = syntaxTree(editor.state);
        const marks: Array<{ from: number; to: number; mark: Decoration }> = [];

        const functionCall = /\b([A-Za-z_]\w*)\s*(?=\()/g;
        let match;
        while ((match = functionCall.exec(text)) !== null) {
            const from = match.index;
            const to = from + match[1].length;
            if (dqlCategoryOf(match[1])?.kind === 'function' && tree.resolveInner(from, 1).name === 'Identifier') {
                marks.push({ from, to, mark: functionMark });
            }
        }

        for (const range of findTypeNames(text, name => this.typeNames.has(name.toLowerCase()))) {
            const from = doc.line(range.line + 1).from + range.start;
            marks.push({ from, to: from + range.length, mark: typeMark });
        }

        const builder = new RangeSetBuilder<Decoration>();
        marks.sort((a, b) => a.from - b.from).forEach(({ from, to, mark }) => builder.add(from, to, mark));
        return builder.finish();
    }
}
