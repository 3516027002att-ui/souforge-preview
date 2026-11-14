/**
 * Map Bridge EMEVD envelope (renderer-safe subset) into EmevdEditorDocument.
 * Instruction sample is capped by Bridge; full bank is not required for four-view skeleton.
 */
import type { EmevdEditorDocument } from '@soulforge/shared';
export interface BridgeEmevdEnvelopeLike {
    sourceHash?: string;
    eventCount?: number;
    instructionCount?: number;
    events?: Array<{
        id: number;
        restBehavior?: number;
        instructionCount?: number;
        instructionStartIndex?: number;
        layer?: number;
        parameters?: Array<{
            instructionIndex: number;
            targetStartByte: number;
            sourceStartByte: number;
            byteCount: number;
            unkId: number;
        }>;
    }>;
    instructionsSample?: Array<{
        index: number;
        bank: number;
        id: number;
        argsBase64?: string;
        argsLength?: number;
    }>;
    authority?: string;
}
export declare function emevdEnvelopeToEditorDocument(resourceUri: string, envelope: BridgeEmevdEnvelopeLike, options?: {
    maxEvents?: number;
    bytesBase64?: string;
    documentInstanceId?: string;
}): EmevdEditorDocument;
