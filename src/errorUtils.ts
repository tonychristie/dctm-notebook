import { isAxiosError } from 'axios';

/**
 * Bridge error response structure.
 * The Java bridge returns errors in this format for all 4xx/5xx responses.
 */
export interface BridgeErrorResponse {
    status: number;
    code?: string;
    message: string;
    details?: string;
}

/**
 * Custom error class for bridge errors with structured information.
 * Preserves the error code, details, and HTTP status for programmatic access.
 */
export class BridgeError extends Error {
    readonly code?: string;
    readonly details?: string;
    readonly httpStatus: number;

    constructor(response: BridgeErrorResponse) {
        // Format: [CODE] Message\n\nDetails: ...
        let fullMessage = response.message;
        if (response.code) {
            fullMessage = `[${response.code}] ${fullMessage}`;
        }
        if (response.details) {
            fullMessage += `\n\nDetails: ${response.details}`;
        }

        super(fullMessage);
        this.name = 'BridgeError';
        this.code = response.code;
        this.details = response.details;
        this.httpStatus = response.status;
    }
}

/**
 * Type guard to check if data matches BridgeErrorResponse structure.
 */
function isBridgeErrorResponse(data: unknown): data is BridgeErrorResponse {
    if (typeof data !== 'object' || data === null) {
        return false;
    }
    const obj = data as Record<string, unknown>;
    return typeof obj.message === 'string' && typeof obj.status === 'number';
}

/**
 * Extract a meaningful error from an axios error.
 * Handles bridge error responses with structured error information.
 *
 * @param error The error to extract message from
 * @returns A user-friendly Error with meaningful message
 */
export function extractBridgeError(error: unknown): Error {
    // Handle axios errors with response data
    if (isAxiosError(error) && error.response?.data) {
        const data = error.response.data;

        if (isBridgeErrorResponse(data)) {
            console.error('Bridge error:', {
                status: data.status,
                code: data.code,
                message: data.message,
                details: data.details
            });
            return new BridgeError(data);
        }

        // Response data exists but doesn't match expected structure
        // Try to extract message field or stringify
        if (typeof data === 'object' && data !== null) {
            const obj = data as Record<string, unknown>;
            if (typeof obj.message === 'string') {
                return new Error(obj.message);
            }
        }

        // Last resort for response data
        if (typeof data === 'string') {
            return new Error(data);
        }
    }

    // Handle axios errors without response (network errors, timeouts)
    if (isAxiosError(error)) {
        if (error.code === 'ECONNREFUSED') {
            return new Error('Cannot connect to bridge. Is it running?');
        }
        if (error.code === 'ETIMEDOUT' || error.code === 'ECONNABORTED') {
            return new Error('Bridge request timed out');
        }
        // Fall back to axios message
        return new Error(error.message);
    }

    // Handle regular errors
    if (error instanceof Error) {
        return error;
    }

    // Handle unknown error types
    return new Error(String(error));
}
