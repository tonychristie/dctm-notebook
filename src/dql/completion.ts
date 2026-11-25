import { isTypeContext } from './typeNames';
import { DQL_SERVER_FUNCTIONS, dqlWordsOfKind, isDqlWord } from './vocabulary';

export type DqlCompletionKind = 'keyword' | 'function' | 'type' | 'attribute';

export interface DqlCompletionItem {
    label: string;
    insertText: string;
    kind: DqlCompletionKind;
}

export interface DqlCompletionResult {
    from: number;
    to: number;
    items: DqlCompletionItem[];
}

export interface DqlSchema {
    typeNames(): string[];
    attributes(typeName: string): Promise<string[]>;
}

interface Token {
    kind: 'word' | 'string' | 'comment' | 'semicolon' | 'punctuation';
    from: number;
    to: number;
    closed: boolean;
}

function scan(text: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    const push = (kind: Token['kind'], from: number, to: number, closed = true) =>
        tokens.push({ kind, from, to, closed });

    while (i < text.length) {
        const ch = text[i];
        const start = i;
        if (/\s/.test(ch)) {
            i++;
        } else if (/\w/.test(ch)) {
            while (i < text.length && /\w/.test(text[i])) {
                i++;
            }
            push('word', start, i);
        } else if (ch === '\'' || ch === '"') {
            i++;
            let closed = false;
            while (i < text.length) {
                if (ch === '"' && text[i] === '\\' && text[i + 1] === '"') {
                    i += 2;
                } else if (text[i] === ch && ch === '\'' && text[i + 1] === '\'') {
                    i += 2;
                } else if (text[i] === ch) {
                    i++;
                    closed = true;
                    break;
                } else {
                    i++;
                }
            }
            push('string', start, i, closed);
        } else if (ch === '-' && text[i + 1] === '-') {
            const end = text.indexOf('\n', i);
            i = end < 0 ? text.length : end;
            // A line comment runs to the end of its line, so a cursor there is still in it.
            push('comment', start, i, false);
        } else if (ch === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            i = end < 0 ? text.length : end + 2;
            push('comment', start, i, end >= 0);
        } else {
            i++;
            push(ch === ';' ? 'semicolon' : 'punctuation', start, i);
        }
    }
    return tokens;
}

function isInsideToken(token: Token, offset: number): boolean {
    return token.from < offset && (offset < token.to || (offset === token.to && !token.closed));
}

// The statement at the cursor runs to a blank line or a ; on each side.
function statementRange(text: string, tokens: Token[], offset: number): { from: number; to: number } {
    let from = 0;
    let to = text.length;
    for (const token of tokens) {
        if (token.kind === 'semicolon') {
            if (token.to <= offset) {
                from = token.to;
            } else if (token.from >= offset) {
                to = Math.min(to, token.from);
            }
        }
    }

    const blankLine = /\n[ \t\r]*(?=\n)/g;
    let match;
    while ((match = blankLine.exec(text)) !== null) {
        const lineEnd = match.index + match[0].length;
        if (lineEnd < offset) {
            from = Math.max(from, lineEnd);
        } else if (match.index >= offset) {
            to = Math.min(to, match.index);
        }
    }
    return { from, to };
}

// Maps each type and alias of the FROM lists and joins, lower case, to the type name as written.
function fromTypes(text: string, tokens: Token[]): Map<string, string> {
    const types = new Map<string, string>();
    const textOf = (token: Token | undefined) => token ? text.substring(token.from, token.to) : '';
    const isName = (token: Token | undefined) =>
        token?.kind === 'word' && /^[A-Za-z_]/.test(textOf(token)) && !isDqlWord(textOf(token));

    for (let i = 0; i < tokens.length; i++) {
        const opener = textOf(tokens[i]).toLowerCase();
        if (tokens[i].kind !== 'word' || (opener !== 'from' && opener !== 'join')) {
            continue;
        }
        let j = i + 1;
        for (;;) {
            if (textOf(tokens[j]) === '(' && textOf(tokens[j + 1]).toLowerCase() === 'all' &&
                textOf(tokens[j + 2]) === ')') {
                j += 3;
            }
            if (!isName(tokens[j])) {
                break;
            }
            const typeName = textOf(tokens[j]);
            types.set(typeName.toLowerCase(), typeName);
            j++;
            if (textOf(tokens[j]).toLowerCase() === 'as') {
                j++;
            }
            if (isName(tokens[j])) {
                types.set(textOf(tokens[j]).toLowerCase(), typeName);
                j++;
            }
            if (opener !== 'from' || textOf(tokens[j]) !== ',') {
                break;
            }
            j++;
        }
    }
    return types;
}

function startsWith(word: string, prefix: string): boolean {
    return word.toLowerCase().startsWith(prefix.toLowerCase());
}

async function attributesOf(typeNames: Iterable<string>, schema: DqlSchema | undefined): Promise<string[]> {
    if (!schema) {
        return [];
    }
    const lists = await Promise.all([...new Set(typeNames)].map(typeName => schema.attributes(typeName)));
    return [...new Set(lists.flat())];
}

const KEYWORDS = [...dqlWordsOfKind('keyword'), ...dqlWordsOfKind('constant')].map(word => word.toUpperCase());
const FUNCTIONS = [...DQL_SERVER_FUNCTIONS].map(word => word.toUpperCase());

export async function completeDql(
    text: string,
    offset: number,
    schema: DqlSchema | undefined
): Promise<DqlCompletionResult | undefined> {
    const tokens = scan(text);
    if (tokens.some(token => (token.kind === 'string' || token.kind === 'comment') && isInsideToken(token, offset))) {
        return undefined;
    }

    const prefix = /\w*$/.exec(text.substring(0, offset))![0];
    const from = offset - prefix.length;
    const statement = statementRange(text, tokens, offset);
    const statementTokens = tokens.filter(token => token.from >= statement.from && token.to <= statement.to);
    const types = fromTypes(text, statementTokens);
    const result = (items: DqlCompletionItem[]) => ({ from, to: offset, items });

    if (text[from - 1] === '.') {
        const name = /\w*$/.exec(text.substring(0, from - 1))![0].toLowerCase();
        const typeName = types.get(name);
        const attributes = typeName ? await attributesOf([typeName], schema) : [];
        return result(attributes.filter(attribute => startsWith(attribute, prefix))
            .map(attribute => ({ label: attribute, insertText: attribute, kind: 'attribute' })));
    }

    if (isTypeContext(text.substring(statement.from, from))) {
        return result((schema?.typeNames() ?? []).filter(typeName => startsWith(typeName, prefix))
            .map(typeName => ({ label: typeName, insertText: typeName, kind: 'type' })));
    }

    const attributes = await attributesOf(types.values(), schema);
    return result([
        ...attributes.filter(attribute => startsWith(attribute, prefix))
            .map((attribute): DqlCompletionItem => ({ label: attribute, insertText: attribute, kind: 'attribute' })),
        ...KEYWORDS.filter(keyword => startsWith(keyword, prefix))
            .map((keyword): DqlCompletionItem => ({ label: keyword, insertText: keyword, kind: 'keyword' })),
        ...FUNCTIONS.filter(name => startsWith(name, prefix))
            .map((name): DqlCompletionItem => ({ label: name, insertText: `${name}(`, kind: 'function' }))
    ]);
}
