import { onActions } from '../common';
import { Tree, TreeNode } from '../tree';

interface CabinetNode extends TreeNode {
    type: 'cabinet' | 'folder' | 'document';
    objectId: string;
    path?: string;
}

type CabinetsResult =
    | { type: 'cabinetsResult'; requestId: number; nodes: CabinetNode[] }
    | { type: 'cabinetsResult'; requestId: number; error: string };

interface PendingRequest {
    resolve(nodes: CabinetNode[]): void;
    reject(error: Error): void;
}

export class CabinetsTabView {
    private readonly tree: Tree<CabinetNode>;
    private readonly pending = new Map<number, PendingRequest>();
    private nextRequestId = 0;
    private requested = false;

    constructor(root: HTMLElement, private readonly post: (message: object) => void) {
        this.tree = new Tree<CabinetNode>(root.querySelector<HTMLElement>('.tree-container')!, {
            loadChildren: node => this.request({
                command: 'loadChildren',
                nodeId: node.id,
                objectId: node.objectId,
                path: node.path ?? ''
            }),
            open: node => this.post({ tab: 'cabinets', command: 'open', objectId: node.objectId })
        });
        onActions({ refreshCabinets: () => this.load() }, root);
    }

    load(): void {
        void this.tree.loadRoots(() => this.request({ command: 'loadCabinets' }));
    }

    ensureLoaded(): void {
        if (!this.requested) {
            this.requested = true;
            this.load();
        }
    }

    // A reopened connection has a new session, so the tab loads again the next time it is shown.
    reset(): void {
        this.requested = false;
    }

    refreshNode(nodeId: string): void {
        void this.tree.reload(nodeId);
    }

    onResult(result: CabinetsResult): void {
        const request = this.pending.get(result.requestId);
        if (!request) {
            return;
        }
        this.pending.delete(result.requestId);
        if ('error' in result) {
            request.reject(new Error(result.error));
        } else {
            request.resolve(result.nodes);
        }
    }

    private request(fields: object): Promise<CabinetNode[]> {
        const requestId = ++this.nextRequestId;
        return new Promise((resolve, reject) => {
            this.pending.set(requestId, { resolve, reject });
            this.post({ tab: 'cabinets', requestId, ...fields });
        });
    }
}
