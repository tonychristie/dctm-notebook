import { onActions } from '../common';
import { DumpActions, DumpMessage, registerDumpActions } from '../dumpPanelShared';
import { groupDumpActions, typeDumpActions, userDumpActions } from '../entityDumpActions';
import { objectDumpActions } from '../objectDumpActions';

type DumpKind = 'object' | 'type' | 'user' | 'group';

export interface DumpContent {
    kind: DumpKind;
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
    private kind: DumpKind | undefined;

    constructor(root: HTMLElement, private readonly post: (message: object) => void) {
        this.content = root.querySelector<HTMLElement>('.dump-content')!;
        this.objectIdInput = root.querySelector<HTMLInputElement>('#dumpObjectId')!;
        this.backButton = root.querySelector<HTMLButtonElement>('#dumpBack')!;
        this.forwardButton = root.querySelector<HTMLButtonElement>('#dumpForward')!;

        const send = (message: DumpMessage) => this.post({ tab: 'dump', ...message });
        const actions: Record<DumpKind, DumpActions> = {
            object: objectDumpActions(this.content, send),
            type: typeDumpActions(send),
            user: userDumpActions(send),
            group: groupDumpActions(send)
        };
        registerDumpActions(this.content, () => this.kind && actions[this.kind]);
        onActions({
            dumpFromBox: () => this.dumpFromBox(),
            goBack: () => send({ command: 'goBack' }),
            goForward: () => send({ command: 'goForward' })
        }, root.querySelector<HTMLElement>('.dump-tab-header')!);
        this.objectIdInput.addEventListener('keydown', event => {
            if (event.key === 'Enter') {
                this.dumpFromBox();
            }
        });
    }

    setContent(content: DumpContent): void {
        this.kind = content.kind;
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
