interface SmokeResult {
    ok: boolean;
    message: string;
    passed: number;
    total: number;
    realCorpus: {
        attempted: boolean;
        skippedReason?: string;
        checkedEntries: string[];
    };
    nonClaims: string[];
}
export declare function runPlaintextScriptEditSmoke(): Promise<SmokeResult>;
export {};
