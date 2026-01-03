import * as assert from 'assert';
import { isDateValue, isDateColumn } from '../../notebook/exporter';

suite('Exporter Test Suite', () => {

    suite('isDateValue', () => {
        suite('Date objects', () => {
            test('returns true for Date object', () => {
                assert.strictEqual(isDateValue(new Date()), true);
            });

            test('returns true for specific Date', () => {
                assert.strictEqual(isDateValue(new Date('2024-01-15')), true);
            });
        });

        suite('ISO date strings', () => {
            test('returns true for date-only format (YYYY-MM-DD)', () => {
                assert.strictEqual(isDateValue('2024-01-15'), true);
            });

            test('returns true for full ISO format with time', () => {
                assert.strictEqual(isDateValue('2024-01-15T10:30:00'), true);
            });

            test('returns true for ISO format with milliseconds', () => {
                assert.strictEqual(isDateValue('2024-01-15T10:30:00.000'), true);
            });

            test('returns true for ISO format with Z timezone', () => {
                assert.strictEqual(isDateValue('2024-01-15T10:30:00.000Z'), true);
            });

            test('returns true for ISO format with time and Z', () => {
                assert.strictEqual(isDateValue('2024-01-15T10:30:00Z'), true);
            });
        });

        suite('Non-date values', () => {
            test('returns false for null', () => {
                assert.strictEqual(isDateValue(null), false);
            });

            test('returns false for undefined', () => {
                assert.strictEqual(isDateValue(undefined), false);
            });

            test('returns false for number', () => {
                assert.strictEqual(isDateValue(12345), false);
            });

            test('returns false for boolean', () => {
                assert.strictEqual(isDateValue(true), false);
            });

            test('returns false for empty string', () => {
                assert.strictEqual(isDateValue(''), false);
            });

            test('returns false for regular string', () => {
                assert.strictEqual(isDateValue('hello world'), false);
            });

            test('returns false for object ID (16-char hex)', () => {
                assert.strictEqual(isDateValue('0900000000000001'), false);
            });

            test('returns false for revision number', () => {
                assert.strictEqual(isDateValue('00'), false);
            });

            test('returns false for partial date', () => {
                assert.strictEqual(isDateValue('2024-01'), false);
            });

            test('returns false for invalid date format', () => {
                assert.strictEqual(isDateValue('01-15-2024'), false);
            });

            test('returns false for date with slashes', () => {
                assert.strictEqual(isDateValue('2024/01/15'), false);
            });
        });
    });

    suite('isDateColumn', () => {
        suite('Column name pattern matching', () => {
            test('returns true for r_modify_date', () => {
                assert.strictEqual(isDateColumn('r_modify_date', []), true);
            });

            test('returns true for r_creation_date', () => {
                assert.strictEqual(isDateColumn('r_creation_date', []), true);
            });

            test('returns true for r_access_date', () => {
                assert.strictEqual(isDateColumn('r_access_date', []), true);
            });

            test('returns true for column ending with _date', () => {
                assert.strictEqual(isDateColumn('custom_date', []), true);
            });

            test('returns true for column ending with _time', () => {
                assert.strictEqual(isDateColumn('start_time', []), true);
            });

            test('returns true for column ending with date (no underscore)', () => {
                assert.strictEqual(isDateColumn('modifydate', []), true);
            });

            test('returns true for column ending with time (no underscore)', () => {
                assert.strictEqual(isDateColumn('endtime', []), true);
            });

            test('returns true for timestamp column', () => {
                assert.strictEqual(isDateColumn('timestamp', []), true);
            });

            test('is case-insensitive for r_modify_date', () => {
                assert.strictEqual(isDateColumn('R_MODIFY_DATE', []), true);
            });

            test('is case-insensitive for custom_date', () => {
                assert.strictEqual(isDateColumn('CUSTOM_DATE', []), true);
            });
        });

        suite('Non-date column names', () => {
            test('returns false for r_object_id with no data', () => {
                assert.strictEqual(isDateColumn('r_object_id', []), false);
            });

            test('returns false for object_name with no data', () => {
                assert.strictEqual(isDateColumn('object_name', []), false);
            });

            test('returns false for r_version_label with no data', () => {
                assert.strictEqual(isDateColumn('r_version_label', []), false);
            });

            test('returns false for title with no data', () => {
                assert.strictEqual(isDateColumn('title', []), false);
            });
        });

        suite('Value sampling', () => {
            test('returns true when 80%+ of sampled values are dates', () => {
                const rows = [
                    { col1: '2024-01-15T10:00:00Z' },
                    { col1: '2024-01-16T10:00:00Z' },
                    { col1: '2024-01-17T10:00:00Z' },
                    { col1: '2024-01-18T10:00:00Z' },
                    { col1: 'not a date' } // 1 out of 5 = 20% non-date, 80% date
                ];
                assert.strictEqual(isDateColumn('col1', rows), true);
            });

            test('returns false when less than 80% of values are dates', () => {
                const rows = [
                    { col1: '2024-01-15T10:00:00Z' },
                    { col1: '2024-01-16T10:00:00Z' },
                    { col1: 'not a date' },
                    { col1: 'also not a date' },
                    { col1: 'still not a date' } // 2 out of 5 = 40% date
                ];
                assert.strictEqual(isDateColumn('col1', rows), false);
            });

            test('skips null values when sampling', () => {
                const rows = [
                    { col1: null },
                    { col1: '2024-01-15T10:00:00Z' },
                    { col1: undefined },
                    { col1: '2024-01-16T10:00:00Z' },
                    { col1: '' },
                    { col1: '2024-01-17T10:00:00Z' }
                ];
                // Only 3 non-null values sampled, all are dates = 100%
                assert.strictEqual(isDateColumn('col1', rows), true);
            });

            test('samples at most 10 values', () => {
                const rows: Record<string, unknown>[] = [];
                // Add 8 date values
                for (let i = 0; i < 8; i++) {
                    rows.push({ col1: `2024-01-${String(i + 1).padStart(2, '0')}T10:00:00Z` });
                }
                // Add 2 non-date values (still 80%)
                rows.push({ col1: 'not a date' });
                rows.push({ col1: 'also not' });
                // Add 10 more non-date values that shouldn't be sampled
                for (let i = 0; i < 10; i++) {
                    rows.push({ col1: 'extra non-date' });
                }
                // Should sample first 10, which is 80% dates
                assert.strictEqual(isDateColumn('col1', rows), true);
            });

            test('returns false for empty rows array', () => {
                assert.strictEqual(isDateColumn('unknown_col', []), false);
            });

            test('returns false when all values are null/empty', () => {
                const rows = [
                    { col1: null },
                    { col1: undefined },
                    { col1: '' }
                ];
                assert.strictEqual(isDateColumn('col1', rows), false);
            });
        });

        suite('Mixed scenarios', () => {
            test('column name pattern takes precedence over value sampling', () => {
                // Even with non-date values, name pattern should match
                const rows = [
                    { r_modify_date: 'not a date at all' },
                    { r_modify_date: 'also not a date' }
                ];
                assert.strictEqual(isDateColumn('r_modify_date', rows), true);
            });

            test('handles missing column in rows gracefully', () => {
                const rows = [
                    { other_col: 'value' },
                    { other_col: 'another value' }
                ];
                assert.strictEqual(isDateColumn('missing_col', rows), false);
            });

            test('revision column with leading zeroes is not a date', () => {
                const rows = [
                    { r_version_label: '00' },
                    { r_version_label: '01' },
                    { r_version_label: '02' },
                    { r_version_label: '03' }
                ];
                assert.strictEqual(isDateColumn('r_version_label', rows), false);
            });

            test('object ID column is not a date', () => {
                const rows = [
                    { r_object_id: '0900000000000001' },
                    { r_object_id: '0900000000000002' },
                    { r_object_id: '0900000000000003' }
                ];
                assert.strictEqual(isDateColumn('r_object_id', rows), false);
            });
        });
    });
});
