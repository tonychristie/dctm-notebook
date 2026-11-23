import type { MethodInfo } from '../../apiExecutor';
import { escapeHtml } from '../../htmlUtils';
import { convertParameters, filterMethods, formatResult, formatResultWithLinks } from '../../webviewLogic';
import { onActions } from '../common';

export interface ApiHistoryEntry {
    method: string;
    result: string;
    success: boolean;
    timestamp: string;
}

export type ApiResult =
    | {
        type: 'apiResult';
        success: true;
        result: unknown;
        resultType: string;
        executionTimeMs: number;
        history: ApiHistoryEntry[];
    }
    | { type: 'apiResult'; success: false; error: string; history: ApiHistoryEntry[] };

export class ApiTabView {
    private methods: Record<string, MethodInfo[]> = {};
    private selectedMethod: MethodInfo | null = null;
    private selectedCategory: string | null = null;

    private readonly objectIdInput: HTMLInputElement;
    private readonly searchInput: HTMLInputElement;
    private readonly categories: HTMLElement;
    private readonly methodList: HTMLElement;
    private readonly parameters: HTMLElement;
    private readonly parameterInputs: HTMLElement;
    private readonly executeButton: HTMLButtonElement;
    private readonly resultPanel: HTMLElement;
    private readonly resultContent: HTMLElement;
    private readonly executionTime: HTMLElement;
    private readonly historySection: HTMLElement;
    private readonly historyList: HTMLElement;

    constructor(root: HTMLElement, private readonly post: (message: object) => void) {
        const find = <T extends HTMLElement>(selector: string) => root.querySelector<T>(selector)!;
        this.objectIdInput = find<HTMLInputElement>('#apiObjectId');
        this.searchInput = find<HTMLInputElement>('#apiMethodSearch');
        this.categories = find('.api-categories');
        this.methodList = find('.api-method-list');
        this.parameters = find('.api-parameters');
        this.parameterInputs = find('.api-parameter-inputs');
        this.executeButton = find<HTMLButtonElement>('.api-execute');
        this.resultPanel = find('.api-result');
        this.resultContent = find('.api-result-content');
        this.executionTime = find('.api-execution-time');
        this.historySection = find('.api-history');
        this.historyList = find('.api-history-list');

        onActions({
            filterByCategory: el => {
                const category = el.dataset.value ?? null;
                this.selectedCategory = this.selectedCategory === category ? null : category;
                this.renderCategories();
                this.renderMethodList();
            },
            selectMethod: el => {
                const method = Object.values(this.methods).flat().find(m => m.name === el.dataset.value);
                if (method) {
                    this.selectMethod(method);
                }
            },
            execute: () => this.execute(),
            clearForm: () => this.clearForm()
        }, root);

        this.resultContent.addEventListener('click', event => {
            const target = event.target as HTMLElement;
            const objectId = target.classList.contains('object-id') ? target.dataset.objectId : undefined;
            if (objectId) {
                this.post({ tab: 'api', command: 'dumpObject', objectId });
            }
        });
        this.searchInput.addEventListener('input', () => this.renderMethodList());
        this.parameterInputs.addEventListener('input', () => this.updateExecuteButton());
    }

    // The method list never changes, so later state messages leave the selection alone.
    setMethods(methods: Record<string, MethodInfo[]>): void {
        if (Object.keys(this.methods).length > 0) {
            return;
        }
        this.methods = methods;
        this.renderCategories();
        this.renderMethodList();
    }

    setObjectId(objectId: string): void {
        this.objectIdInput.value = objectId;
    }

    showExecuting(method: string): void {
        this.resultPanel.hidden = false;
        this.executionTime.textContent = '';
        this.resultContent.innerHTML = `<div class="api-loading">
            <div class="api-spinner"></div>
            Executing ${escapeHtml(method)}...
        </div>`;
    }

