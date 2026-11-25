import { isDqlWord } from './vocabulary';

export interface TypeNameRange {
    line: number;
    start: number;
    length: number;
}

export function findTypeNames(text: string, isTypeName: (name: string) => boolean): TypeNameRange[] {
    const ranges: TypeNameRange[] = [];
    text.split('\n').forEach((line, lineNum) => {
        const identifierPattern = /\b([a-zA-Z_][a-zA-Z0-9_]*)\b/g;
        let match;
        while ((match = identifierPattern.exec(line)) !== null) {
            const word = match[1];
            if (!isDqlWord(word) && isTypeName(word) && isTypeContext(line.substring(0, match.index))) {
                ranges.push({ line: lineNum, start: match.index, length: word.length });
            }
        }
    });
    return ranges;
}

// Whether a type name is expected after this text.
export function isTypeContext(textBefore: string): boolean {
    const beforeWord = textBefore.toLowerCase().trim();

    return beforeWord.endsWith('from') ||
        // A later type in the FROM list
        /from\s+[\w_,\s]+,\s*$/i.test(beforeWord) ||
        /join\s*$/i.test(beforeWord) ||
        beforeWord.endsWith('into') ||
        /update\s*$/i.test(beforeWord) ||
        // TYPE, which also covers CREATE, ALTER and DROP TYPE
        beforeWord.endsWith('type') ||
        /type\s*\(\s*$/i.test(beforeWord) ||
        /register\s+(as|table)\s*$/i.test(beforeWord) ||
        // A subtype list: (ALL) dm_document, dm_folder
        /\(\s*all\s*\)\s*$/i.test(beforeWord);
}
