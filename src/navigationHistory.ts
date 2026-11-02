export class NavigationHistory<T> {
    private entries: T[] = [];
    private index = -1;

    add(entry: T): void {
        this.entries = this.entries.slice(0, this.index + 1);
        this.entries.push(entry);
        this.index = this.entries.length - 1;
    }

    back(): T | undefined {
        if (!this.canGoBack()) {
            return undefined;
        }
        this.index--;
        return this.entries[this.index];
    }

    forward(): T | undefined {
        if (!this.canGoForward()) {
            return undefined;
        }
        this.index++;
        return this.entries[this.index];
    }

    canGoBack(): boolean {
        return this.index > 0;
    }

    canGoForward(): boolean {
        return this.index < this.entries.length - 1;
    }
}

export function addToRecent(recent: string[], id: string, maxSize: number): string[] {
    return [id, ...recent.filter(existing => existing !== id)].slice(0, maxSize);
}
