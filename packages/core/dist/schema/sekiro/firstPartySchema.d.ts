import type { ParamMetadataPackage } from '@soulforge/shared';
import { type ParamMetadataPackageValidation } from '../../param/paramMetadata.js';
import { type EmedfRegistry } from '../../emevd/emedfSchema.js';
export interface FirstPartySchemaDiagnostic {
    severity: 'error';
    code: string;
    message: string;
}
export type FirstPartyParamMetadataLoadResult = {
    ok: true;
    package: ParamMetadataPackage;
    diagnostics: [];
} | {
    ok: false;
    package: null;
    diagnostics: FirstPartySchemaDiagnostic[];
};
export type FirstPartyEmedfLoadResult = {
    ok: true;
    registry: EmedfRegistry;
    diagnostics: [];
} | {
    ok: false;
    registry: null;
    diagnostics: FirstPartySchemaDiagnostic[];
};
/** Return the immutable bundled PARAM package after its self-check. */
export declare function loadFirstPartyParamMetadata(): FirstPartyParamMetadataLoadResult;
/** Return the immutable bundled EMEVD registry after its content self-check. */
export declare function loadFirstPartyEmedfRegistry(): FirstPartyEmedfLoadResult;
export declare function getFirstPartyParamMetadataPackage(): ParamMetadataPackage;
export declare function getFirstPartyEmedfRegistry(): EmedfRegistry;
/** Exported for production loaders that must turn an internal corruption into a DTO. */
export declare function validateFirstPartyParamMetadata(): ParamMetadataPackageValidation;
