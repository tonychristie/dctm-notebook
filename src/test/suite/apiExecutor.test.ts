import * as assert from 'assert';
import {
    ApiExecutor,
    COMMON_DFC_METHODS,
    MethodInfo
} from '../../apiExecutor';
import { RepositoryConnection } from '../../repositoryConnection';

suite('ApiExecutor Test Suite', () => {
    let apiExecutor: ApiExecutor;

    setup(() => {
        apiExecutor = new ApiExecutor();
    });

    suite('execute', () => {
        test('calls the bridge with the session of the connection it is given', async () => {
            const sessionIds: string[] = [];
            const bridge = {
                executeApi: async (sessionId: string) => {
                    sessionIds.push(sessionId);
                    return { result: 'ok', resultType: 'string', executionTimeMs: 3 };
                }
            };
            const connection = { sessionId: 'session-7', bridge } as unknown as RepositoryConnection;

            const response = await apiExecutor.execute({ objectId: '0900000180000101', method: 'save' }, connection);

            assert.deepStrictEqual(sessionIds, ['session-7']);
            assert.strictEqual(response.result, 'ok');
        });
    });

    suite('COMMON_DFC_METHODS structure', () => {
        test('all methods have required fields', () => {
            Object.entries(COMMON_DFC_METHODS).forEach(([category, methods]) => {
                methods.forEach((method: MethodInfo) => {
                    assert.ok(method.name, `Method in ${category} should have name`);
                    assert.ok(method.returnType, `${method.name} should have returnType`);
                    assert.ok(Array.isArray(method.parameters),
                        `${method.name} should have parameters array`);
                });
            });
        });

        test('all parameters have required fields', () => {
            Object.values(COMMON_DFC_METHODS).forEach(methods => {
                methods.forEach((method: MethodInfo) => {
                    method.parameters.forEach(param => {
                        assert.ok(param.name, `Parameter in ${method.name} should have name`);
                        assert.ok(param.type, `Parameter ${param.name} should have type`);
                        assert.ok(typeof param.required === 'boolean',
                            `Parameter ${param.name} should have required boolean`);
                    });
                });
            });
        });

        test('categories have expected methods', () => {
            // Object Lifecycle
            const lifecycle = COMMON_DFC_METHODS['Object Lifecycle'];
            assert.ok(lifecycle.some(m => m.name === 'save'));
            assert.ok(lifecycle.some(m => m.name === 'destroy'));

            // Version Control
            const versionControl = COMMON_DFC_METHODS['Version Control'];
            assert.ok(versionControl.some(m => m.name === 'checkout'));
            assert.ok(versionControl.some(m => m.name === 'checkin'));
            assert.ok(versionControl.some(m => m.name === 'cancelCheckout'));

            // Permissions
            const permissions = COMMON_DFC_METHODS['Permissions'];
            assert.ok(permissions.some(m => m.name === 'getPermit'));
            assert.ok(permissions.some(m => m.name === 'grant'));
            assert.ok(permissions.some(m => m.name === 'revoke'));
        });
    });
});
