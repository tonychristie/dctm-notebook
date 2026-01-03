/**
 * Export functionality for notebook results
 *
 * Provides Excel and JSON export capabilities for DQL query results.
 */

import * as vscode from 'vscode';
import * as ExcelJS from 'exceljs';

/**
 * Check if a value appears to be a date
 * Recognizes ISO date strings and Date objects
 */
function isDateValue(value: unknown): boolean {
    if (value instanceof Date) {
        return true;
    }
    if (typeof value !== 'string') {
        return false;
    }
    // Check for ISO date format (e.g., 2024-01-15T10:30:00.000Z or 2024-01-15)
    const isoDatePattern = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;
    return isoDatePattern.test(value);
}

/**
 * Check if a column contains date values by sampling the first few non-null values
 */
function isDateColumn(columnName: string, rows: Record<string, unknown>[]): boolean {
    // Common date column name patterns
    const dateColumnPatterns = [
        /date$/i,
        /time$/i,
        /timestamp$/i,
        /^r_modify_date$/i,
        /^r_creation_date$/i,
        /^r_access_date$/i,
        /_date$/i,
        /_time$/i
    ];

    // Check if column name matches date patterns
    if (dateColumnPatterns.some(pattern => pattern.test(columnName))) {
        return true;
    }

    // Sample up to 10 non-null values to determine if column contains dates
    let dateCount = 0;
    let sampleCount = 0;
    for (const row of rows) {
        const value = row[columnName];
        if (value !== null && value !== undefined && value !== '') {
            sampleCount++;
            if (isDateValue(value)) {
                dateCount++;
            }
            if (sampleCount >= 10) {
                break;
            }
        }
    }

    // Consider it a date column if most sampled values are dates
    return sampleCount > 0 && dateCount >= sampleCount * 0.8;
}

/**
 * Export data to Excel file (.xlsx)
 *
 * All non-date columns are formatted as Text to preserve leading zeroes
 * (e.g., revisions 00, 01, 02) and prevent Excel from auto-formatting.
 */
export async function exportToExcel(
    columns: string[],
    rows: Record<string, unknown>[]
): Promise<void> {
    // Show save dialog
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('query_results.xlsx'),
        filters: {
            'Excel Files': ['xlsx']
        },
        saveLabel: 'Export to Excel'
    });

    if (!uri) {
        return; // User cancelled
    }

    // Determine which columns are date columns
    const dateColumns = new Set<string>();
    for (const col of columns) {
        if (isDateColumn(col, rows)) {
            dateColumns.add(col);
        }
    }

    // Create workbook and worksheet
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Documentum VS Code Extension';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Query Results');

    // Set up columns with proper formatting
    worksheet.columns = columns.map(col => ({
        header: col,
        key: col,
        width: Math.max(col.length + 2, 15) // Minimum width based on header length
    }));

    // Style header row
    const headerRow = worksheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' }
    };

    // Add data rows with proper formatting
    for (const row of rows) {
        const rowData: Record<string, unknown> = {};
        for (const col of columns) {
            const value = row[col];

            if (value === null || value === undefined) {
                rowData[col] = '';
            } else if (dateColumns.has(col)) {
                // Keep date values as-is for date columns
                if (typeof value === 'string' && isDateValue(value)) {
                    rowData[col] = new Date(value);
                } else {
                    rowData[col] = value;
                }
            } else {
                // Convert to string to preserve as text (preserves leading zeroes)
                rowData[col] = String(value);
            }
        }
        worksheet.addRow(rowData);
    }

    // Apply text format to non-date columns to preserve leading zeroes
    for (let colIdx = 1; colIdx <= columns.length; colIdx++) {
        const colName = columns[colIdx - 1];
        if (!dateColumns.has(colName)) {
            // Set column format to text (@ is the text format code in Excel)
            const column = worksheet.getColumn(colIdx);
            column.numFmt = '@';
        }
    }

    // Auto-fit column widths based on content (approximate)
    worksheet.columns.forEach((column, colIdx) => {
        const colName = columns[colIdx];
        let maxLength = colName.length;
        for (const row of rows) {
            const value = row[colName];
            if (value !== null && value !== undefined) {
                const length = String(value).length;
                if (length > maxLength) {
                    maxLength = length;
                }
            }
        }
        column.width = Math.min(maxLength + 2, 50); // Cap at 50 characters
    });

    // Write to buffer and save
    const buffer = await workbook.xlsx.writeBuffer();
    await vscode.workspace.fs.writeFile(uri, new Uint8Array(buffer as ArrayBuffer));

    vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${uri.fsPath}`);
}

/**
 * Export data to JSON file (.json)
 */
export async function exportToJson(
    columns: string[],
    rows: Record<string, unknown>[]
): Promise<void> {
    // Show save dialog
    const uri = await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file('query_results.json'),
        filters: {
            'JSON Files': ['json']
        },
        saveLabel: 'Export to JSON'
    });

    if (!uri) {
        return; // User cancelled
    }

    // Create JSON structure with metadata
    const exportData = {
        exportedAt: new Date().toISOString(),
        columns: columns,
        rowCount: rows.length,
        rows: rows
    };

    // Write JSON with pretty formatting
    const jsonContent = JSON.stringify(exportData, null, 2);
    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(uri, encoder.encode(jsonContent));

    vscode.window.showInformationMessage(`Exported ${rows.length} rows to ${uri.fsPath}`);
}
