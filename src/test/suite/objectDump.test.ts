import * as assert from 'assert';
import { toObjectAttributeEntry } from '../../attributeGroups';
import { ObjectDump, renderObjectDump } from '../../dumps/objectDump';

function dumpWith(name: string, value: unknown): ObjectDump {
    return {
        objectId: '0900000180001234',
        typeName: 'dm_document',
        objectName: 'Doc',
        attributes: [toObjectAttributeEntry(name, value)],
        standardAttributeNames: undefined,
        fetchTime: 1
    };
}

suite('Object Dump Test Suite', () => {
    test('an object ID value is a dump link', () => {
        const html = renderObjectDump(dumpWith('i_folder_id', '0b00000180000101'));

        assert.ok(html.includes('data-action="dumpObject" data-value="0b00000180000101"'));
    });

    test('the null ID is a plain value with no dump link', () => {
        const html = renderObjectDump(dumpWith('i_antecedent_id', '0000000000000000'));

        assert.ok(!html.includes('data-action="dumpObject"'));
        assert.ok(html.includes('data-action="copyValue" data-value="0000000000000000"'));
    });

    test('a null ID among repeating values is plain and the other IDs stay links', () => {
        const html = renderObjectDump(dumpWith('i_folder_id', ['0000000000000000', '0b00000180000101']));

        assert.ok(html.includes('data-action="copyValue" data-value="0000000000000000"'));
        assert.ok(html.includes('data-action="dumpObject" data-value="0b00000180000101"'));
    });
});
