export function escapeHtml(text: string): string {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

export function isObjectId(value: unknown): boolean {
    return typeof value === 'string' && /^[0-9a-f]{16}$/i.test(value);
}

const NULL_OBJECT_ID = '0000000000000000';

// The null ID fills an ID attribute that points at no object, so it is never a dump link.
export function isObjectIdLink(value: unknown): boolean {
    return isObjectId(value) && value !== NULL_OBJECT_ID;
}
