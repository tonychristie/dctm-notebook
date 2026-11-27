import { ActionHandler } from './common';
import { DumpActions, DumpMessage, groupActions } from './dumpPanelShared';

function commonHandlers(send: (message: DumpMessage) => void): Record<string, ActionHandler> {
    return {
        ...groupActions,
        refresh: () => send({ command: 'refresh' }),
        generateDql: () => send({ command: 'generateDql' }),
        copyName: el => send({ command: 'copyValue', value: el.dataset.value }),
        copyValue: el => send({ command: 'copyValue', value: el.dataset.value })
    };
}

export function typeDumpActions(send: (message: DumpMessage) => void): DumpActions {
    return {
        filterField: 'type',
        handlers: {
            ...commonHandlers(send),
            openType: el => send({ command: 'openType', typeName: el.dataset.value })
        }
    };
}

export function userDumpActions(send: (message: DumpMessage) => void): DumpActions {
    return {
        filterField: 'value',
        handlers: {
            ...commonHandlers(send),
            dumpObject: el => send({ command: 'dumpObject', objectId: el.dataset.value }),
            openGroup: el => send({ command: 'openGroup', groupName: el.dataset.value })
        }
    };
}

export function groupDumpActions(send: (message: DumpMessage) => void): DumpActions {
    return {
        filterField: 'value',
        handlers: {
            ...commonHandlers(send),
            dumpObject: el => send({ command: 'dumpObject', objectId: el.dataset.value }),
            openGroup: el => send({ command: 'openGroup', groupName: el.dataset.value }),
            openUser: el => send({ command: 'openUser', userName: el.dataset.value })
        }
    };
}
