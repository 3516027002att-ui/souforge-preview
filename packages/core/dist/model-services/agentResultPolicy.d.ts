export declare function canonicalizeToolFailureContent(result: {
    ok: boolean;
    content: string;
    code?: string;
}): string;
export declare function failureCodeFromContent(content: string): string | undefined;
