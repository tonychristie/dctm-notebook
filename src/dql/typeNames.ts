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

    // TYPE also covers CREATE, ALTER and DROP TYPE.
    return /\b(from|join|into|update|type)$/.test(beforeWord) ||
        isLaterFromListItem(beforeWord) ||
        /\btype\s*\(\s*$/.test(beforeWord) ||
        /\bregister\s+(as|table)$/.test(beforeWord) ||
        // A subtype list: (ALL) dm_document, dm_folder
        /\(\s*all\s*\)$/.test(beforeWord);
}

// A FROM-list item is a type with an optional alias, so a comma after any other words is not in the list.
const FROM_LIST_ITEM = /^(\(\s*all\s*\)\s*)?([a-z_]\w*)(?:\s+(?:as\s+)?([a-z_]\w*))?$/;

function isLaterFromListItem(beforeWord: string): boolean {
    const from = /\bfrom\b(?!.*\bfrom\b)/s.exec(beforeWord);
    if (!from || !beforeWord.endsWith(',')) {
        return false;
    }
    const items = beforeWord.substring(from.index + from[0].length, beforeWord.length - 1).split(',');
    return items.every(item => {
        const match = FROM_LIST_ITEM.exec(item.trim());
        return match !== null && !isDqlWord(match[2]) && (match[3] === undefined || !isDqlWord(match[3]));
    });
}
