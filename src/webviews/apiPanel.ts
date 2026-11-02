import type { MethodInfo } from '../apiExecutor';
import { escapeHtml } from '../htmlUtils';
import { formatResult, formatResultWithLinks } from '../webviewLogic';
import { byId, onActions, readWebviewData, vscode } from './common';

interface ResultMessage {
    success: boolean;
    result?: unknown;
    resultType?: string;
    executionTimeMs?: number;
    error?: string;
}

interface HistoryEntry {
    method: string;
    result: string;
    success: boolean;
    timestamp: string;
}

const METHODS = readWebviewData<Record<string, MethodInfo[]>>();

let selectedMethod: MethodInfo | null = null;
let selectedCategory: string | null = null;
const executionHistory: HistoryEntry[] = [];

function getAllMethods(): MethodInfo[] {
    return Object.values(METHODS).flat();
}

function visibleMethods(): MethodInfo[] {
    return selectedCategory ? METHODS[selectedCategory] : getAllMethods();
}

function renderCategories(): void {
    byId('categoryTabs').innerHTML = Object.keys(METHODS).map(cat =>
        `<span class="category-tab${selectedCategory === cat ? ' active' : ''}"
              data-action="filterByCategory" data-value="${escapeHtml(cat)}">${escapeHtml(cat)}</span>`
    ).join('');
}

function renderMethodList(methods: MethodInfo[]): void {
    byId('methodList').innerHTML = methods.map(m =>
        `<div class="method-item${selectedMethod?.name === m.name ? ' selected' : ''}"
              data-action="selectMethod" data-value="${escapeHtml(m.name)}">
            <div>
                <span class="method-name">${escapeHtml(m.name)}</span>
                <span class="method-return">: ${escapeHtml(m.returnType)}</span>
            </div>
            <div class="method-desc">${escapeHtml(m.description || '')}</div>
        </div>`
    ).join('');
}

function searchMethods(query: string): void {
    if (!query) {
        renderMethodList(visibleMethods());
        return;
    }

    const lower = query.toLowerCase();
    renderMethodList(getAllMethods().filter(m =>
        m.name.toLowerCase().includes(lower) ||
        (m.description && m.description.toLowerCase().includes(lower))
    ));
}

function selectMethod(method: MethodInfo): void {
    selectedMethod = method;
    renderMethodList(visibleMethods());
    renderParameters(method);
    byId<HTMLButtonElement>('executeBtn').disabled = false;
}

function renderParameters(method: MethodInfo): void {
    const section = byId('parametersSection');

    if (!method.parameters || method.parameters.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    byId('parameterInputs').innerHTML = method.parameters.map((p, i) =>
        `<div class="param-row">
            <label for="param${i}">${escapeHtml(p.name)}${p.required ? ' *' : ''}</label>
            <input type="text" id="param${i}" data-type="${escapeHtml(p.type)}" placeholder="${escapeHtml(p.type)}">
            <span class="param-type">${escapeHtml(p.type)}</span>
        </div>`
    ).join('');
}

function getParameterValues(): unknown[] {
    if (!selectedMethod || !selectedMethod.parameters) {
        return [];
    }

    return selectedMethod.parameters.map((p, i) => {
        const value = byId<HTMLInputElement>(`param${i}`).value;
        if (p.type === 'int') {
            return parseInt(value) || 0;
        }
        if (p.type === 'double') {
            return parseFloat(value) || 0.0;
        }
        if (p.type === 'boolean') {
            return value.toLowerCase() === 'true';
        }
        return value;
    });
}

function executeMethod(): void {
    if (!selectedMethod) {
        return;
    }

    const objectId = byId<HTMLInputElement>('objectId').value.trim();
    const args = getParameterValues();

    vscode.postMessage({
        type: 'execute',
        objectId: objectId || undefined,
        method: selectedMethod.name,
        args: args.length > 0 ? args : undefined
    });
}

function showLoading(method: string): void {
    byId('resultPanel').style.display = 'block';
    byId('resultContent').innerHTML = `<div class="loading">
        <div class="spinner"></div>
        Executing ${escapeHtml(method)}...
    </div>`;
}

function showResult(message: ResultMessage): void {
    const content = byId('resultContent');
    const timeSpan = byId('executionTime');
    const methodName = selectedMethod?.name ?? '';

    byId('resultPanel').style.display = 'block';

    if (message.success) {
        const resultWithLinks = formatResultWithLinks(formatResult(message.result));
        content.innerHTML = `<span class="success">Success</span>\n\n` +
            `Type: ${escapeHtml(message.resultType ?? '')}\n\n` +
            `Result:\n${resultWithLinks}`;
        timeSpan.textContent = `${message.executionTimeMs}ms`;

        addToHistory(methodName, formatResult(message.result).substring(0, 100), true);
    } else {
        content.innerHTML = `<span class="error">Error</span>\n\n${escapeHtml(message.error ?? '')}`;
        timeSpan.textContent = '';

        addToHistory(methodName, message.error ?? '', false);
    }
}

function addToHistory(method: string, result: string, success: boolean): void {
    executionHistory.unshift({ method, result, success, timestamp: new Date().toLocaleTimeString() });

    if (executionHistory.length > 10) {
        executionHistory.pop();
    }

    renderHistory();
}

function renderHistory(): void {
    const section = byId('historySection');

    if (executionHistory.length === 0) {
        section.style.display = 'none';
        return;
    }

    section.style.display = 'block';
    byId('historyList').innerHTML = executionHistory.map(h =>
        `<div class="history-item">
            <span class="method ${h.success ? 'success' : 'error'}">${escapeHtml(h.method)}()</span>
            <span class="time">${h.timestamp}</span>
            <div class="info" style="margin-top: 4px;">${escapeHtml(h.result)}</div>
        </div>`
    ).join('');
}

function clearForm(): void {
    byId<HTMLInputElement>('objectId').value = '';
    byId<HTMLInputElement>('methodSearch').value = '';
    selectedMethod = null;
    selectedCategory = null;
    byId('parametersSection').style.display = 'none';
    byId('resultPanel').style.display = 'none';
    byId<HTMLButtonElement>('executeBtn').disabled = true;
    renderCategories();
    renderMethodList(getAllMethods());
}

onActions({
    filterByCategory: el => {
        const category = el.dataset.value ?? null;
        selectedCategory = selectedCategory === category ? null : category;
        renderCategories();
        renderMethodList(visibleMethods());
    },
    selectMethod: el => {
        const method = getAllMethods().find(m => m.name === el.dataset.value);
        if (method) {
            selectMethod(method);
        }
    },
    execute: executeMethod,
    clearForm
});

document.addEventListener('click', event => {
    const target = event.target as HTMLElement;
    const objectId = target.classList?.contains('object-id') ? target.dataset.objectId : undefined;
    if (objectId) {
        vscode.postMessage({ type: 'dumpObject', objectId });
    }
});

byId<HTMLInputElement>('methodSearch').addEventListener('input', event => {
    searchMethods((event.target as HTMLInputElement).value);
});

window.addEventListener('message', event => {
    const message = event.data;
    switch (message.type) {
        case 'setObjectId':
            byId<HTMLInputElement>('objectId').value = message.objectId;
            break;
        case 'executing':
            showLoading(message.method);
            break;
        case 'result':
            showResult(message);
            break;
        case 'methodInfo':
            if (message.method) {
                selectMethod(message.method);
            }
            break;
    }
});

renderCategories();
renderMethodList(getAllMethods());
