import * as assert from 'assert';

/**
 * Tests for ObjectDumpView helper functions
 *
 * Note: Full integration tests require a running VS Code instance.
 * These unit tests focus on the validation logic that can be tested in isolation.
 */
suite('ObjectDumpView Test Suite', () => {

    suite('Object ID validation', () => {
        // Test the isValidObjectId logic used in the view
        function isValidObjectId(value: string): boolean {
            const trimmed = value.trim();
            if (!trimmed) {
                return false;
            }
            return /^[0-9a-f]{16}$/i.test(trimmed);
        }

        test('accepts valid 16-character hex IDs', () => {
            assert.strictEqual(isValidObjectId('0900000000000001'), true);
            assert.strictEqual(isValidObjectId('0c00000180000102'), true);
            assert.strictEqual(isValidObjectId('ABCDEF0123456789'), true);
            assert.strictEqual(isValidObjectId('abcdef0123456789'), true);
        });

        test('accepts IDs with leading/trailing whitespace', () => {
            assert.strictEqual(isValidObjectId('  0900000000000001  '), true);
            assert.strictEqual(isValidObjectId('\t0900000000000001\n'), true);
        });

        test('rejects IDs with wrong length', () => {
            assert.strictEqual(isValidObjectId('090000000000001'), false);  // 15 chars
            assert.strictEqual(isValidObjectId('09000000000000001'), false); // 17 chars
            assert.strictEqual(isValidObjectId('09000000'), false);          // 8 chars
            assert.strictEqual(isValidObjectId(''), false);                  // empty
        });

        test('rejects IDs with invalid characters', () => {
            assert.strictEqual(isValidObjectId('0900000000000g01'), false); // 'g' is invalid
            assert.strictEqual(isValidObjectId('090000000000000!'), false); // '!' is invalid
            assert.strictEqual(isValidObjectId('0900 000000000001'), false); // space in middle
            assert.strictEqual(isValidObjectId('0900-000000000001'), false); // dash
        });

        test('rejects non-hex formats', () => {
            assert.strictEqual(isValidObjectId('not-an-object-id'), false);
            assert.strictEqual(isValidObjectId('0x0900000000000001'), false); // hex prefix
            assert.strictEqual(isValidObjectId('1234567890123456'), true);    // all digits is valid hex
        });
    });

    suite('Input sanitization', () => {
        function sanitizeInput(value: string): string {
            return value.trim().toLowerCase();
        }

        test('trims whitespace', () => {
            assert.strictEqual(sanitizeInput('  0900000000000001  '), '0900000000000001');
        });

        test('converts to lowercase', () => {
            assert.strictEqual(sanitizeInput('ABCDEF0123456789'), 'abcdef0123456789');
            assert.strictEqual(sanitizeInput('AbCdEf0123456789'), 'abcdef0123456789');
        });

        test('handles empty input', () => {
            assert.strictEqual(sanitizeInput(''), '');
            assert.strictEqual(sanitizeInput('   '), '');
        });
    });
});
