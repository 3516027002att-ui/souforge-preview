import type { Diagnostic } from '@soulforge/shared';
export interface ExtractOutcome {
    parseStatus?: string;
    data?: {
        contentSize?: number;
    } | undefined;
    diagnostics?: Diagnostic[] | undefined;
}
export type ExtractVerdict = {
    kind: 'ok';
} | {
    kind: 'missing-child';
    codes: string[];
} | {
    kind: 'infrastructure-failure';
    parseStatus: string | undefined;
    diagnostics: Diagnostic[];
};
export declare function classifyChildExtract(extract: ExtractOutcome): ExtractVerdict;
/**
 * 把 infrastructure-failure 判决写成结构化失败输出并设置退出码。
 * 调用方负责随后释放 bridge 资源并 return。
 */
export declare function reportInfrastructureFailure(label: string, code: string, verdict: Extract<ExtractVerdict, {
    kind: 'infrastructure-failure';
}>): void;
