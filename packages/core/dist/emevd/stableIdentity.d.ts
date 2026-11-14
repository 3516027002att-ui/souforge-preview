import type { EmevdEditorDocument, EmevdEventIr, EmevdInstructionIr, EmevdNodeAnchor } from '@soulforge/shared';
export declare function computeEmevdInstructionFingerprint(instruction: EmevdInstructionIr): string;
export declare function computeEmevdEventFingerprint(event: EmevdEventIr): string;
export declare function formatEmevdAnchor(kind: 'event' | 'instruction', anchor: EmevdNodeAnchor): string;
export interface AttachEmevdStableIdentityOptions {
    documentInstanceId?: string;
    signal?: AbortSignal;
    eventsPerYield?: number;
}
export declare function attachEmevdStableIdentityAsync(document: EmevdEditorDocument, options?: AttachEmevdStableIdentityOptions): Promise<EmevdEditorDocument>;
export declare function attachEmevdStableIdentity(document: EmevdEditorDocument, options?: AttachEmevdStableIdentityOptions): EmevdEditorDocument;
