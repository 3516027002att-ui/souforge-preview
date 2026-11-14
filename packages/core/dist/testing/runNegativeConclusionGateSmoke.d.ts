interface Violation {
    file: string;
    line: number;
    expression: string;
    reason: string;
}
interface AllowedSite {
    file: string;
    expression: string;
    source: 'sanctioned' | 'allowlist';
    reason: string;
}
/** 扫描一段源码；导出以便自测。返回违规点与放行点。 */
export declare function scanSource(file: string, text: string): {
    violations: Violation[];
    allowed: AllowedSite[];
};
interface ClaimViolation {
    file: string;
    line: number;
    field: string;
    expression: string;
    reason: string;
}
/** 扫描一段源码里的完整性声明；导出以便自测。 */
export declare function scanCompletenessClaims(file: string, text: string): ClaimViolation[];
export {};
