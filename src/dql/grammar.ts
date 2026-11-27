import { DQL_CATEGORIES, DQL_HINTS, DqlCategory } from './vocabulary';

export interface DqlVocabulary {
    categories: readonly DqlCategory[];
    hints: readonly string[];
}

interface GrammarPattern {
    name?: string;
    match?: string;
    begin?: string;
    end?: string;
    include?: string;
    captures?: Record<string, { name: string }>;
    beginCaptures?: Record<string, { name: string }>;
    endCaptures?: Record<string, { name: string }>;
    patterns?: GrammarPattern[];
}

export interface DqlGrammar {
    $schema: string;
    name: string;
    scopeName: string;
    patterns: GrammarPattern[];
    repository: Record<string, { patterns: GrammarPattern[] }>;
}

function wordList(words: readonly string[]): string {
    return words.map(word => word.toUpperCase()).join('|');
}

function categoryPattern(category: DqlCategory): GrammarPattern {
    // A function name is coloured only before (, so an attribute of the same name stays plain.
    const end = category.kind === 'function' ? '\\s*(?=\\()' : '\\b';
    return { name: category.scope, match: `(?i)\\b(${wordList(category.words)})${end}` };
}

export function buildGrammar(vocabulary: DqlVocabulary): DqlGrammar {
    const ofKind = (kind: DqlCategory['kind']) =>
        vocabulary.categories.filter(category => category.kind === kind && category.words.length > 0).map(categoryPattern);

    return {
        $schema: 'https://raw.githubusercontent.com/martinring/tmlanguage/master/tmlanguage.json',
        name: 'DQL',
        scopeName: 'source.dql',
        patterns: [
            'hints', 'comments', 'strings', 'object-ids', 'numbers', 'keywords', 'operators', 'functions',
            'constants', 'repeating-attributes', 'folder-paths'
        ].map(name => ({ include: `#${name}` })),
        repository: {
            hints: {
                patterns: [{
                    name: 'comment.block.hint.dql',
                    begin: '/\\*\\+',
                    end: '\\*/',
                    beginCaptures: { 0: { name: 'punctuation.definition.comment.hint.begin.dql' } },
                    endCaptures: { 0: { name: 'punctuation.definition.comment.hint.end.dql' } },
                    patterns: [{ name: 'keyword.other.hint.dql', match: `(?i)\\b(${wordList(vocabulary.hints)})\\b` }]
                }]
            },
            comments: {
                patterns: [
                    { name: 'comment.line.double-dash.dql', match: '--.*$' },
                    { name: 'comment.block.dql', begin: '/\\*(?!\\+)', end: '\\*/' }
                ]
            },
            strings: {
                patterns: [
                    {
                        name: 'string.quoted.single.dql',
                        begin: '\'',
                        end: '\'',
                        patterns: [{ name: 'constant.character.escape.dql', match: '\'\'' }]
                    },
                    {
                        name: 'string.quoted.double.dql',
                        begin: '"',
                        end: '"',
                        patterns: [{ name: 'constant.character.escape.dql', match: '\\\\"' }]
                    }
                ]
            },
            'object-ids': {
                patterns: [{ name: 'constant.other.objectid.dql', match: '\'[0-9a-fA-F]{16}\'' }]
            },
            numbers: {
                patterns: [{ name: 'constant.numeric.dql', match: '\\b\\d+(\\.\\d+)?\\b' }]
            },
            'repeating-attributes': {
                patterns: [{
                    match: '(\\w+)(\\[)(\\d+|\\*)(\\])',
                    captures: {
                        2: { name: 'punctuation.bracket.open.dql' },
                        3: { name: 'constant.numeric.index.dql' },
                        4: { name: 'punctuation.bracket.close.dql' }
                    }
                }]
            },
            'folder-paths': {
                patterns: [{ name: 'string.other.folderpath.dql', match: '\'/[^\']*\'' }]
            },
            keywords: { patterns: ofKind('keyword') },
            operators: {
                patterns: [
                    { name: 'keyword.operator.comparison.dql', match: '(=|<>|!=|<|>|<=|>=)' },
                    { name: 'keyword.operator.arithmetic.dql', match: '(\\+|-|\\*|/|%)' },
                    { name: 'keyword.operator.concatenation.dql', match: '\\|\\|' }
                ]
            },
            functions: { patterns: ofKind('function') },
            constants: { patterns: ofKind('constant') }
        }
    };
}

export function dqlGrammar(): DqlGrammar {
    return buildGrammar({ categories: DQL_CATEGORIES, hints: DQL_HINTS });
}