    showResult(message: ApiResult): void {
        this.resultPanel.hidden = false;

        if (message.success) {
            this.resultContent.innerHTML = `<span class="api-success">Success</span>\n\n` +
                `Type: ${escapeHtml(message.resultType)}\n\n` +
                `Result:\n${formatResultWithLinks(formatResult(message.result))}`;
            this.executionTime.textContent = `${message.executionTimeMs}ms`;
        } else {
            this.resultContent.innerHTML = `<span class="api-error">Error</span>\n\n${escapeHtml(message.error)}`;
            this.executionTime.textContent = '';
        }
        this.showHistory(message.history);
    }

    showHistory(history: ApiHistoryEntry[]): void {
        this.historySection.hidden = history.length === 0;
        this.historyList.innerHTML = history.map(h =>
            `<div class="api-history-item">
                <span class="api-history-method ${h.success ? 'api-success' : 'api-error'}">${escapeHtml(h.method)}()</span>
                <span class="api-history-time">${escapeHtml(h.timestamp)}</span>
                <div class="api-info">${escapeHtml(h.result)}</div>
            </div>`
        ).join('');
    }

    private visibleMethods(): MethodInfo[] {
        return filterMethods(this.methods, this.selectedCategory, this.searchInput.value);
    }

    private renderCategories(): void {
        this.categories.innerHTML = Object.keys(this.methods).map(cat =>
            `<span class="api-category${this.selectedCategory === cat ? ' active' : ''}"
                  data-action="filterByCategory" data-value="${escapeHtml(cat)}">${escapeHtml(cat)}</span>`
        ).join('');
    }

    private renderMethodList(): void {
        this.methodList.innerHTML = this.visibleMethods().map(m =>
            `<div class="api-method${this.selectedMethod?.name === m.name ? ' selected' : ''}"
                  data-action="selectMethod" data-value="${escapeHtml(m.name)}">
                <div>
                    <span class="api-method-name">${escapeHtml(m.name)}</span>
                    <span class="api-method-return">: ${escapeHtml(m.returnType)}</span>
                </div>
                <div class="api-method-desc">${escapeHtml(m.description || '')}</div>
            </div>`
        ).join('');
    }

    private selectMethod(method: MethodInfo): void {
        this.selectedMethod = method;
        this.renderMethodList();
        this.renderParameters(method);
        this.updateExecuteButton();
    }

    private renderParameters(method: MethodInfo): void {
        if (!method.parameters || method.parameters.length === 0) {
            this.parameters.hidden = true;
            this.parameterInputs.innerHTML = '';
            return;
        }

        this.parameters.hidden = false;
        this.parameterInputs.innerHTML = method.parameters.map((p, i) =>
            `<div class="api-param-row">
                <label for="apiParam${i}">${escapeHtml(p.name)}${p.required ? ' *' : ''}</label>
                <input type="text" id="apiParam${i}" data-type="${escapeHtml(p.type)}" placeholder="${escapeHtml(p.type)}">
                <span class="api-param-type">${escapeHtml(p.type)}</span>
            </div>`
        ).join('');
    }

    private parameterValues(): unknown[] | undefined {
        if (!this.selectedMethod) {
            return undefined;
        }
        const inputs = Array.from(this.parameterInputs.querySelectorAll<HTMLInputElement>('input'));
        return convertParameters(this.selectedMethod.parameters, inputs.map(input => input.value));
    }

    private updateExecuteButton(): void {
        this.executeButton.disabled = this.parameterValues() === undefined;
    }

    private execute(): void {
        const args = this.parameterValues();
        if (!this.selectedMethod || !args) {
            return;
        }

        const objectId = this.objectIdInput.value.trim();
        this.post({
            tab: 'api',
            command: 'execute',
            objectId: objectId || undefined,
            method: this.selectedMethod.name,
            args: args.length > 0 ? args : undefined
        });
    }

    private clearForm(): void {
        this.objectIdInput.value = '';
        this.searchInput.value = '';
        this.selectedMethod = null;
        this.selectedCategory = null;
        this.parameters.hidden = true;
        this.parameterInputs.innerHTML = '';
        this.resultPanel.hidden = true;
        this.executeButton.disabled = true;
        this.renderCategories();
        this.renderMethodList();
    }
}
