import { AxiosInstance } from 'axios';

export interface RecordedCall {
    method: 'get' | 'post' | 'put' | 'delete';
    url: string;
    body?: unknown;
    params?: Record<string, unknown>;
}

// A responder that throws makes the request reject.
export type Responder = (call: RecordedCall) => unknown;

export class FakeAxiosClient {
    calls: RecordedCall[] = [];

    constructor(private respond: Responder = () => ({})) {}

    get(url: string, config?: { params?: Record<string, unknown> }) {
        return this.record({ method: 'get', url, params: config?.params });
    }

    post(url: string, body?: unknown, config?: { params?: Record<string, unknown> }) {
        return this.record({ method: 'post', url, body, params: config?.params });
    }

    put(url: string, body?: unknown, config?: { params?: Record<string, unknown> }) {
        return this.record({ method: 'put', url, body, params: config?.params });
    }

    delete(url: string, config?: { params?: Record<string, unknown> }) {
        return this.record({ method: 'delete', url, params: config?.params });
    }

    asAxios(): AxiosInstance {
        return this as unknown as AxiosInstance;
    }

    callsTo(method: RecordedCall['method'], url: string): RecordedCall[] {
        return this.calls.filter(c => c.method === method && c.url === url);
    }

    private record(call: RecordedCall): Promise<{ status: number; data: unknown }> {
        this.calls.push(call);
        try {
            return Promise.resolve({ status: 200, data: this.respond(call) });
        } catch (error) {
            return Promise.reject(error);
        }
    }
}
