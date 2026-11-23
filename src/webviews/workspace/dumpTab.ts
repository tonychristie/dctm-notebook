import { onActions } from '../common';
import { registerObjectDumpActions } from '../objectDumpActions';

export interface DumpContent {
    html: string;
    objectId: string;
    canGoBack: boolean;
    canGoForward: boolean;
}

export class DumpTabView {
    private readonly content: HTMLElement;
    private readonly objectIdInput: HTMLInputElement;
    private readonly backButton: HTMLButtonElement;
    private readonly forwardButton: HTMLButtonElement;

    constructor(root: HTMLElement, private readonly post: (message: object) => void) {
        this.content = root.querySelector<HTMLElement>('.dump-content')!;
        this.objectIdInput = root.querySelector<HTMLInputElement>('#dumpObjectId')!;
        this.backButton = root.querySelector<HTMLButtonElement>('#dumpBack')!;
        this.forwardButton = root.querySelector<HTMLButtonElement>('#dumpForward')!;

        registerObjectDumpActions(root, message => this.post({ tab: 'dump', ...message }));
        onActions({ dumpFromBox: () => this.dumpFromBox() }, root);
        this.objectIdInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                this.dumpFromBox();
            }
        });
    }

    setContent(content: DumpContent): void {
        this.content.innerHTML = content.html;
        this.content.scrollTop = 0;
        this.objectIdInput.value = content.objectId;
        this.backButton.disabled = !content.canGoBack;
        this.forwardButton.disabled = !content.canGoForward;
    }

    private dumpFromBox(): void {
        const objectId = this.objectIdInput.value.trim();
        if (objectId) {
            this.post({ tab: 'dump', command: 'dumpObject', objectId });
        }
    }
}
