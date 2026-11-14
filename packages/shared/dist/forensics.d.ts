/**
 * SoulForge Hotpath Forensics — minimal runtime trace helper (V1).
 *
 * 纯诊断：不改变业务结果，不做架构重构，不引入大型 logging framework。
 * 每条事件为单行 JSON，schema 与 mission2.9 规定的 SOULFORGE_HOTPATH_FORENSICS_V1 一致。
 * 复用已有 diagnostics/telemetry/correlationId 基础设施，仅增加轻量计数与计时。
 */
export type ForensicsFlow = 'param' | 'map' | 'action' | 'rollback';
export type ForensicsLayer = 'renderer' | 'preload' | 'main' | 'bridge' | 'native' | 'authority' | 'ui';
export type ForensicsResult = 'ok' | 'empty' | 'error' | 'fallback';
export interface ForensicsEvent {
    schema: 'SOULFORGE_HOTPATH_FORENSICS_V1';
    traceId: string;
    flow: ForensicsFlow;
    layer: ForensicsLayer;
    stage: string;
    op: string;
    resource: string;
    ts: number;
    durationMs: number;
    metrics: Record<string, number | string | boolean | null>;
    result: ForensicsResult;
    errorCode: string | null;
}
export declare function forensicsTraceId(flow: ForensicsFlow): string;
export declare function forensicsEmit(event: ForensicsEvent): void;
export declare function forensicsCount(key: string): number;
export declare function forensicsSnapshot(): {
    counters: Record<string, number>;
    events: ForensicsEvent[];
};
export declare function forensicsReset(): void;
export declare function forensicsCounterInc(key: string, delta?: number): number;
