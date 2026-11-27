import * as assert from 'assert';
import { ConnectionForm, formToConnection, validateConnectionForm } from '../../connectionForm';

const dfcForm: ConnectionForm = {
    name: 'Dfc',
    type: 'dfc',
    docbroker: 'broker',
    port: '1489',
    endpoint: '',
    repository: 'repo',
    username: ''
};

const restForm: ConnectionForm = {
    name: 'Rest',
    type: 'rest',
    docbroker: '',
    port: '',
    endpoint: 'http://dctm:8080/dctm-rest',
    repository: 'repo',
    username: ''
};

suite('Connection Form Test Suite', () => {
    suite('validateConnectionForm', () => {
        test('a complete DFC form and a complete REST form are valid', () => {
            assert.deepStrictEqual(validateConnectionForm(dfcForm, []), {});
            assert.deepStrictEqual(validateConnectionForm(restForm, []), {});
        });

        test('a DFC form with no docbroker is not valid for docbroker', () => {
            const errors = validateConnectionForm({ ...dfcForm, docbroker: ' ' }, []);

            assert.deepStrictEqual(Object.keys(errors), ['docbroker']);
        });

        test('a DFC port of 0, 65536 or not a whole number is not valid for port', () => {
            for (const port of ['0', '65536', '1489.5', 'abc', '']) {
                const errors = validateConnectionForm({ ...dfcForm, port }, []);

                assert.deepStrictEqual(Object.keys(errors), ['port'], port);
            }
        });

        test('a DFC port of 1 or 65535 is valid', () => {
            assert.deepStrictEqual(validateConnectionForm({ ...dfcForm, port: '1' }, []), {});
            assert.deepStrictEqual(validateConnectionForm({ ...dfcForm, port: '65535' }, []), {});
        });

        test('a REST form with no endpoint is not valid, and the same form with type DFC does not report the endpoint', () => {
            const noEndpoint = { ...restForm, endpoint: '' };

            assert.deepStrictEqual(Object.keys(validateConnectionForm(noEndpoint, [])), ['endpoint']);
            assert.strictEqual(
                validateConnectionForm({ ...noEndpoint, type: 'dfc', docbroker: 'broker', port: '1489' }, []).endpoint,
                undefined
            );
        });

        test('a name used by another connection is not valid, and the connection\'s own saved name is valid', () => {
            assert.deepStrictEqual(Object.keys(validateConnectionForm({ ...dfcForm, name: ' Rest ' }, ['Rest'])), ['name']);
            assert.deepStrictEqual(validateConnectionForm(dfcForm, ['Rest']), {});
        });

        test('an empty name or repository is not valid', () => {
            const errors = validateConnectionForm({ ...dfcForm, name: '', repository: '' }, []);

            assert.deepStrictEqual(Object.keys(errors).sort(), ['name', 'repository']);
        });
    });

    suite('formToConnection', () => {
        test('a DFC form drops the endpoint and converts the port to a number', () => {
            assert.deepStrictEqual(formToConnection({ ...dfcForm, endpoint: 'http://left-over' }), {
                name: 'Dfc',
                type: 'dfc',
                repository: 'repo',
                docbroker: 'broker',
                port: 1489
            });
        });

        test('a REST form drops the docbroker and port', () => {
            assert.deepStrictEqual(formToConnection({ ...restForm, docbroker: 'broker', port: '1489' }), {
                name: 'Rest',
                type: 'rest',
                repository: 'repo',
                endpoint: 'http://dctm:8080/dctm-rest'
            });
        });

        test('keeps a username, leaves out an empty one and trims the name', () => {
            assert.strictEqual(formToConnection({ ...restForm, username: 'dmadmin' }).username, 'dmadmin');
            assert.ok(!('username' in formToConnection(restForm)));
            assert.strictEqual(formToConnection({ ...restForm, name: '  Rest  ' }).name, 'Rest');
        });
    });
});
