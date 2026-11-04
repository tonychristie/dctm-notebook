import { AxiosInstance } from 'axios';

export interface RecordedCall {
    method: 'get' | 'post' | 'put' | 'delete';
    url: string;
    body?: unknown;
    params?: Record<string, unknown>;
    timeout?: number;
}

interface RequestConfig {
    params?: Record<string, unknown>;
    timeout?: number;
}

// A responder that throws makes the request reject. A responder may also return a promise.
export type Responder = (call: RecordedCall) => unknown;

export class FakeAxiosClient {
    calls: RecordedCall[] = [];

    constructor(private respond: Responder = () => ({})) {}

    get(url: string, config?: RequestConfig) {
        return this.record({ method: 'get', url, ...this.fromConfig(config) });
    }

    post(url: string, body?: unknown, config?: RequestConfig) {
        return this.record({ method: 'post', url, body, ...this.fromConfig(config) });
    }

    put(url: string, body?: unknown, config?: RequestConfig) {
        return this.record({ method: 'put', url, body, ...this.fromConfig(config) });
    }

    delete(url: string, config?: RequestConfig) {
        return this.record({ method: 'delete', url, ...this.fromConfig(config) });
    }

    asAxios(): AxiosInstance {
        return this as unknown as AxiosInstance;
    }

    callsTo(method: RecordedCall['method'], url: string): RecordedCall[] {
        return this.calls.filter(c => c.method === method && c.url === url);
    }

    private fromConfig(config?: RequestConfig): Pick<RecordedCall, 'params' | 'timeout'> {
        return { params: config?.params, timeout: config?.timeout };
    }

    private async record(call: RecordedCall): Promise<{ status: number; data: unknown }> {
        this.calls.push(call);
        return { status: 200, data: await this.respond(call) };
    }
}
