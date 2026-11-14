/**
 * SoulForge Hotpath Forensics — minimal runtime trace helper (V1).
 *
 * 纯诊断：不改变业务结果，不做架构重构，不引入大型 logging framework。
 * 每条事件为单行 JSON，schema 与 mission2.9 规定的 SOULFORGE_HOTPATH_FORENSICS_V1 一致。
 * 复用已有 diagnostics/telemetry/correlationId 基础设施，仅增加轻量计数与计时。
 */
const counters = new Map();
const events = [];
export function forensicsTraceId(flow) {
    return `${flow}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
export function forensicsEmit(event) {
    events.push(event);
    const key = `${event.flow}:${event.layer}:${event.stage}:${event.op}`;
    counters.set(key, (counters.get(key) ?? 0) + 1);
    if (typeof process !== 'undefined' && process.env.SOULFORGE_FORENSICS_LOG === '1') {
        try {
            console.log(JSON.stringify(event));
        }
        catch { /* ignore */ }
    }
}
export function forensicsCount(key) {
    return counters.get(key) ?? 0;
}
export function forensicsSnapshot() {
    return { counters: Object.fromEntries(counters), events: [...events] };
}
export function forensicsReset() {
    counters.clear();
    events.length = 0;
}
export function forensicsCounterInc(key, delta = 1) {
    const next = (counters.get(key) ?? 0) + delta;
    counters.set(key, next);
    return next;
}
//# sourceMappingURL=forensics.js.map