/**
 * Full EMEVD editor-document assembly via paginated Bridge reads.
 *
 * The Bridge `read-emevd-document` envelope is trimmed (256-instruction sample
 * by default); large real documents must be read page by page (hard constraint
 * 17) and assembled on the authoritative side (main/core), never on the
 * renderer. Assembly is validated: page indices must be continuous, the
 * collected instruction total must match the envelope total, and every event's
 * instruction slice must stay in range.
 *
 * EVENT-30A: the outer resource is opened as-is. DCX unwrap happens natively in
 * the C# Bridge (`DcxNativeDocument`), so production open never imports the
 * TypeScript DCX parser and never materializes a decompressed temp file that
 * could later be (mis)used as the Patch target. The read result therefore
 * carries `sourceFormat` / `outerFileHash` (the outer container identity) in
 * addition to the payload-level `sourceHash`, plus a bounded outline DTO for
 * the source IDE.
 */
import type { EmevdDocumentOutline, EmevdEditorDocument, EmevdEventIr } from '@soulforge/shared';
import { type EmedfRegistry } from '../emevd/emedfSchema.js';
export interface EmevdInstructionPageEntry {
    index: number;
    bank: number;
    id: number;
    argsLength: number;
    argsBase64: string;
    layerOffset: number;
}
export interface EmevdEnvelopePage {
    sourceHash: string;
    /** "emevd" for raw input; "dcx" when Bridge unwrapped a .dcx wrapper. */
    sourceFormat?: string;
    /** SHA-256 of the file bytes as opened (the outer container, not the payload). */
    outerFileHash?: string;
    eventCount: number;
    instructionCount: number;
    instructionTotal?: number;
    instructionPage?: number;
    instructionPageSize?: number;
    instructionPageCount?: number;
    events?: Array<{
        id: number;
        instructionCount: number;
        instructionStartIndex?: number;
        restBehavior: number;
        layerCount?: number;
        parameters?: Array<{
            instructionIndex: number;
            targetStartByte: number;
            sourceStartByte: number;
            byteCount: number;
            unkId: number;
        }>;
    }>;
    instructionsSample?: EmevdInstructionPageEntry[];
    authority?: string;
    /**
     * Bridge 签发的短命文档会话。只允许留在 main/core；不得发给 renderer。
     * 后续页带上它，从同一份已解析快照切片，bypass 也不会每页重解析。
     */
    documentSession?: string;
}
export interface ReadFullEmevdDocumentInput {
    /** Path to the outer source resource: raw .emevd or DFLT/KRAK-wrapped .dcx. */
    filePath: string;
    allowedRoots: string[];
    resourceUri: string;
    registry?: EmedfRegistry;
    documentInstanceId?: string;
    pageSize?: number;
    timeoutMs?: number;
    /**
     * Oodle 运行时根。game-side 的 event 目录是 KRAK 压缩，缺它 Bridge 解不开;
     * mod-side 的 DFLT 不需要。S15 回归靶：新的读入口必须把它传到底。
     */
    oodleRuntimeRoot?: string;
    /**
     * Bridge 文档缓存策略。`default`（缺省）命中即复用，正常打开用它；`bypass`
     * 无条件重读磁盘、既不命中也不写缓存 —— 提交前的新鲜读与写回后的重读必须用它，
     * 那两处要的是「此刻磁盘上的真实内容」，不能依赖任何缓存判定。
     */
    cachePolicy?: 'default' | 'bypass';
    /**
     * 取消信号。传给第一页与**所有后续**分页请求，并在页装配与 outline 构建前复查。
     * 取消时返回 `cancelled: true` + `EMEVD_LOAD_CANCELLED`，不是解析失败 —— 调用方
     * 必须把它静默丢弃，不能渲染成「打开失败」。
     */
    signal?: AbortSignal;
    /**
     * 是否把第一页签发的 documentSession 传给后续页。缺省 true。
     * 测试可以关掉，以覆盖「会话过期后退回逐页读 + 指纹校验」这条路径。
     */
    useDocumentSession?: boolean;
    /**
     * 写链需要稳定锚。打开路径保持 false，避免 139ms SHA-256 长帧。
     */
    attachIdentity?: boolean;
}
export interface ReadFullEmevdDocumentResult {
    ok: boolean;
    /**
     * 调用方主动取消。与 `ok: false` 的解析失败是两回事：取消不代表文件有问题，
     * 不得渲染成打开失败，也不得写进主进程文档缓存。判定用它，不要去 grep 诊断码。
     */
    cancelled?: boolean;
    document?: EmevdEditorDocument;
    diagnostics: Array<{
        severity: string;
        code: string;
        message: string;
    }>;
    pageCount: number;
    instructionTotal: number;
    /** SHA-256 of the decompressed EMEVD source bytes (Bridge commit precondition). */
    sourceHash?: string;
    /** "emevd" or "dcx" — how Bridge opened the outer source. */
    sourceFormat?: string;
    /** SHA-256 of the outer file bytes as opened (Patch target precondition). */
    outerFileHash?: string;
    /**
     * Bridge 的往返判定（`native-verified` = 语义且字节一致，`candidate` = 仅语义）。
     * 打开事件文档的调用方只发一次 read 就要拿到它，不再为一行状态另发一次
     * `read-emevd-document`。
     */
    authority?: string;
    /** Bounded event outline for the source IDE; never carries instruction bodies. */
    outline?: EmevdDocumentOutline;
}
export declare const DEFAULT_OUTLINE_LIMIT = 4096;
/** 取消码。`ok: false` 但**不是**解析失败：调用方按 `cancelled` 分支静默丢弃。 */
export declare const EMEVD_LOAD_CANCELLED = "EMEVD_LOAD_CANCELLED";
/**
 * 读取期间源文件被改写，且重试次数已用尽。
 *
 * 与解析失败区分开：文件本身可能完全合法，只是有别的进程正在写它。
 */
