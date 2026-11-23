interface VsCodeApi {
    postMessage(message: unknown): void;
    getState(): unknown;
    setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

export const vscode = acquireVsCodeApi();

export function readWebviewData<T>(): T {
    return JSON.parse(document.body.dataset.webview ?? '{}') as T;
}

export type ActionHandler = (el: HTMLElement) => void;

export function onActions(handlers: Record<string, ActionHandler>, root: Document | HTMLElement = document): void {
    root.addEventListener('click', event => {
        const el = (event.target as Element).closest<HTMLElement>('[data-action]');
        const handler = el && root.contains(el) ? handlers[el.dataset.action ?? ''] : undefined;
        if (el && handler) {
            handler(el);
        }
    });
}

export function byId<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}
