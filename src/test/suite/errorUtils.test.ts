import * as assert from 'assert';
import { extractBridgeError, BridgeError, BridgeErrorResponse } from '../../errorUtils';
import { AxiosError, AxiosHeaders } from 'axios';

/**
 * Tests for error extraction utility functions.
 *
 * These tests verify that bridge error responses are correctly parsed
 * and transformed into user-friendly error messages.
 */

/**
 * Helper to create a mock AxiosError with response data.
 */
function createMockAxiosError(responseData: unknown, statusCode: number = 400): AxiosError {
    const headers = new AxiosHeaders();
    return {
        isAxiosError: true,
        response: {
            data: responseData,
            status: statusCode,
            statusText: 'Error',
            headers: headers,
            config: { headers: headers }
        },
        message: `Request failed with status code ${statusCode}`,
        name: 'AxiosError',
        config: { headers: headers },
        toJSON: () => ({})
    } as AxiosError;
}

/**
 * Helper to create a mock AxiosError without response (network error).
 */
function createNetworkAxiosError(code: string, message: string): AxiosError {
    const headers = new AxiosHeaders();
    return {
        isAxiosError: true,
        code: code,
        message: message,
        name: 'AxiosError',
        config: { headers: headers },
        toJSON: () => ({})
    } as AxiosError;
}

suite('Error Utils Test Suite', () => {

    suite('extractBridgeError', () => {

        suite('Bridge error responses', () => {

            test('converts a bridge error with null details into a BridgeError', () => {
                const responseData = {
                    code: 'DQL_ERROR',
                    message: 'DQL execution failed: [DM_QUERY_E_SYNTAX]error: syntax error',
                    details: null,
                    timestamp: '2026-11-06T08:30:28.468021942Z',
                    path: '/api/v1/dql'
                };
                const axiosError = createMockAxiosError(responseData, 400);

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof BridgeError);
                assert.strictEqual(result.httpStatus, 400);
                assert.strictEqual(result.code, 'DQL_ERROR');
                assert.strictEqual(
                    result.message,
                    '[DQL_ERROR] DQL execution failed: [DM_QUERY_E_SYNTAX]error: syntax error'
                );
            });

            test('appends details to the message of a BridgeError', () => {
                const responseData = {
                    code: 'INTERNAL_ERROR',
                    message: 'An unexpected error occurred',
                    details: 'java.lang.IllegalStateException: session closed',
                    timestamp: '2026-11-06T08:31:12.104558211Z',
                    path: '/api/v1/dql'
                };
                const axiosError = createMockAxiosError(responseData, 500);

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof BridgeError);
                assert.strictEqual(result.httpStatus, 500);
                assert.strictEqual(result.details, 'java.lang.IllegalStateException: session closed');
                assert.ok(result.message.endsWith('Details: java.lang.IllegalStateException: session closed'));
            });

            test('converts a body with a message and no code into a plain Error', () => {
                const responseData = {
                    message: 'Internal server error',
                    timestamp: '2026-11-06T08:31:12.104558211Z',
                    path: '/api/v1/dql'
                };
                const axiosError = createMockAxiosError(responseData, 500);

                const result = extractBridgeError(axiosError);

                assert.ok(!(result instanceof BridgeError));
                assert.strictEqual(result.message, 'Internal server error');
            });
        });

        suite('Non-standard response data', () => {

            test('extracts message from object with message property', () => {
                const responseData = {
                    message: 'Something went wrong',
                    error: 'bad_request'
                };
                const axiosError = createMockAxiosError(responseData, 400);

                const result = extractBridgeError(axiosError);

                // Should fall back to plain error since code is missing
                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'Something went wrong');
            });

            test('handles string response data', () => {
                const axiosError = createMockAxiosError('Plain text error', 500);

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'Plain text error');
            });

            test('handles null response data gracefully', () => {
                const axiosError = createMockAxiosError(null, 500);

                const result = extractBridgeError(axiosError);

                // Should fall back to axios message
                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'Request failed with status code 500');
            });

            test('handles empty object response data', () => {
                const axiosError = createMockAxiosError({}, 500);

                const result = extractBridgeError(axiosError);

                // Should fall back to axios message
                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'Request failed with status code 500');
            });
        });

        suite('Network errors (no response)', () => {

            test('handles connection refused error', () => {
                const axiosError = createNetworkAxiosError('ECONNREFUSED', 'connect ECONNREFUSED 127.0.0.1:9876');

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof Error);
                assert.ok(result.message.includes('Cannot connect to bridge'));
            });

            test('handles timeout error (ETIMEDOUT)', () => {
                const axiosError = createNetworkAxiosError('ETIMEDOUT', 'timeout of 30000ms exceeded');

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof Error);
                assert.ok(result.message.includes('timed out'));
            });

            test('handles timeout error (ECONNABORTED)', () => {
                const axiosError = createNetworkAxiosError('ECONNABORTED', 'timeout of 30000ms exceeded');

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof Error);
                assert.ok(result.message.includes('timed out'));
            });

            test('falls back to axios message for unknown network errors', () => {
                const axiosError = createNetworkAxiosError('ENOTFOUND', 'getaddrinfo ENOTFOUND localhost');

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'getaddrinfo ENOTFOUND localhost');
            });
        });

        suite('Non-axios errors', () => {

            test('returns regular Error unchanged', () => {
                const originalError = new Error('Something went wrong');

                const result = extractBridgeError(originalError);

                assert.strictEqual(result, originalError);
                assert.strictEqual(result.message, 'Something went wrong');
            });

            test('converts string to Error', () => {
                const result = extractBridgeError('string error');

                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'string error');
            });

            test('converts number to Error', () => {
                const result = extractBridgeError(42);

                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, '42');
            });

            test('converts null to Error', () => {
                const result = extractBridgeError(null);

                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'null');
            });

            test('converts undefined to Error', () => {
                const result = extractBridgeError(undefined);

                assert.ok(result instanceof Error);
                assert.strictEqual(result.message, 'undefined');
            });
        });
    });

    suite('BridgeError class', () => {

        test('sets name property to BridgeError', () => {
            const response: BridgeErrorResponse = {
                code: 'DQL_ERROR',
                message: 'Test error'
            };

            const error = new BridgeError(response, 400);

            assert.strictEqual(error.name, 'BridgeError');
        });

        test('is instanceof Error', () => {
            const response: BridgeErrorResponse = {
                code: 'DQL_ERROR',
                message: 'Test error'
            };

            const error = new BridgeError(response, 400);

            assert.ok(error instanceof Error);
            assert.ok(error instanceof BridgeError);
        });

        test('preserves structured properties', () => {
            const response: BridgeErrorResponse = {
                code: 'E_PERMISSION_DENIED',
                message: 'Access denied',
                details: 'User lacks read permission'
            };

            const error = new BridgeError(response, 403);

            assert.strictEqual(error.httpStatus, 403);
            assert.strictEqual(error.code, 'E_PERMISSION_DENIED');
            assert.strictEqual(error.details, 'User lacks read permission');
        });
    });
});
