export interface FixedNativeFixture {
    role: string;
    relativePath: string;
    sha256: string;
    byteLength: number;
    expected: Record<string, unknown>;
}
export type FixedNativeFixtureResult = {
    status: 'available';
    path: string;
    version: string;
    fixture: FixedNativeFixture;
} | {
    status: 'unavailable';
    code: string;
    message: string;
    version?: string;
};
/** Correctness cases live in the existing versioned corpus manifest. Mutable
 * input bytes are hash-checked before being copied into the test-owned root. */
export declare function materializeFixedNativeFixture(role: string, ownedRoot: string, explicitPath?: string, options?: {
    manifestPath?: string;
    fixtureRoot?: string;
}): Promise<FixedNativeFixtureResult>;
export declare function fixedFixtureNumber(fixture: FixedNativeFixture, key: string): number;
/** Compare every kind/count with the pinned external oracle, not the reader's
 * own aggregate total. This remains a test verifier over native DTOs. */
export declare function assertFixedInstructionDistribution(fixture: FixedNativeFixture, observed: readonly {
    bank: number;
    id: number;
    count: number;
}[]): void;
/**
 * 查询 registry 是否登记了某个 testRole。
 *
 * 为什么需要它：`resolveNativeFixture` 对「角色未登记」抛 ROLE_MISSING 是正确的
 * ——静默回落会让 smoke 假装验证过。对当前环境没有登记样本的能力，
 * 「本机没有该样本」是合法状态，应当诚实跳过而不是硬失败。两者必须由调用方
 * 区分，因为只有调用方知道该能力在本版是否属于必须验证的范围。
 *
 * 注意本函数只回答「有没有登记」，不做哈希与越界校验——一旦登记了，
 * 样本损坏或越界仍必须由 resolveNativeFixture 失败关闭，不能降级成跳过。
 *
 * 「registry 配置了但读不出来」必须抛错，不能返回 false：那是环境损坏，
 * 若降级成「未登记」就会把本该失败关闭的场景静默跳过。
 */
export declare function nativeFixtureRoleRegistered(testRole: string): Promise<boolean>;
export declare function resolveNativeFixture(explicitPath: string | undefined, testRole: string, legacyRelativePath: string): Promise<string>;
/**
 * Oodle runtime root for native smokes: SOULFORGE_OODLE_RUNTIME_ROOT, else the game root. Game data never ships
 * with the repository, so a missing root is a configuration error rather than a reason to guess a local folder.
 */
export declare function nativeOodleRuntimeRoot(): string;
