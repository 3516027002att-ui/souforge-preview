/**
 * Deterministic Signature Help & Parameter Info Model for EMEVD DarkScript3.
 *
 * Consumes the cursor context and EMEDF catalog to produce structured signature assistance:
 * - Active argument index & active parameter doc/type/enum
 * - Formatted signature label
 * - Enum values for active parameter
 * - Vararg support
 */
import type { EmedfCompletionItem } from '../emedfCompletionCatalog.js';
import type { EmedfEnumDef } from '../emedfSchema.js';
import type { EventCursorContext } from './eventCursorContext.js';
export interface SignatureParameterHelp {
    name: string;
    type: string;
    enumName?: string;
    description?: string;
    default?: number;
    min?: number;
    max?: number;
    vararg?: boolean;
    enumMembers?: Array<{
        value: number;
        name: string;
        label?: string;
    }>;
}
export interface EventSignatureHelp {
    instructionName: string;
    bank?: number;
    id?: number;
    signatureLabel: string;
    parameters: SignatureParameterHelp[];
    activeParameterIndex: number;
    activeParameter: SignatureParameterHelp | null;
    docs?: string;
}
export declare function getSignatureHelp(context: EventCursorContext, items: readonly EmedfCompletionItem[], enums?: Record<string, EmedfEnumDef>): EventSignatureHelp | null;
