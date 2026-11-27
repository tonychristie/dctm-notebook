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

export type ActionHandlers = Record<string, ActionHandler> | ((action: string) => ActionHandler | undefined);

export function onActions(handlers: ActionHandlers, root: Document | HTMLElement = document): void {
    const lookup = typeof handlers === 'function' ? handlers : (action: string) => handlers[action];
    root.addEventListener('click', event => {
        const el = (event.target as Element).closest<HTMLElement>('[data-action]');
        const handler = el && root.contains(el) ? lookup(el.dataset.action ?? '') : undefined;
        if (el && handler) {
            handler(el);
        }
    });
}

export function byId<T extends HTMLElement>(id: string): T {
    return document.getElementById(id) as T;
}
