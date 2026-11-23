import type { DocumentumConnection, StorageScope } from '../connectionManager';
import type { ConnectionsPanelData } from '../connectionsPanel';
import {
    ConnectionForm,
    ConnectionFormErrors,
    connectionToForm,
    describeConnection,
    newConnectionForm,
    validateConnectionForm
} from '../connectionForm';
import { escapeHtml } from '../htmlUtils';
import { byId, onActions, readWebviewData, vscode } from './common';

interface TestResultMessage {
    success?: boolean;
    message?: string;
}

const FIELDS: (keyof ConnectionForm)[] = ['name', 'type', 'docbroker', 'port', 'endpoint', 'repository', 'username'];
const VALIDATED_FIELDS: (keyof ConnectionForm)[] = ['name', 'docbroker', 'port', 'endpoint', 'repository'];

const initial = readWebviewData<ConnectionsPanelData>();

let connections: DocumentumConnection[] = initial.connections;
let scope: StorageScope = initial.scope;
let selectedName: string | undefined;
let baseForm: ConnectionForm = newConnectionForm();
let dirty = false;
let testing = false;

function field(name: keyof ConnectionForm): HTMLInputElement | HTMLSelectElement {
    return byId<HTMLInputElement | HTMLSelectElement>(name);
}

function readForm(): ConnectionForm {
    const form = newConnectionForm();
    for (const name of FIELDS) {
        (form as unknown as Record<string, string>)[name] = field(name).value;
    }
    return form;
}

function writeForm(form: ConnectionForm): void {
    for (const name of FIELDS) {
        field(name).value = form[name];
    }
}

function currentErrors(): ConnectionFormErrors {
    const otherNames = connections.map(c => c.name).filter(name => name !== selectedName);
    return validateConnectionForm(readForm(), otherNames);
}

function renderStorage(): void {
    byId('storageScope').textContent = scope === 'workspace' ? 'Workspace settings' : 'User settings';
}

function renderList(): void {
    byId('connectionList').innerHTML = connections.map(c =>
        `<div class="connection-item${c.name === selectedName ? ' selected' : ''}"
              data-action="select" data-value="${escapeHtml(c.name)}">
            <div>
                <span class="connection-name">${escapeHtml(c.name)}</span>
                <span class="connection-type">${escapeHtml(c.type)}</span>
            </div>
            <div class="connection-detail">${escapeHtml(describeConnection(c))}</div>
            <div class="connection-detail">${escapeHtml(c.repository ?? '')}</div>
        </div>`
    ).join('');

    byId<HTMLButtonElement>('duplicateBtn').disabled = selectedName === undefined;
    byId<HTMLButtonElement>('deleteBtn').disabled = selectedName === undefined;
}

function renderForm(): void {
    const type = field('type').value;
    document.querySelectorAll<HTMLElement>('[data-for-type]').forEach(group => {
        group.hidden = group.dataset.forType !== type;
    });

    const errors = currentErrors();
    for (const name of VALIDATED_FIELDS) {
        byId(`${name}Error`).textContent = errors[name] ?? '';
    }

    const valid = Object.keys(errors).length === 0;
    byId<HTMLButtonElement>('saveBtn').disabled = !valid;
    byId<HTMLButtonElement>('testBtn').disabled = !valid || testing;
}

function clearTestResult(): void {
    byId('testResult').innerHTML = '';
}

function openForm(name: string | undefined, form: ConnectionForm): void {
    selectedName = name;
    baseForm = form;
    dirty = false;
    writeForm(form);
    clearTestResult();
    renderList();
    renderForm();
}

function selectConnection(name: string): void {
    const connection = connections.find(c => c.name === name);
    if (connection) {
        openForm(name, connectionToForm(connection));
    }
}

function openNewForm(): void {
    openForm(undefined, newConnectionForm());
}

function openFirstOrNew(): void {
    if (connections.length > 0) {
        selectConnection(connections[0].name);
    } else {
        openNewForm();
    }
}

function duplicate(): void {
    const connection = connections.find(c => c.name === selectedName);
    if (connection) {
        openForm(undefined, { ...connectionToForm(connection), name: `${connection.name} (copy)` });
    }
}

function save(): void {
    if (Object.keys(currentErrors()).length > 0) {
        return;
    }
    const form = readForm();
    vscode.postMessage({ type: 'save', originalName: selectedName, form });
    selectedName = form.name.trim();
    dirty = false;
}

function test(): void {
    if (Object.keys(currentErrors()).length > 0 || testing) {
        return;
    }
    testing = true;
    byId('testResult').innerHTML = '<span class="info">Testing connection...</span>';
    renderForm();
    vscode.postMessage({ type: 'test', form: readForm() });
}

function showTestResult(result: TestResultMessage): void {
    testing = false;
    if (result.message === undefined) {
        clearTestResult();
    } else {
        byId('testResult').innerHTML =
            `<span class="${result.success ? 'success' : 'error'}">${escapeHtml(result.message)}</span>`;
    }
    renderForm();
}

function updateConnections(updated: DocumentumConnection[], updatedScope: StorageScope): void {
    connections = updated;
    scope = updatedScope;
    renderStorage();

    if (selectedName === undefined) {
        renderList();
        renderForm();
        return;
    }

    const selected = connections.find(c => c.name === selectedName);
    if (!selected) {
        openFirstOrNew();
    } else if (dirty) {
        renderList();
        renderForm();
    } else {
        openForm(selected.name, connectionToForm(selected));
    }
}

onActions({
    select: el => selectConnection(el.dataset.value ?? ''),
    add: openNewForm,
    duplicate,
    delete: () => {
        if (selectedName !== undefined) {
            vscode.postMessage({ type: 'delete', name: selectedName });
        }
    },
    save,
    cancel: () => openForm(selectedName, baseForm),
    test,
    openSettingsJson: () => vscode.postMessage({ type: 'openSettingsJson' })
});

byId('connectionForm').addEventListener('input', () => {
    dirty = true;
    renderForm();
});

byId('connectionForm').addEventListener('submit', event => event.preventDefault());

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'connections':
            updateConnections(message.connections, message.scope);
            break;
        case 'newConnection':
            openNewForm();
            break;
        case 'testResult':
            showTestResult(message);
            break;
    }
});

renderStorage();
if (initial.newConnection) {
    openNewForm();
} else {
    openFirstOrNew();
}
