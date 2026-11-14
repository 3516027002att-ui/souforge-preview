import { parseActionAddress } from '@soulforge/shared';
/**
 * `read_tae_events` 的 `file` 推断：完整 action URI 自带容器。
 *
 * 为什么单独放在 tools/ 之外：`scripts/agent-tool-modules.fixture.mjs` 要求
 * `ai/tools/*.ts` 里每个模块只导出一个工厂函数（否则它会把这当成两个工具声明）。
 * 这个规则是好的——它是「一个工具一个声明」的守卫——所以这里不破例，而是把纯函数
 * 挪到工具目录之外，让工具模块继续只暴露 createReadTaeEventsTool。
 *
 * 推理边界：只有当每个地址都是 `action://` URI、且都指向同一个 chr 时容器才唯一。
 * 旧式 `c1050#A0200` token 不带容器；跨 chr 的地址没有唯一正确答案。这两种情况都
 * 必须继续要求显式 file —— 猜一个容器等于编造写入/读取目标。
 */
export function containerFileFromActionUris(addresses) {
    if (addresses.length === 0) {
        return { ok: false, message: 'read_tae_events 需要 file：没有 addresses 时 file 必填（不带地址的预览必须指明容器）。' };
    }
    const chrs = new Set();
    const withoutContainer = [];
    for (const address of addresses) {
        const text = address.trim();
        const parsed = text.toLowerCase().startsWith('action://') ? parseActionAddress(text) : null;
        if (parsed === null) {
            withoutContainer.push(text);
            continue;
        }
        chrs.add(parsed.chr.toLowerCase());
    }
    if (withoutContainer.length > 0) {
        return {
            ok: false,
            message: `read_tae_events 需要 file：这些地址不带容器（${withoutContainer.slice(0, 3).join('、')}）；`
                + '只有完整 action:// URI（如 action://c0000/tae/9/A410000）才能省掉 file。'
        };
    }
    if (chrs.size > 1) {
        return {
            ok: false,
            message: `read_tae_events 需要 file：addresses 指向多个角色容器（${[...chrs].join('、')}），一次读取只能读一个容器。`
        };
    }
    return { ok: true, file: `chr/${[...chrs][0]}.anibnd.dcx` };
}
//# sourceMappingURL=taeContainerFile.js.map