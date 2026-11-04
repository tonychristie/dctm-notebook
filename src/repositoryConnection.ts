import { DctmBridge } from './dctmBridge';
import type { DocumentumConnection } from './connectionManager';
import { TypeCache } from './typeCache';
import { UserCache } from './userCache';
import { GroupCache } from './groupCache';

export class RepositoryConnection {
    readonly typeCache: TypeCache;
    readonly userCache: UserCache;
    readonly groupCache: GroupCache;

    constructor(
        readonly config: DocumentumConnection,
        readonly username: string,
        readonly sessionId: string,
        readonly bridge: DctmBridge
    ) {
        this.typeCache = new TypeCache(bridge, sessionId);
        this.userCache = new UserCache(bridge, sessionId);
        this.groupCache = new GroupCache(bridge, sessionId);
    }

    get name(): string {
        return this.config.name;
    }

    async refreshCaches(): Promise<void> {
        await Promise.allSettled([
            this.typeCache.refresh(),
            this.userCache.refresh(),
            this.groupCache.refresh()
        ]);
    }

    dispose(): void {
        this.typeCache.dispose();
        this.userCache.dispose();
        this.groupCache.dispose();
    }
}
