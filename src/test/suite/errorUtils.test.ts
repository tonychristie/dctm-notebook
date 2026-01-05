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

            test('extracts message from full bridge error response', () => {
                const responseData: BridgeErrorResponse = {
                    status: 400,
                    code: 'E_INPUT_ILLEGAL_ARGUMENTS',
                    message: 'There are illegal arguments provided.',
                    details: 'Failed to instantiate class Foo'
                };
                const axiosError = createMockAxiosError(responseData, 400);

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof BridgeError);
                assert.ok(result.message.includes('There are illegal arguments provided'));
                assert.ok(result.message.includes('E_INPUT_ILLEGAL_ARGUMENTS'));
                assert.ok(result.message.includes('Failed to instantiate class Foo'));

                const bridgeError = result as BridgeError;
                assert.strictEqual(bridgeError.code, 'E_INPUT_ILLEGAL_ARGUMENTS');
                assert.strictEqual(bridgeError.details, 'Failed to instantiate class Foo');
                assert.strictEqual(bridgeError.httpStatus, 400);
            });

            test('handles bridge error without details', () => {
                const responseData: BridgeErrorResponse = {
                    status: 404,
                    code: 'E_OBJECT_NOT_FOUND',
                    message: 'Object not found'
                };
                const axiosError = createMockAxiosError(responseData, 404);

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof BridgeError);
                assert.ok(result.message.includes('Object not found'));
                assert.ok(result.message.includes('E_OBJECT_NOT_FOUND'));
                assert.ok(!result.message.includes('Details:'));

                const bridgeError = result as BridgeError;
                assert.strictEqual(bridgeError.details, undefined);
            });

            test('handles bridge error without code', () => {
                const responseData = {
                    status: 500,
                    message: 'Internal server error'
                };
                const axiosError = createMockAxiosError(responseData, 500);

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof BridgeError);
                assert.strictEqual(result.message, 'Internal server error');

                const bridgeError = result as BridgeError;
                assert.strictEqual(bridgeError.code, undefined);
            });

            test('handles bridge error with only message and status', () => {
                const responseData: BridgeErrorResponse = {
                    status: 401,
                    message: 'Authentication failed'
                };
                const axiosError = createMockAxiosError(responseData, 401);

                const result = extractBridgeError(axiosError);

                assert.ok(result instanceof BridgeError);
                assert.strictEqual(result.message, 'Authentication failed');
            });

            test('formats error message with code prefix', () => {
                const responseData: BridgeErrorResponse = {
                    status: 400,
                    code: 'E_DQL_SYNTAX_ERROR',
                    message: 'Syntax error at position 12'
                };
                const axiosError = createMockAxiosError(responseData, 400);

                const result = extractBridgeError(axiosError);

                assert.strictEqual(result.message, '[E_DQL_SYNTAX_ERROR] Syntax error at position 12');
            });

            test('formats error message with details suffix', () => {
                const responseData: BridgeErrorResponse = {
                    status: 400,
                    message: 'Query failed',
                    details: 'Column "foo" does not exist'
                };
                const axiosError = createMockAxiosError(responseData, 400);

                const result = extractBridgeError(axiosError);

                assert.ok(result.message.includes('Query failed'));
                assert.ok(result.message.includes('\n\nDetails: Column "foo" does not exist'));
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

                // Should fall back to plain error since status is missing
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
                status: 400,
                message: 'Test error'
            };

            const error = new BridgeError(response);

            assert.strictEqual(error.name, 'BridgeError');
        });

        test('is instanceof Error', () => {
            const response: BridgeErrorResponse = {
                status: 400,
                message: 'Test error'
            };

            const error = new BridgeError(response);

            assert.ok(error instanceof Error);
            assert.ok(error instanceof BridgeError);
        });

        test('preserves structured properties', () => {
            const response: BridgeErrorResponse = {
                status: 403,
                code: 'E_PERMISSION_DENIED',
                message: 'Access denied',
                details: 'User lacks read permission'
            };

            const error = new BridgeError(response);

            assert.strictEqual(error.httpStatus, 403);
            assert.strictEqual(error.code, 'E_PERMISSION_DENIED');
            assert.strictEqual(error.details, 'User lacks read permission');
        });
    });
});
