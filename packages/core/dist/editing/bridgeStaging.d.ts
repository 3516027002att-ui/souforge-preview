export interface BridgeStagingDiagnostic {
    severity: 'error';
    code: string;
    message: string;
    details: {
        phase: 'prepare' | 'write' | 'read' | 'cleanup';
        errorName?: string;
        systemCode?: string;
    };
}
export type BridgeStagingResult<T> = {
    ok: true;
    result: T;
    bytes: Buffer;
    diagnostics: [];
} | {
    ok: false;
    result?: T;
    diagnostics: BridgeStagingDiagnostic[];
};
export declare function stageBridgeOutput<T extends {
    ok: boolean;
}>(input: {
    stagingRoot: string;
    prefix: string;
    fileName: string;
    allowedRoots: (stagingRoot: string) => string[];
    write: (context: {
        outputPath: string;
        allowedRoots: string[];
        writableRoots: string[];
    }) => Promise<T>;
}): Promise<BridgeStagingResult<T>>;