export declare const EMEVD_SOURCE_CHANGED_DURING_READ = "EMEVD_SOURCE_CHANGED_DURING_READ";
/**
 * 某一次尝试因跨页指纹漂移被整份丢弃，正在重读。
 *
 * 这条诊断会跟着最终结果一起返回（成功时也带），它是「跨页校验真的执行过并拦下了
 * 一次漂移」在函数外部**唯一**的确定性观测口 —— 只看返回值分不出「文件没被改过」
 * 和「改过但校验没生效」：两者都是 `ok: true` 加一个自洽的哈希。
 */
export declare const EMEVD_SOURCE_CHANGED_RETRY = "EMEVD_SOURCE_CHANGED_RETRY";
/**
 * 读一份完整 EMEVD 文档（可能跨多页），并保证**整份来自同一个文件版本**。
 *
 * ── 为什么需要整次重试 ──
 *
 * 分页是多次独立的 Bridge 请求，页与页之间源文件可以被别的进程改写。改造前只有
 * 第一页的 `sourceHash` 被采用（作为返回值上报，也作为写回的提交前置条件），后续页
 * 从不比对：在一次 5000 指令的读取中途把文件 A 换成 B，最终会返回 `ok: true` + A 的
 * 哈希，而文档内容是 176 条 A + 4824 条 B。这份混合文档随后会被当成「A 的内容」参与
 * 写回校验 —— 提交前置条件看的是哈希，而哈希是对的。
 *
 * 这里改成每页都比对指纹（payload 的 `sourceHash` 与外层容器的 `outerFileHash`
 * 二者都比），任一页不一致就丢弃**整次**读取结果重来，而不是补读那一页 —— 已装配的
 * 页里同样可能混着旧版本。
 *
 * `cachePolicy: 'bypass'` 下每页都真的重读磁盘，这个窗口最宽；`default` 下缓存以内容
 * SHA-256 为键，文件改了就是另一条身份，同样会跨页混版本。两种策略都需要这道校验。
 */
export declare function readFullEmevdDocumentViaBridge(input: ReadFullEmevdDocumentInput): Promise<ReadFullEmevdDocumentResult>;
/** Total instruction count a page set must cover for the given events table. */
export declare function expectedInstructionTotal(events: EmevdEventIr[]): number;
/**
 * 绝对路径脱敏（EVENT-30A）：resourceUri 本应资源相对（如
 * `file://event/common.emevd`）。若调用方误传了本地绝对路径（`D:\...`、
 * `file:///D:/...`、UNC），收敛成无盘符的资源相对 `file://` 形式，避免把本地
 * 文件系统路径泄漏进 DSL 投影与 outline。已经是资源相对的 URI 原样返回。
 *
 * 旧实现按顺序剥 `file:///` 与前两个字符的盘符，`file:///D:/x/event/a.emevd`
 * 被写成 `file://x/event/a.emevd`：盘符消失后 `x` 变成了「主机名」，既是坏 URI
 * 也把绝对路径整段留在里面。现在先按真实路径取相对段（给了 workspaceRoot 时
 * 相对工作区），否则从已知资源域（event/param/map/…）截断，最后只剩文件名。
 */
export declare function sanitizeResourceUri(uri: string, workspaceRoot?: string): string;
export interface BuildEmevdDocumentOutlineOptions {
    /** Cap on outline rows; larger documents truncate with `truncated: true`. */
    limit?: number;
}
/**
 * Build the bounded event outline for the source IDE (EVENT-30A). Summary rows
 * only — event identity + counts, never instruction bodies/args/strings — so a
 * real corpus stays well inside IPC budgets. `truncated` is set when the event
 * count exceeds `limit`.
 */
export declare function buildEmevdDocumentOutline(document: EmevdEditorDocument, options?: BuildEmevdDocumentOutlineOptions): EmevdDocumentOutline;
