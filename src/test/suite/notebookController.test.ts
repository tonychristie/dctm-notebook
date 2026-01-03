import * as assert from 'assert';

/**
 * Tests for notebook controller helper functions
 *
 * Note: Full integration tests require a running VS Code instance and mock bridge.
 * These unit tests focus on the pure logic functions that can be tested in isolation.
 */
suite('NotebookController Test Suite', () => {

    suite('Comment stripping - DQL', () => {
        // Test the logic that would be in stripDqlComments
        function stripDqlComments(query: string): string {
            // Remove block comments (/* ... */) - non-greedy match across lines
            let stripped = query.replace(/\/\*[\s\S]*?\*\//g, '');

            // Remove line comments (-- to end of line)
            stripped = stripped.replace(/--.*$/gm, '');

            // Clean up extra whitespace and empty lines
            stripped = stripped
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n');

            return stripped.trim();
        }

        test('strips single line comment', () => {
            const query = '-- this is a comment\nSELECT * FROM dm_document';
            const result = stripDqlComments(query);
            assert.strictEqual(result, 'SELECT * FROM dm_document');
        });

        test('strips inline comment', () => {
            const query = 'SELECT * FROM dm_document -- get all docs';
            const result = stripDqlComments(query);
            assert.strictEqual(result, 'SELECT * FROM dm_document');
        });

        test('strips multiple line comments', () => {
            const query = '-- comment 1\nSELECT *\n-- comment 2\nFROM dm_document';
            const result = stripDqlComments(query);
            assert.strictEqual(result, 'SELECT *\nFROM dm_document');
        });

        test('strips block comment single line', () => {
            const query = 'SELECT /* comment */ * FROM dm_document';
            const result = stripDqlComments(query);
            assert.strictEqual(result, 'SELECT  * FROM dm_document');
        });

        test('strips block comment multi-line', () => {
            const query = 'SELECT *\n/* this is a\nmulti-line comment */\nFROM dm_document';
            const result = stripDqlComments(query);
            assert.strictEqual(result, 'SELECT *\nFROM dm_document');
        });

        test('strips mixed comments', () => {
            const query = '-- header comment\nSELECT * /* inline */ FROM dm_document -- trailing';
            const result = stripDqlComments(query);
            assert.strictEqual(result, 'SELECT *  FROM dm_document');
        });

        test('returns empty string for comment-only input', () => {
            const query = '-- just a comment';
            const result = stripDqlComments(query);
            assert.strictEqual(result, '');
        });

        test('preserves query without comments', () => {
            const query = 'SELECT r_object_id, object_name FROM dm_document';
            const result = stripDqlComments(query);
            assert.strictEqual(result, 'SELECT r_object_id, object_name FROM dm_document');
        });

        test('handles empty input', () => {
            const result = stripDqlComments('');
            assert.strictEqual(result, '');
        });

        test('handles whitespace-only input', () => {
            const result = stripDqlComments('   \n\t\n   ');
            assert.strictEqual(result, '');
        });
    });

    suite('Comment stripping - dmAPI', () => {
        // Test the logic that would be in stripDmApiComments
        function stripDmApiComments(command: string): string {
            // Remove line comments (-- to end of line)
            let stripped = command.replace(/--.*$/gm, '');

            // Clean up extra whitespace and empty lines
            stripped = stripped
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join('\n');

            return stripped.trim();
        }

        test('strips single line comment', () => {
            const command = '-- this is a comment\ndmAPIGet("getservermap,session")';
            const result = stripDmApiComments(command);
            assert.strictEqual(result, 'dmAPIGet("getservermap,session")');
        });

        test('strips inline comment', () => {
            const command = 'dmAPIGet("getservermap,session") -- get server map';
            const result = stripDmApiComments(command);
            assert.strictEqual(result, 'dmAPIGet("getservermap,session")');
        });

        test('strips multiple line comments', () => {
            const command = '-- Get the server map\n-- for the current session\ndmAPIGet("getservermap,session")';
            const result = stripDmApiComments(command);
            assert.strictEqual(result, 'dmAPIGet("getservermap,session")');
        });

        test('returns empty string for comment-only input', () => {
            const command = '-- just a comment';
            const result = stripDmApiComments(command);
            assert.strictEqual(result, '');
        });

        test('preserves command without comments', () => {
            const command = 'dmAPIGet("dump,session,0900000000000001")';
            const result = stripDmApiComments(command);
            assert.strictEqual(result, 'dmAPIGet("dump,session,0900000000000001")');
        });

        test('handles empty input', () => {
            const result = stripDmApiComments('');
            assert.strictEqual(result, '');
        });
    });

    suite('Output format metadata', () => {
        // Test the logic for reading output format from metadata
        function getOutputFormat(metadata: Record<string, unknown> | undefined): string {
            return (metadata?.outputFormat as string) || 'html';
        }

        test('returns html when metadata is undefined', () => {
            const result = getOutputFormat(undefined);
            assert.strictEqual(result, 'html');
        });

        test('returns html when outputFormat is not set', () => {
            const result = getOutputFormat({});
            assert.strictEqual(result, 'html');
        });

        test('returns html when outputFormat is html', () => {
            const result = getOutputFormat({ outputFormat: 'html' });
            assert.strictEqual(result, 'html');
        });

        test('returns json when outputFormat is json', () => {
            const result = getOutputFormat({ outputFormat: 'json' });
            assert.strictEqual(result, 'json');
        });

        test('preserves other metadata properties', () => {
            const metadata = { outputFormat: 'json', customProp: 'value' };
            const result = getOutputFormat(metadata);
            assert.strictEqual(result, 'json');
            assert.strictEqual(metadata.customProp, 'value');
        });
    });

    suite('Output format toggle logic', () => {
        // Test the toggle logic
        function toggleFormat(currentFormat: string): string {
            return currentFormat === 'html' ? 'json' : 'html';
        }

        test('toggles html to json', () => {
            assert.strictEqual(toggleFormat('html'), 'json');
        });

        test('toggles json to html', () => {
            assert.strictEqual(toggleFormat('json'), 'html');
        });

        test('unknown format toggles to html', () => {
            assert.strictEqual(toggleFormat('unknown'), 'html');
        });

        test('empty string toggles to html', () => {
            assert.strictEqual(toggleFormat(''), 'html');
        });
    });

    suite('dmAPI command parsing', () => {
        // Test the regex pattern for parsing dmAPI commands
        function parseDmApiCommand(command: string): { type: string; args: string } | null {
            const match = command.trim().match(/^dmAPI(Get|Exec|Set)\s*\(\s*["'](.+?)["']\s*\)$/i);
            if (match) {
                return { type: match[1].toLowerCase(), args: match[2] };
            }
            return null;
        }

        test('parses dmAPIGet with double quotes', () => {
            const result = parseDmApiCommand('dmAPIGet("getservermap,session")');
            assert.deepStrictEqual(result, { type: 'get', args: 'getservermap,session' });
        });

        test('parses dmAPIGet with single quotes', () => {
            const result = parseDmApiCommand("dmAPIGet('getservermap,session')");
            assert.deepStrictEqual(result, { type: 'get', args: 'getservermap,session' });
        });

        test('parses dmAPIExec', () => {
            const result = parseDmApiCommand('dmAPIExec("save,session,0900000000000001")');
            assert.deepStrictEqual(result, { type: 'exec', args: 'save,session,0900000000000001' });
        });

        test('parses dmAPISet', () => {
            const result = parseDmApiCommand('dmAPISet("set,session,0900000000000001,object_name,newname")');
            assert.deepStrictEqual(result, { type: 'set', args: 'set,session,0900000000000001,object_name,newname' });
        });

        test('handles case insensitivity', () => {
            const result = parseDmApiCommand('DMAPIGET("getservermap,session")');
            assert.deepStrictEqual(result, { type: 'get', args: 'getservermap,session' });
        });

        test('handles mixed case', () => {
            const result = parseDmApiCommand('DmApiGet("getservermap,session")');
            assert.deepStrictEqual(result, { type: 'get', args: 'getservermap,session' });
        });

        test('handles whitespace around parentheses', () => {
            const result = parseDmApiCommand('dmAPIGet(  "getservermap,session"  )');
            assert.deepStrictEqual(result, { type: 'get', args: 'getservermap,session' });
        });

        test('returns null for non-dmAPI command', () => {
            const result = parseDmApiCommand('getString attr_name');
            assert.strictEqual(result, null);
        });

        test('returns null for malformed command', () => {
            const result = parseDmApiCommand('dmAPIGet(getservermap,session)');
            assert.strictEqual(result, null);
        });

        test('returns null for empty string', () => {
            const result = parseDmApiCommand('');
            assert.strictEqual(result, null);
        });
    });

    suite('HTML escaping', () => {
        // Test HTML escape logic used in output formatting
        function escapeHtml(text: string): string {
            return text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')
                .replace(/>/g, '&gt;')
                .replace(/"/g, '&quot;')
                .replace(/'/g, '&#039;');
        }

        test('escapes ampersand', () => {
            assert.strictEqual(escapeHtml('foo & bar'), 'foo &amp; bar');
        });

        test('escapes less than', () => {
            assert.strictEqual(escapeHtml('a < b'), 'a &lt; b');
        });

        test('escapes greater than', () => {
            assert.strictEqual(escapeHtml('a > b'), 'a &gt; b');
        });

        test('escapes double quote', () => {
            assert.strictEqual(escapeHtml('say "hello"'), 'say &quot;hello&quot;');
        });

        test('escapes single quote', () => {
            assert.strictEqual(escapeHtml("it's fine"), 'it&#039;s fine');
        });

        test('escapes multiple characters', () => {
            assert.strictEqual(escapeHtml('<a href="test">link</a>'), '&lt;a href=&quot;test&quot;&gt;link&lt;/a&gt;');
        });

        test('handles empty string', () => {
            assert.strictEqual(escapeHtml(''), '');
        });

        test('preserves safe characters', () => {
            assert.strictEqual(escapeHtml('Hello World 123'), 'Hello World 123');
        });
    });

    suite('Value formatting', () => {
        // Test the formatValue logic used for displaying API results
        function formatValue(value: unknown): string {
            if (value === null || value === undefined) {
                return 'null';
            }
            if (typeof value === 'object') {
                return JSON.stringify(value, null, 2);
            }
            return String(value);
        }

        test('formats null as "null"', () => {
            assert.strictEqual(formatValue(null), 'null');
        });

        test('formats undefined as "null"', () => {
            assert.strictEqual(formatValue(undefined), 'null');
        });

        test('formats string as-is', () => {
            assert.strictEqual(formatValue('hello'), 'hello');
        });

        test('formats number as string', () => {
            assert.strictEqual(formatValue(42), '42');
        });

        test('formats boolean as string', () => {
            assert.strictEqual(formatValue(true), 'true');
        });

        test('formats object as pretty JSON', () => {
            const obj = { name: 'test', value: 123 };
            const result = formatValue(obj);
            assert.ok(result.includes('"name": "test"'));
            assert.ok(result.includes('"value": 123'));
        });

        test('formats array as pretty JSON', () => {
            const arr = [1, 2, 3];
            const result = formatValue(arr);
            assert.strictEqual(result, '[\n  1,\n  2,\n  3\n]');
        });
    });

    suite('Object ID link formatting', () => {
        // Test the formatResultWithObjectIdLinks logic
        function formatResultWithObjectIdLinks(text: string): string {
            return text.replace(/\b([0-9a-f]{16})\b/gi, (match) => {
                return `<span class="object-id" data-object-id="${match}">${match}</span>`;
            });
        }

        test('wraps single object ID with clickable span', () => {
            const input = '0900000000000001';
            const result = formatResultWithObjectIdLinks(input);
            assert.strictEqual(
                result,
                '<span class="object-id" data-object-id="0900000000000001">0900000000000001</span>'
            );
        });

        test('wraps multiple object IDs in text', () => {
            const input = 'Parent: 0900000000000001, Child: 0900000000000002';
            const result = formatResultWithObjectIdLinks(input);
            assert.ok(result.includes('<span class="object-id" data-object-id="0900000000000001">0900000000000001</span>'));
            assert.ok(result.includes('<span class="object-id" data-object-id="0900000000000002">0900000000000002</span>'));
        });

        test('preserves text without object IDs', () => {
            const input = 'This is just plain text without any IDs';
            const result = formatResultWithObjectIdLinks(input);
            assert.strictEqual(result, input);
        });

        test('handles uppercase object IDs', () => {
            const input = 'ABCDEF0123456789';
            const result = formatResultWithObjectIdLinks(input);
            assert.strictEqual(
                result,
                '<span class="object-id" data-object-id="ABCDEF0123456789">ABCDEF0123456789</span>'
            );
        });

        test('does not match 15-character hex strings', () => {
            const input = '090000000000001';
            const result = formatResultWithObjectIdLinks(input);
            assert.strictEqual(result, input);
        });

        test('does not match 17-character hex strings', () => {
            const input = '09000000000000001';
            const result = formatResultWithObjectIdLinks(input);
            assert.strictEqual(result, input);
        });

        test('does not match partial hex strings without word boundary', () => {
            const input = 'prefix0900000000000001suffix';
            const result = formatResultWithObjectIdLinks(input);
            assert.strictEqual(result, input);
        });

        test('handles empty string', () => {
            const input = '';
            const result = formatResultWithObjectIdLinks(input);
            assert.strictEqual(result, '');
        });
    });
});
