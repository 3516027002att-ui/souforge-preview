import type { WorkspaceSession } from '../workspace/workspaceSession.js';
import type { HostResolvedEmevdEventTarget } from '../ai/toolRegistry.js';
export type WriteRequiredShape = 'fields' | 'full-event' | 'full-script';
export interface WriteTargetRequirement {
    objectKey: string;
    outerSourceKey: string;
    requiredFields?: string[];
    requiredShape?: WriteRequiredShape;
}
/**
 * 从实际修改 payload 构建写入要求。不从模型填写的 task target 取目标。
 * 未覆盖的修改/提交工具一律抛错（失败关闭），不得默认放行。
 */
export declare function buildWriteRequirement(toolName: string, input: unknown, outerSourceKey: string): WriteTargetRequirement[];
/** 注册表级断言：全部生产写入工具都必须有明确 requirement。 */
export declare function assertAllMutatingToolsClassified(mutatingTools: Iterable<string>): void;
export interface SessionWriteRequirement {
    objectKey: string;
    outerSourceKey: string;
    requiredFields?: string[];
    requiredShape?: WriteRequiredShape;
    /** 整个集合（EMEVD 事件 id / PARAM 表行 / FMG 表条目）都已按页交付（分页读按并集判定）。 */
    requiredItemSet?: boolean;
    /**
     * 内容锚点：读证明必须仍然匹配这个版本才算「同一个对象」。
     *
     * 目前只有 PARAM 提供它（子表 sha256）。它让「同容器另一张表被写过」不再作废本表的
     * 读证明：本表的子项字节没变，哈希自然相等。没有锚点的域保持失败关闭。
     */
    version?: {
        outerFileHash?: string;
        childHash?: string;
        sourceRevision?: number;
        generation?: number;
    };
    /** 主键缺席时回退（仅 FMG 新增条目凭容器读取授权）。 */
    fallback?: SessionWriteRequirement;
}
/**
 * 写入目标子表当前的内容哈希：容器路径 + 这次要写的表/行 → 子表 sha256。
 *
 * 由宿主（ToolRegistry）注入，因为只有它持有原生编辑会话。无论结果如何，返回数组都
 * 与 `targets` **按位置一一对应**：`undefined` 表示这张表这次没有可用锚点（拼写没有
 * 唯一落到一张物理子表 / 子项压缩存储 / 原生读取失败），写入退回失败关闭语义，而不是
 * 被一个猜测的哈希卡死。行也一起传进来，是因为一个原生类型名可以对应多张物理子表，
 * 锚点必须绑定到 selectParamTableRows 判定出的那张实际子表，而不是调用方拼写。
 */
export type ParamAnchorTarget = {
    readonly table: string;
    readonly rowIds: readonly number[];
};
export type ParamChildHashResolver = (containerPath: string, targets: readonly ParamAnchorTarget[]) => Promise<ReadonlyArray<string | undefined>>;
/** 新边界无法表达时回退旧边界（非 {tool,args} 形态的通用 proposal）。 */
export declare class LegacyFallbackError extends Error {
    constructor(message: string);
}
/**
 * 会话级写入要求：读写两侧用同一外层源推导，保证证明键一致。
 * 仅覆盖证明已生产的读取形态（PARAM 字段、整事件）；其余工具抛
 * ProofError，由调用方回退旧边界或失败关闭。
 */
export declare function buildSessionWriteRequirements(toolName: string, input: unknown, session: WorkspaceSession | undefined, resolvedEmevdTarget?: HostResolvedEmevdEventTarget, paramChildHashes?: ParamChildHashResolver, depth?: number): Promise<SessionWriteRequirement[]>;
