/** Existing smoke finally blocks retain their cleanup; allocation gains restart ownership. */
export declare function createSmokeTemporaryDirectory(prefix: string): Promise<string>;
/** 临时工作区句柄。root 之外不承诺任何结构，由各 smoke 自行组织。 */
export interface SmokeWorkspace {
    /** 本次运行独占的临时目录绝对路径。 */
    root: string;
    /** 释放。幂等：重复调用、目录已删都不报错。 */
    dispose(): Promise<void>;
}
/**
 * 建一个独占临时工作区。
 *
 * `label` 只用于目录名前缀，便于在残留物里回溯来源；必须是文件名安全的短标识。
 */
export declare function createSmokeWorkspace(label: string): Promise<SmokeWorkspace>;
/**
 * 在独占临时工作区里跑一段逻辑，无论成功、抛错还是被拒绝都保证清理。
 *
 * 返回 body 的返回值，异常原样重抛——清理不得改变失败语义，否则会把真实失败
 * 变成「清理时的次生错误」，定位成本远高于泄漏。
 */
export declare function withSmokeWorkspace<T>(label: string, body: (workspace: SmokeWorkspace) => Promise<T>): Promise<T>;
