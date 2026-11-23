import type { DocumentumConnection } from './connectionManager';

export interface ConnectionForm {
    name: string;
    type: 'dfc' | 'rest';
    docbroker: string;
    port: string;
    endpoint: string;
    repository: string;
    username: string;
}

export type ConnectionFormErrors = Partial<Record<keyof ConnectionForm, string>>;

export function describeConnection(connection: DocumentumConnection): string {
    return connection.type === 'rest'
        ? connection.endpoint || 'REST'
        : connection.docbroker
            ? `${connection.docbroker}:${connection.port || 1489}`
            : 'DFC';
}

export function newConnectionForm(): ConnectionForm {
    return { name: '', type: 'dfc', docbroker: '', port: '1489', endpoint: '', repository: '', username: '' };
}

export function connectionToForm(connection: DocumentumConnection): ConnectionForm {
    return {
        name: connection.name,
        type: connection.type === 'rest' ? 'rest' : 'dfc',
        docbroker: connection.docbroker ?? '',
        port: String(connection.port ?? 1489),
        endpoint: connection.endpoint ?? '',
        repository: connection.repository ?? '',
        username: connection.username ?? ''
    };
}

function isValidPort(port: string): boolean {
    const text = port.trim();
    return /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 65535;
}

export function validateConnectionForm(form: ConnectionForm, otherNames: string[]): ConnectionFormErrors {
    const errors: ConnectionFormErrors = {};
    const name = form.name.trim();

    if (!name) {
        errors.name = 'Name is required.';
    } else if (otherNames.includes(name)) {
        errors.name = 'A connection with this name already exists.';
    }

    if (form.type === 'dfc') {
        if (!form.docbroker.trim()) {
            errors.docbroker = 'Docbroker is required.';
        }
        if (!isValidPort(form.port)) {
            errors.port = 'Port must be a whole number from 1 to 65535.';
        }
    } else if (!form.endpoint.trim()) {
        errors.endpoint = 'Endpoint URL is required.';
    }

    if (!form.repository.trim()) {
        errors.repository = 'Repository is required.';
    }

    return errors;
}

export function formToConnection(form: ConnectionForm): DocumentumConnection {
    const connection: DocumentumConnection = {
        name: form.name.trim(),
        type: form.type,
        repository: form.repository
    };

    if (form.username.trim()) {
        connection.username = form.username;
    }

    if (form.type === 'dfc') {
        connection.docbroker = form.docbroker;
        connection.port = Number(form.port.trim());
    } else {
        connection.endpoint = form.endpoint;
    }

    return connection;
}
