import * as assert from 'assert';
import { dqlGrammar } from '../../dql/grammar';
import { DQL_CATEGORIES, DQL_HINTS, dqlCategoryOf } from '../../dql/vocabulary';

interface Pattern {
    name?: string;
    match?: string;
    captures?: Record<string, { name: string }>;
    patterns?: Pattern[];
}

function allPatterns(patterns: Pattern[]): Pattern[] {
    return patterns.flatMap(pattern => [pattern, ...allPatterns(pattern.patterns ?? [])]);
}

function regexOf(match: string): RegExp {
    return new RegExp(match.replace('(?i)', ''), 'i');
}

const grammar = dqlGrammar();
const patterns = allPatterns(Object.values(grammar.repository).flatMap(entry => entry.patterns as Pattern[]));

suite('DQL vocabulary and grammar', () => {
    test('puts each word in one category', () => {
        const words = DQL_CATEGORIES.flatMap(category => category.words);

        assert.strictEqual(new Set(words).size, words.length);
    });

    test('splits phrases into words', () => {
        assert.strictEqual(dqlCategoryOf('order')?.scope, 'keyword.control.dql');
        assert.strictEqual(dqlCategoryOf('by')?.scope, 'keyword.control.dql');
        assert.strictEqual(dqlCategoryOf('outer')?.scope, 'keyword.other.clause.dql');
        assert.strictEqual(dqlCategoryOf('order by'), undefined);
    });

    test('keeps today\'s category of a word in several groups', () => {
        assert.strictEqual(dqlCategoryOf('group')?.scope, 'keyword.control.dql');
        assert.strictEqual(dqlCategoryOf('all')?.scope, 'keyword.control.dql');
        assert.strictEqual(dqlCategoryOf('folder')?.scope, 'keyword.other.object.dql');
        assert.strictEqual(dqlCategoryOf('score')?.scope, 'keyword.other.search.dql');
        assert.strictEqual(dqlCategoryOf('null')?.kind, 'constant');
        assert.strictEqual(dqlCategoryOf('first')?.kind, 'function');
    });

    test('the generated grammar has a pattern for every category that matches each of its words', () => {
        for (const category of DQL_CATEGORIES) {
            const pattern = patterns.find(p => p.name === category.scope);
            assert.ok(pattern?.match, category.scope);
            const regex = regexOf(pattern.match);
            for (const word of category.words) {
                const text = category.kind === 'function' ? `${word}(` : word;
                assert.ok(regex.exec(text)?.[1]?.toLowerCase() === word, `${category.scope} ${word}`);
            }
        }
    });

    test('a function name is matched only before (', () => {
        const pattern = patterns.find(p => p.name === 'support.function.permission.dql')!;

        assert.strictEqual(regexOf(pattern.match!).test('select object_name from dm_document'), false);
        assert.strictEqual(regexOf(pattern.match!).test('owner_name (x)'), true);
    });

    test('the hint pattern matches the hint words', () => {
        const regex = regexOf(patterns.find(p => p.name === 'keyword.other.hint.dql')!.match!);

        DQL_HINTS.forEach(hint => assert.ok(regex.test(hint), hint));
    });

    test('the generated grammar has no fixed type pattern', () => {
        assert.deepStrictEqual(patterns.filter(p => p.name?.startsWith('storage.type')), []);
        assert.strictEqual(grammar.repository.types, undefined);
        assert.ok(!grammar.patterns.some(p => (p as Pattern & { include?: string }).include === '#types'));
    });

    test('a repeating attribute keeps its bracket and index scopes and gives the name no scope', () => {
        const [pattern] = grammar.repository['repeating-attributes'].patterns as Pattern[];

        assert.deepStrictEqual(Object.keys(pattern.captures!), ['2', '3', '4']);
        assert.strictEqual(pattern.captures!['3'].name, 'constant.numeric.index.dql');
    });
});
