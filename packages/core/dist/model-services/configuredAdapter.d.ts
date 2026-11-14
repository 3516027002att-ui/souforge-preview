import type { ModelServiceAdapter, ModelServiceConfig } from './types.js';
export interface ConfiguredModelServiceAdapterOptions {
    config?: ModelServiceConfig | null;
    apiKey?: string | null;
    sessionId?: string;
    fetchImpl?: typeof fetch;
}
export type ConfiguredModelServiceAdapterResult = {
    ok: true;
    status: 'configured';
    adapter: ModelServiceAdapter;
    diagnostics: [];
} | {
    ok: false;
    status: 'unconfigured' | 'invalid-configuration';
    adapter: null;
    diagnostics: [{
        severity: 'error';
        code: string;
        message: string;
    }];
};
/**
 * Main/core production factory for model-service adapters.
 *
 * Keeping this check ahead of adapter construction gives the default empty
 * configuration a deterministic, network-free result. Callers must not create
 * provider adapters directly from renderer input.
 */
export declare function createConfiguredModelServiceAdapter(options: ConfiguredModelServiceAdapterOptions): ConfiguredModelServiceAdapterResult;
/**
 * 模型服务 endpoint 安全校验：HTTPS 或本机回环 HTTP（127.0.0.1/localhost/[::1]）。
 * 生产工厂与 modelService.listModels 共用，安全口径只有一份。
 */
export declare function isAllowedEndpoint(endpoint: URL): boolean;
