/** Retain only a possible credential prefix within one displayed stream channel. */
export interface CredentialDelta {
    type: 'text-delta' | 'thinking-delta';
    text: string;
}
export declare class CredentialStreamRedactor {
    private readonly credential;
    private readonly redact;
    private pending;
    private spans;
    constructor(credential: string, redact: (text: string) => string);
    get retainedCharacters(): number;
    private take;
    private append;
    push(delta: CredentialDelta): CredentialDelta[];
    flush(): CredentialDelta[];
}
