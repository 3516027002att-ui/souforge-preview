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
export declare function containerFileFromActionUris(addresses: readonly string[]): {
    ok: true;
    file: string;
} | {
    ok: false;
    message: string;
};
