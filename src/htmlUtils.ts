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
