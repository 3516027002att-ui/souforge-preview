/**
 * EditorCatalog 语义目录契约（front-end.md §4.2 / §4.4）与
 * DocumentStore mutation IPC 闭合契约（§14.4，shared 可见部分）。
 *
 * 本文件是 shared 侧唯一权威：
 * - §4.2 的全部 closed union 与 fixed registry 形状；
 * - §14.4 中 renderer 可消费的 mutation/请求/响应 DTO；
 * - 所有 DTO 的 runtime decoder。decoder 拒绝绝对路径与 unknown extra
 *   fields；renderer 不得用 `as` 强转绕过 decoder。
 *
 * 命名说明：§14.4 的 `EditorMutation` 与 editor-protocol.ts 中 legacy
 * `EditorMutation`（patchIR 计划，仍被 core/editorDocumentStore.ts 引用，
 * 且该文件不在 SCHEMA-02 Allowed 内）重名，因此新契约整体放在本文件，
 * 名字与字段保持 §14.4 逐字不变。
 */
export type EditorDomainId = 'project' | 'param' | 'gparam' | 'text' | 'event' | 'map' | 'script' | 'behavior' | 'animation' | 'model' | 'texture' | 'material' | 'vfx' | 'container' | 'files';
export declare const EDITOR_DOMAIN_IDS: readonly ["project", "param", "gparam", "text", "event", "map", "script", "behavior", "animation", "model", "texture", "material", "vfx", "container", "files"];
export type ArtifactRole = 'primary' | 'base' | 'backup' | 'previous' | 'recovery' | 'projection' | 'cache' | 'audit' | 'temporary';
export type NativeFormatId = 'dcx-dflt' | 'dcx-krak' | 'bnd4' | 'param' | 'gparam' | 'fmg' | 'emevd' | 'msb' | 'lua-source' | 'lua-bytecode' | 'hks-bytecode' | 'esd' | 'tae' | 'flver' | 'tpf' | 'dds' | 'mtd' | 'matbin' | 'fxr' | 'unknown';
export type ContainerRole = 'none' | 'gameparam-binder' | 'drawparam-binder' | 'msg-binder' | 'script-binder' | 'behavior-binder' | 'animation-binder' | 'texture-binder' | 'vfx-binder' | 'generic-binder';
export interface FormatCandidate {
    readonly formatId: NativeFormatId;
    readonly source: 'content-probe' | 'compound-suffix' | 'path-hint';
    readonly ruleId: string;
}
export interface FormatLayer {
    readonly layerIndex: number;
    readonly formatId: Exclude<NativeFormatId, 'unknown'>;
    readonly confirmedBy: 'bridge';
    readonly childStableId: string | null;
}
export interface ConfirmedFormatStack {
    readonly stackId: string;
    readonly layers: readonly FormatLayer[];
    readonly leafFormatId: Exclude<NativeFormatId, 'unknown'>;
    readonly containerRole: ContainerRole;
}
interface PhysicalVariantCommon {
    readonly variantId: string;
    readonly precedence: number;
    readonly contentHash: string | null;
    readonly sourceRevision: string | null;
    readonly provenanceDigest: string | null;
}
export type PhysicalVariantRef = (PhysicalVariantCommon & {
    readonly role: 'primary' | 'base';
    readonly sourceLayer: 'overlay' | 'base';
    readonly recoveryOfResourceId: null;
}) | (PhysicalVariantCommon & {
    readonly role: 'backup' | 'previous' | 'recovery';
    readonly sourceLayer: 'history';
    readonly recoveryOfResourceId: string;
});
export type RecognitionState = {
    kind: 'candidate';
    evidence: readonly FormatCandidate[];
} | {
    kind: 'confirmed';
    stack: ConfirmedFormatStack;
} | {
    kind: 'conflict';
    confirmedStackIds: readonly string[];
} | {
    kind: 'unsupported';
    reasonCode: string;
};
export interface ProjectionRef {
    readonly projectionId: string;
    readonly projectionKind: 'source' | 'text' | 'json';
    readonly nativeResourceId: string;
    readonly nativeSourceRevision: string;
    readonly nativeSourceHash: string;
    readonly provenanceDigest: string;
}
export type ReadOperationId = 'catalog-open' | 'page-tables' | 'page-rows' | 'page-fields' | 'page-banks' | 'page-groups' | 'page-entries' | 'read-source' | 'read-outline' | 'read-preview' | 'read-metadata' | 'read-properties';
export type WriteOperationId = 'param-field-set' | 'param-row-upsert' | 'param-row-delete' | 'gparam-field-set' | 'fmg-entry-upsert' | 'fmg-entry-delete' | 'emevd-source-change' | 'bnd4-child-replace' | 'script-plaintext-change' | 'map-entity-upsert' | 'map-entity-delete' | 'flver-material-slot-set' | 'tpf-texture-replace' | 'material-property-set' | 'vfx-field-set' | 'behavior-transition-upsert' | 'tae-event-upsert';
export type CapabilityReasonCode = 'read-contract-missing' | 'write-contract-missing' | 'operation-not-allowed' | 'runtime-unavailable' | 'oodle-unavailable' | 'metadata-mismatch' | 'bridge-authority-insufficient' | 'writer-unverified' | 'outer-rebuild-unavailable' | 'native-reread-unavailable' | 'unknown-region-unverifiable' | 'sibling-verification-unavailable';
export type ReadCapabilityStage = 'D3' | 'D4' | 'D5' | 'D6';
export type WriteCapabilityStage = 'D7' | 'D8' | 'D9' | 'D10';
export type ReadCapability = {
    kind: 'ready';
    operationIds: readonly ReadOperationId[];
    verifiedStages: readonly ['D3', 'D4', 'D5', 'D6'];
    resolverSnapshotId: string;
} | {
    kind: 'blocked';
    reasonCode: CapabilityReasonCode;
    missing: readonly ReadCapabilityStage[];
} | {
    kind: 'unavailable';
    reasonCode: CapabilityReasonCode;
};
export type WriteCapability = {
    kind: 'ready';
    operationIds: readonly WriteOperationId[];
    verifiedStages: readonly ['D7', 'D8', 'D9', 'D10'];
    resolverSnapshotId: string;
} | {
    kind: 'blocked';
    reasonCode: CapabilityReasonCode;
    missingStages: readonly WriteCapabilityStage[];
} | {
    kind: 'unavailable';
    reasonCode: CapabilityReasonCode;
};
export interface OperationCapability {
    readonly read: ReadCapability;
    readonly write: WriteCapability;
}
export type CatalogDecision = {
    kind: 'catalog';
    domain: EditorDomainId;
    integrationId: string;
} | {
    kind: 'history';
    recoveryOfResourceId: string | null;
} | {
    kind: 'projection';
    requireMatchingProvenance: true;
} | {
    kind: 'hidden';
    reason: 'cache' | 'audit' | 'temporary';
} | {
    kind: 'files';
    reasonCode: string;
};
export interface LogicalDocumentRef {
    readonly resourceId: string;
    readonly domain: EditorDomainId;
    readonly libraryId: string;
    readonly bankId: string | null;
    readonly documentId: string;
    readonly sourceVariant: 'overlay' | 'base';
}
export interface CatalogLibrary {
    readonly libraryId: string;
    readonly domain: EditorDomainId;
    readonly label: string;
    readonly bankIds: readonly string[];
    readonly documentIds: readonly string[];
    readonly counts: Readonly<Partial<Record<'libraries' | 'banks' | 'tables' | 'rows' | 'entries' | 'events' | 'files', number>>>;
}
export interface CatalogBank {
    readonly bankId: string;
    readonly libraryId: string;
    readonly label: string;
    readonly semanticKey: string;
    readonly languageId: string | null;
    readonly containerKind: 'item' | 'menu' | null;
    readonly documentIds: readonly string[];
}
export interface CatalogDocument {
    readonly ref: LogicalDocumentRef;
    readonly label: string;
    readonly recognition: RecognitionState;
    readonly capability: OperationCapability;
    readonly effectiveVariant: PhysicalVariantRef;
    readonly alternateVariantIds: readonly string[];
}
export interface EditorCatalogSnapshot {
    readonly catalogRevision: string;
    readonly libraries: readonly CatalogLibrary[];
    readonly banks: readonly CatalogBank[];
    readonly documents: readonly CatalogDocument[];
    readonly history: readonly PhysicalVariantRef[];
    readonly projections: readonly ProjectionRef[];
}
export interface CatalogDocumentSummary {
    readonly ref: LogicalDocumentRef;
    readonly label: string;
    readonly recognition: RecognitionState;
    readonly capability: OperationCapability;
    readonly effectiveVariantId: string;
}
export interface EditorCatalogSummary {
    readonly catalogRevision: string;
    readonly domains: readonly DomainSummary[];
    readonly libraries: readonly CatalogLibrary[];
    readonly banks: readonly CatalogBank[];
    readonly documents: readonly CatalogDocumentSummary[];
    readonly historyCount: number;
}
export interface DomainSummary {
    readonly domain: EditorDomainId;
    readonly label: string;
    readonly visibility: 'visible' | 'hidden' | 'disabled';
    readonly capability: 'read-ready' | 'runtime-blocked' | 'deferred';
    readonly defaultTarget: LogicalDocumentRef | null;
}
export type ArtifactRoleMatcher = {
    kind: 'registered-recovery';
} | {
    kind: 'case-insensitive-suffix';
    suffix: '.bak' | '.prev';
} | {
    kind: 'verified-projection-manifest';
} | {
    kind: 'main-storage-class';
    storageClass: 'cache' | 'audit' | 'temporary';
} | {
    kind: 'source-root';
    sourceLayer: 'overlay' | 'base';
};
export interface ArtifactRoleRule {
    readonly ruleId: string;
    readonly matcher: ArtifactRoleMatcher;
    readonly role: ArtifactRole;
}
export declare const ARTIFACT_ROLE_RULES: readonly [{
    readonly ruleId: "registered-recovery";
    readonly matcher: {
        readonly kind: "registered-recovery";
    };
    readonly role: "recovery";
}, {
    readonly ruleId: "backup-suffix";
    readonly matcher: {
        readonly kind: "case-insensitive-suffix";
        readonly suffix: ".bak";
    };
    readonly role: "backup";
}, {
    readonly ruleId: "previous-suffix";
    readonly matcher: {
        readonly kind: "case-insensitive-suffix";
        readonly suffix: ".prev";
    };
    readonly role: "previous";
}, {
    readonly ruleId: "verified-projection";
    readonly matcher: {
        readonly kind: "verified-projection-manifest";
    };
    readonly role: "projection";
}, {
    readonly ruleId: "main-cache";
    readonly matcher: {
        readonly kind: "main-storage-class";
        readonly storageClass: "cache";
    };
    readonly role: "cache";
}, {
    readonly ruleId: "main-audit";
    readonly matcher: {
        readonly kind: "main-storage-class";
        readonly storageClass: "audit";
    };
    readonly role: "audit";
}, {
    readonly ruleId: "main-temporary";
    readonly matcher: {
        readonly kind: "main-storage-class";
        readonly storageClass: "temporary";
    };
    readonly role: "temporary";
}, {
    readonly ruleId: "overlay-source";
    readonly matcher: {
        readonly kind: "source-root";
        readonly sourceLayer: "overlay";
    };
    readonly role: "primary";
}, {
    readonly ruleId: "base-source";
    readonly matcher: {
        readonly kind: "source-root";
        readonly sourceLayer: "base";
    };
    readonly role: "base";
}];
export type RuleMatcher = {
    kind: 'artifact-role';
    roles: readonly ArtifactRole[];
} | {
    kind: 'confirmed-leaf';
    formatId: NativeFormatId;
    containerRole?: ContainerRole;
    semanticSubtype?: string;
} | {
    kind: 'confirmed-child';
    formatId: NativeFormatId;
    parentRole: ContainerRole;
    semanticSubtype?: string;
} | {
    kind: 'content-probe';
} | {
    kind: 'compound-suffix';
    suffix: string;
} | {
    kind: 'path-hint';
    firstSegment: string;
} | {
    kind: 'always';
};
export interface ResourceClassificationRule {
    readonly ruleId: string;
    readonly priority: 1000 | 900 | 800 | 700 | 600 | 300 | 0;
    readonly matcher: RuleMatcher;
    readonly decision: {
        kind: 'catalog';
        domain: EditorDomainId;
        integrationId: string;
        libraryKey: string;
    } | {
        kind: 'history';
    } | {
        kind: 'projection';
        requireMatchingProvenance: true;
    } | {
        kind: 'hidden';
    } | {
        kind: 'files';
        reasonCode: string;
    };
}
export declare const RESOURCE_CLASSIFICATION_RULES: readonly [{
    readonly ruleId: "artifact-backup-history";
    readonly priority: 1000;
    readonly matcher: {
        readonly kind: "artifact-role";
        readonly roles: readonly ["backup", "previous", "recovery"];
    };
    readonly decision: {
        readonly kind: "history";
    };
}, {
    readonly ruleId: "artifact-generated-projection";
    readonly priority: 1000;
    readonly matcher: {
        readonly kind: "artifact-role";
        readonly roles: readonly ["projection"];
    };
    readonly decision: {
        readonly kind: "projection";
        readonly requireMatchingProvenance: true;
    };
}, {
    readonly ruleId: "artifact-internal-hidden";
    readonly priority: 1000;
    readonly matcher: {
        readonly kind: "artifact-role";
        readonly roles: readonly ["cache", "audit", "temporary"];
    };
    readonly decision: {
        readonly kind: "hidden";
    };
}, {
    readonly ruleId: "gameparam-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "gameparam-binder";
        readonly semanticSubtype: "gameparam-primary";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "param";
        readonly integrationId: "param-editor";
        readonly libraryKey: "game-parameters";
    };
}, {
    readonly ruleId: "drawparam-binder-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "drawparam-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "container";
        readonly integrationId: "container-editor";
        readonly libraryKey: "drawparam-containers";
    };
}, {
    readonly ruleId: "gparam-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "gparam";
        readonly semanticSubtype: "map-bank";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "gparam";
        readonly integrationId: "gparam-editor";
        readonly libraryKey: "draw-graphics-parameters";
    };
}, {
    readonly ruleId: "loose-param-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "param";
        readonly semanticSubtype: "loose-table";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "param";
        readonly integrationId: "param-editor";
        readonly libraryKey: "loose-parameters";
    };
}, {
    readonly ruleId: "loose-fmg-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "fmg";
        readonly semanticSubtype: "loose-table";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "text";
        readonly integrationId: "text-editor";
        readonly libraryKey: "loose-text";
    };
}, {
    readonly ruleId: "msgbnd-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "msg-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "text";
        readonly integrationId: "text-editor";
        readonly libraryKey: "game-text";
    };
}, {
    readonly ruleId: "emevd-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "emevd";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "event";
        readonly integrationId: "event-editor";
        readonly libraryKey: "events";
    };
}, {
    readonly ruleId: "msb-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "msb";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "map";
        readonly integrationId: "map-editor";
        readonly libraryKey: "maps";
    };
}, {
    readonly ruleId: "script-binder-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "script-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "script";
        readonly integrationId: "script-editor";
        readonly libraryKey: "scripts";
    };
}, {
    readonly ruleId: "lua-source-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "lua-source";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "script";
        readonly integrationId: "script-editor";
        readonly libraryKey: "loose-scripts";
    };
}, {
    readonly ruleId: "lua-bytecode-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "lua-bytecode";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "script";
        readonly integrationId: "script-editor";
        readonly libraryKey: "loose-scripts";
    };
}, {
    readonly ruleId: "hks-bytecode-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "hks-bytecode";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "script";
        readonly integrationId: "script-editor";
        readonly libraryKey: "loose-scripts";
    };
}, {
    readonly ruleId: "behavior-binder-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "behavior-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "behavior";
        readonly integrationId: "behavior-editor";
        readonly libraryKey: "behaviors";
    };
}, {
    readonly ruleId: "animation-binder-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "animation-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "animation";
        readonly integrationId: "animation-editor";
        readonly libraryKey: "animations";
    };
}, {
    readonly ruleId: "texture-binder-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "texture-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "texture";
        readonly integrationId: "texture-editor";
        readonly libraryKey: "textures";
    };
}, {
    readonly ruleId: "vfx-binder-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "vfx-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "vfx";
        readonly integrationId: "vfx-editor";
        readonly libraryKey: "effects";
    };
}, {
    readonly ruleId: "loose-esd-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "esd";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "behavior";
        readonly integrationId: "behavior-editor";
        readonly libraryKey: "loose-behaviors";
    };
}, {
    readonly ruleId: "loose-tae-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "tae";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "animation";
        readonly integrationId: "animation-editor";
        readonly libraryKey: "loose-animations";
    };
}, {
    readonly ruleId: "flver-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "flver";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "model";
        readonly integrationId: "model-editor";
        readonly libraryKey: "models";
    };
}, {
    readonly ruleId: "tpf-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "tpf";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "texture";
        readonly integrationId: "texture-editor";
        readonly libraryKey: "textures";
    };
}, {
    readonly ruleId: "dds-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "dds";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "texture";
        readonly integrationId: "texture-editor";
        readonly libraryKey: "textures";
    };
}, {
    readonly ruleId: "mtd-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "mtd";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "material";
        readonly integrationId: "material-editor";
        readonly libraryKey: "materials";
    };
}, {
    readonly ruleId: "matbin-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "matbin";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "material";
        readonly integrationId: "material-editor";
        readonly libraryKey: "materials";
    };
}, {
    readonly ruleId: "fxr-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "fxr";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "vfx";
        readonly integrationId: "vfx-editor";
        readonly libraryKey: "effects";
    };
}, {
    readonly ruleId: "generic-bnd4-confirmed";
    readonly priority: 900;
    readonly matcher: {
        readonly kind: "confirmed-leaf";
        readonly formatId: "bnd4";
        readonly containerRole: "generic-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "container";
        readonly integrationId: "container-editor";
        readonly libraryKey: "containers";
    };
}, {
    readonly ruleId: "drawparam-param-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "param";
        readonly parentRole: "drawparam-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "param";
        readonly integrationId: "param-editor";
        readonly libraryKey: "drawparam-tables";
    };
}, {
    readonly ruleId: "drawparam-gparam-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "gparam";
        readonly parentRole: "drawparam-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "gparam";
        readonly integrationId: "gparam-editor";
        readonly libraryKey: "draw-graphics-parameters";
    };
}, {
    readonly ruleId: "fmg-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "fmg";
        readonly parentRole: "msg-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "text";
        readonly integrationId: "text-editor";
        readonly libraryKey: "game-text";
    };
}, {
    readonly ruleId: "lua-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "lua-source";
        readonly parentRole: "script-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "script";
        readonly integrationId: "script-editor";
        readonly libraryKey: "scripts";
    };
}, {
    readonly ruleId: "lua-bytecode-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "lua-bytecode";
        readonly parentRole: "script-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "script";
        readonly integrationId: "script-editor";
        readonly libraryKey: "scripts";
    };
}, {
    readonly ruleId: "hks-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "hks-bytecode";
        readonly parentRole: "script-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "script";
        readonly integrationId: "script-editor";
        readonly libraryKey: "scripts";
    };
}, {
    readonly ruleId: "esd-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "esd";
        readonly parentRole: "behavior-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "behavior";
        readonly integrationId: "behavior-editor";
        readonly libraryKey: "behaviors";
    };
}, {
    readonly ruleId: "tae-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "tae";
        readonly parentRole: "animation-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "animation";
        readonly integrationId: "animation-editor";
        readonly libraryKey: "animations";
    };
}, {
    readonly ruleId: "tpf-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "tpf";
        readonly parentRole: "texture-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "texture";
        readonly integrationId: "texture-editor";
        readonly libraryKey: "textures";
    };
}, {
    readonly ruleId: "fxr-child";
    readonly priority: 800;
    readonly matcher: {
        readonly kind: "confirmed-child";
        readonly formatId: "fxr";
        readonly parentRole: "vfx-binder";
    };
    readonly decision: {
        readonly kind: "catalog";
        readonly domain: "vfx";
        readonly integrationId: "vfx-editor";
        readonly libraryKey: "effects";
    };
}, {
    readonly ruleId: "bounded-content-probe";
    readonly priority: 700;
    readonly matcher: {
        readonly kind: "content-probe";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "parambnd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".parambnd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "drawparambnd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".drawparambnd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "msgbnd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".msgbnd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "gparam-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".gparam.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "emevd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".emevd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "luabnd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".luabnd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "talkesdbnd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".talkesdbnd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "anibnd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".anibnd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "msb-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".msb.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "flver-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".flver.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "tpf-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".tpf.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "ffxbnd-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".ffxbnd.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "fxr-dcx-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".fxr.dcx";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "param-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".param";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "gparam-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".gparam";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "fmg-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".fmg";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "lua-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".lua";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "hks-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".hks";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "esd-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".esd";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "tae-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".tae";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "flver-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".flver";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "tpf-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".tpf";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "dds-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".dds";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "mtd-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".mtd";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "matbin-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".matbin";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "fxr-suffix-candidate";
    readonly priority: 600;
    readonly matcher: {
        readonly kind: "compound-suffix";
        readonly suffix: ".fxr";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "bridge-confirmation-required";
    };
}, {
    readonly ruleId: "physical-path-hint";
    readonly priority: 300;
    readonly matcher: {
        readonly kind: "path-hint";
        readonly firstSegment: "*";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "path-hint-only";
    };
}, {
    readonly ruleId: "files-fallback";
    readonly priority: 0;
    readonly matcher: {
        readonly kind: "always";
    };
    readonly decision: {
        readonly kind: "files";
        readonly reasonCode: "unrecognized-format";
    };
}];
export interface ConfirmedLeafResolution {
    readonly domain: EditorDomainId;
    readonly integrationId: string;
    readonly libraryKey: string;
}
export declare function resolveIntegrationForConfirmedLeaf(leafFormatId: Exclude<NativeFormatId, 'unknown'>, containerRole: ContainerRole, semanticSubtype: string | null): ConfirmedLeafResolution | null;
export interface EditorIntegration {
    readonly integrationId: string;
    readonly domain: EditorDomainId;
    readonly editorId: string;
    readonly visibleWhen: 'always' | 'read-ready';
}
export declare const EDITOR_INTEGRATIONS: readonly [{
    readonly integrationId: "project-editor";
    readonly domain: "project";
    readonly editorId: "project";
    readonly visibleWhen: "always";
}, {
    readonly integrationId: "param-editor";
    readonly domain: "param";
    readonly editorId: "param";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "gparam-editor";
    readonly domain: "gparam";
    readonly editorId: "gparam";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "text-editor";
    readonly domain: "text";
    readonly editorId: "fmg";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "event-editor";
    readonly domain: "event";
    readonly editorId: "emevd-source";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "map-editor";
    readonly domain: "map";
    readonly editorId: "msb";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "script-editor";
    readonly domain: "script";
    readonly editorId: "script";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "behavior-editor";
    readonly domain: "behavior";
    readonly editorId: "esd";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "animation-editor";
    readonly domain: "animation";
    readonly editorId: "tae";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "model-editor";
    readonly domain: "model";
    readonly editorId: "flver";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "texture-editor";
    readonly domain: "texture";
    readonly editorId: "tpf";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "material-editor";
    readonly domain: "material";
    readonly editorId: "material";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "vfx-editor";
    readonly domain: "vfx";
    readonly editorId: "vfx";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "container-editor";
    readonly domain: "container";
    readonly editorId: "bnd4";
    readonly visibleWhen: "read-ready";
}, {
    readonly integrationId: "files-editor";
    readonly domain: "files";
    readonly editorId: "files";
    readonly visibleWhen: "always";
}];
export type DocumentLoadPhase = 'catalog-resolve' | 'locator-resolve' | 'bridge-open' | 'native-parse' | 'document-store' | 'first-page';
export type DocumentLoadReasonCode = 'document-not-found' | 'history-only' | 'bridge-runtime-unavailable' | 'compression-runtime-unavailable' | 'native-format-unconfirmed' | 'native-parse-failed' | 'partial-native-document' | 'capability-blocked' | 'request-cancelled' | 'request-expired' | 'unknown-format';
export type DocumentLoadState = {
    kind: 'idle';
} | {
    kind: 'loading';
    phase: DocumentLoadPhase;
} | {
    kind: 'ready';
} | {
    kind: 'empty';
    reason: 'true-empty';
} | {
    kind: 'no-match';
    query: string;
} | {
    kind: 'partial';
    reasonCode: DocumentLoadReasonCode;
} | {
    kind: 'blocked';
    reasonCode: DocumentLoadReasonCode;
    retryable: boolean;
} | {
    kind: 'unsupported';
    reasonCode: DocumentLoadReasonCode;
} | {
    kind: 'error';
    reasonCode: DocumentLoadReasonCode;
    retryable: boolean;
};
export type EditTransactionState = {
    kind: 'clean';
} | {
    kind: 'dirty';
    revision: string;
} | {
    kind: 'staging';
    operationId: string;
} | {
    kind: 'staged';
    operationId: string;
} | {
    kind: 'awaiting-approval';
    operationId: string;
} | {
    kind: 'committing';
    operationId: string;
} | {
    kind: 'verifying';
    operationId: string;
    phase: string;
} | {
    kind: 'committed';
    operationId: string;
    committedRevision: string;
} | {
    kind: 'rolling-back';
    operationId: string;
} | {
    kind: 'rolled-back';
    operationId: string;
    restoredRevision: string;
} | {
    kind: 'rollback-failed';
    operationId: string;
    reasonCode: string;
} | {
    kind: 'failed';
    operationId: string;
    phase: string;
    reasonCode: string;
};
export type EditorScalar = null | boolean | number | string | readonly number[];
export interface TypedFieldChange {
    readonly fieldId: string;
    readonly value: EditorScalar;
}
export type EditorMutation = {
    kind: 'param-field-set';
    tableId: string;
    rowId: string;
    fieldId: string;
    value: EditorScalar;
} | {
    kind: 'param-row-upsert';
    tableId: string;
    rowId: string;
    fields: readonly TypedFieldChange[];
} | {
    kind: 'param-row-delete';
    tableId: string;
    rowId: string;
} | {
    kind: 'gparam-field-set';
    bankId: string;
    groupId: string;
    fieldId: string;
    value: EditorScalar;
} | {
    kind: 'fmg-entry-upsert';
    tableId: string;
    entryId: string;
    text: string;
} | {
    kind: 'fmg-entry-delete';
    tableId: string;
    entryId: string;
} | {
    kind: 'emevd-source-change';
    sourceText: string;
} | {
    kind: 'bnd4-child-replace';
    childStableId: string;
    stagedPayloadToken: string;
} | {
    kind: 'script-plaintext-change';
    childStableId: string;
    text: string;
    encoding: string;
    newline: 'crlf' | 'lf' | 'preserve';
} | {
    kind: 'map-entity-upsert';
    entityStableId: string;
    fields: readonly TypedFieldChange[];
} | {
    kind: 'map-entity-delete';
    entityStableId: string;
} | {
    kind: 'flver-material-slot-set';
    meshStableId: string;
    slotIndex: number;
    materialStableId: string;
} | {
    kind: 'tpf-texture-replace';
    textureStableId: string;
    attachmentToken: string;
} | {
    kind: 'material-property-set';
    propertyId: string;
    value: EditorScalar;
} | {
    kind: 'vfx-field-set';
    nodeStableId: string;
    fieldId: string;
    value: EditorScalar;
} | {
    kind: 'behavior-transition-upsert';
    stateStableId: string;
    transitionStableId: string;
    fields: readonly TypedFieldChange[];
} | {
    kind: 'tae-event-upsert';
    animationStableId: string;
    eventStableId: string;
    fields: readonly TypedFieldChange[];
};
export interface OpenEditorDocumentRequest {
    readonly document: LogicalDocumentRef;
}
export type EditorPageQuery = {
    kind: 'param-tables';
    search: string;
} | {
    kind: 'param-rows';
    tableId: string;
    search: string;
} | {
    kind: 'param-fields';
    tableId: string;
    rowId: string;
} | {
    kind: 'gparam-groups';
    bankId: string;
    search: string;
} | {
    kind: 'gparam-fields';
    bankId: string;
    groupId: string;
} | {
    kind: 'fmg-entries';
    tableId: string;
    search: string;
} | {
    kind: 'event-outline';
    search: string;
} | {
    kind: 'container-entries';
    parentStableId: string | null;
    search: string;
} | {
    kind: 'script-symbols';
    search: string;
} | {
    kind: 'resource-tree';
    parentStableId: string | null;
    search: string;
} | {
    kind: 'properties';
    targetStableId: string;
    groupId: string | null;
};
export interface PageEditorDocumentRequest {
    readonly documentHandle: string;
    readonly expectedRevision: string;
    readonly query: EditorPageQuery;
    readonly cursor: string | null;
    readonly limit: number;
}
export type EditorContentQuery = {
    kind: 'fmg-content';
    tableId: string;
    entryId: string;
} | {
    kind: 'event-source';
} | {
    kind: 'script-source';
    childStableId: string;
} | {
    kind: 'resource-preview';
    targetStableId: string;
};
export interface ReadEditorContentRequest {
    readonly documentHandle: string;
    readonly expectedRevision: string;
    readonly query: EditorContentQuery;
}
export interface ApplyEditorMutationRequest {
    readonly documentHandle: string;
    readonly expectedRevision: string;
    readonly mutation: EditorMutation;
}
export type EditorDocumentErrorCode = 'invalid-request' | 'not-found' | 'owner-mismatch' | 'stale-revision' | 'capability-blocked' | 'runtime-blocked' | 'native-open-failed' | 'mutation-rejected' | 'cancelled' | 'expired';
export interface OpenEditorDocumentValue {
    readonly documentHandle: string;
    readonly revision: string;
    readonly loadState: DocumentLoadState;
    readonly readOperations: readonly ReadOperationId[];
    readonly writeOperations: readonly WriteOperationId[];
}
export type EditorPageItemDto = {
    kind: 'param-table';
    tableId: string;
    name: string;
    localizedName: string | null;
} | {
    kind: 'param-row';
    tableId: string;
    rowId: string;
    name: string | null;
    change: 'none' | 'added' | 'modified' | 'deleted';
} | {
    kind: 'param-field';
    tableId: string;
    rowId: string;
    fieldId: string;
    name: string;
    value: EditorScalar;
    compareValue: EditorScalar;
    enumLabel: string | null;
    valueType: string;
    description: string | null;
    editable: boolean;
} | {
    kind: 'gparam-group';
    bankId: string;
    groupId: string;
    name: string;
} | {
    kind: 'gparam-field';
    bankId: string;
    groupId: string;
    fieldId: string;
    name: string;
    value: EditorScalar;
    compareValue: EditorScalar;
    editable: boolean;
} | {
    kind: 'fmg-entry';
    tableId: string;
    entryId: string;
    preview: string;
    change: 'none' | 'added' | 'modified' | 'deleted';
} | {
    kind: 'event-outline';
    eventId: string;
    displayName: string;
    startLine: number;
    endLine: number;
} | {
    kind: 'container-entry';
    stableId: string;
    name: string;
    formatId: NativeFormatId;
    byteLength: number;
    childCount: number;
} | {
    kind: 'script-symbol';
    symbolId: string;
    name: string;
    symbolKind: 'function' | 'variable' | 'label';
    line: number;
} | {
    kind: 'resource-node';
    stableId: string;
    parentStableId: string | null;
    label: string;
    nodeKind: string;
    hasChildren: boolean;
} | {
    kind: 'property';
    targetStableId: string;
    groupId: string | null;
    propertyId: string;
    label: string;
    value: EditorScalar;
    compareValue: EditorScalar;
    editable: boolean;
};
export interface EditorDocumentPageValue {
    readonly documentHandle: string;
    readonly revision: string;
    readonly queryKind: EditorPageQuery['kind'];
    readonly items: readonly EditorPageItemDto[];
    readonly nextCursor: string | null;
    readonly totalKnown: number | null;
}
export type EditorContentValue = {
    kind: 'fmg-content';
    tableId: string;
    entryId: string;
    text: string;
} | {
    kind: 'event-source';
    sourceText: string;
    sourceDigest: string;
} | {
    kind: 'script-source';
    childStableId: string;
    text: string;
    editable: boolean;
    encoding: string;
    newline: 'crlf' | 'lf' | 'mixed';
} | {
    kind: 'resource-preview';
    targetStableId: string;
    previewToken: string;
    mediaType: string;
    byteLength: number;
};
export interface ApplyEditorMutationValue {
    readonly documentHandle: string;
    readonly revision: string;
    readonly transactionState: EditTransactionState;
}
export type EditorDocumentResult<T> = {
    ok: true;
    value: T;
} | {
    ok: false;
    code: EditorDocumentErrorCode;
    retryable: boolean;
};
export declare class EditorCatalogDecodeError extends Error {
    readonly path: string;
    constructor(path: string, message: string);
}
export declare function isAbsolutePathLike(value: string): boolean;
export declare function fail(path: string, message: string): never;
export declare function expectRecord(value: unknown, path: string): Record<string, unknown>;
export declare function expectString(value: unknown, path: string): string;
export declare function expectNumber(value: unknown, path: string): number;
export declare function expectBoolean(value: unknown, path: string): boolean;
export declare function expectStringOrNull(value: unknown, path: string): string | null;
export declare function expectNumberOrNull(value: unknown, path: string): number | null;
export declare function rejectUnknownFields(record: Record<string, unknown>, allowed: readonly string[], path: string): void;
export declare function rejectAbsolutePath(value: string, path: string): void;
export declare function expectEnum<T extends string>(value: unknown, allowed: readonly T[], path: string): T;
export declare function expectStringArray(value: unknown, path: string): readonly string[];
export declare function expectNullableString(value: unknown, path: string): string | null;
export declare function expectNullableRecord(value: unknown, path: string): Record<string, unknown> | null;
export declare function expectArray(value: unknown, path: string): unknown[];
/** 校验稳定标识符字段：非空字符串且不含绝对路径/`..` 逃逸。 */
export declare function expectStableId(value: unknown, path: string): string;
/** 从 DTO record 取值；缺字段即失败。 */
export declare function valueOf(record: Record<string, unknown>, key: string, path: string): unknown;
export declare function decodeEditorDomainId(value: unknown, path?: string): EditorDomainId;
export declare function decodeArtifactRole(value: unknown, path?: string): ArtifactRole;
export declare function decodeNativeFormatId(value: unknown, path?: string): NativeFormatId;
export declare function decodeContainerRole(value: unknown, path?: string): ContainerRole;
export declare function decodeFormatCandidate(value: unknown, path?: string): FormatCandidate;
export declare function decodeConfirmedFormatStack(value: unknown, path?: string): ConfirmedFormatStack;
export declare function decodeFormatLayer(value: unknown, path?: string): FormatLayer;
export declare function decodePhysicalVariantRef(value: unknown, path?: string): PhysicalVariantRef;
export declare function decodeRecognitionState(value: unknown, path?: string): RecognitionState;
export declare function decodeReadOperationId(value: unknown, path?: string): ReadOperationId;
export declare function decodeWriteOperationId(value: unknown, path?: string): WriteOperationId;
export declare function decodeCapabilityReasonCode(value: unknown, path?: string): CapabilityReasonCode;
export declare function decodeReadCapability(value: unknown, path?: string): ReadCapability;
export declare function decodeWriteCapability(value: unknown, path?: string): WriteCapability;
export declare function decodeOperationCapability(value: unknown, path?: string): OperationCapability;
export declare function decodeLogicalDocumentRef(value: unknown, path?: string): LogicalDocumentRef;
export declare function decodeCatalogLibrary(value: unknown, path?: string): CatalogLibrary;
export declare function decodeCatalogBank(value: unknown, path?: string): CatalogBank;
export declare function decodeCatalogDocument(value: unknown, path?: string): CatalogDocument;
export declare function decodeCatalogDocumentSummary(value: unknown, path?: string): CatalogDocumentSummary;
export declare function decodeDomainSummary(value: unknown, path?: string): DomainSummary;
export declare function decodeEditorCatalogSummary(value: unknown, path?: string): EditorCatalogSummary;
export declare function decodeEditorCatalogSnapshot(value: unknown, path?: string): EditorCatalogSnapshot;
export declare function decodeEditorScalar(value: unknown, path?: string): EditorScalar;
export declare function decodeTypedFieldChange(value: unknown, path?: string): TypedFieldChange;
export declare function decodeEditorMutation(value: unknown, path?: string): EditorMutation;
export declare function decodeOpenEditorDocumentRequest(value: unknown, path?: string): OpenEditorDocumentRequest;
export declare function decodeEditorPageQuery(value: unknown, path?: string): EditorPageQuery;
export declare function decodePageEditorDocumentRequest(value: unknown, path?: string): PageEditorDocumentRequest;
export declare function decodeEditorContentQuery(value: unknown, path?: string): EditorContentQuery;
export declare function decodeReadEditorContentRequest(value: unknown, path?: string): ReadEditorContentRequest;
export declare function decodeApplyEditorMutationRequest(value: unknown, path?: string): ApplyEditorMutationRequest;
export declare function decodeEditorDocumentErrorCode(value: unknown, path?: string): EditorDocumentErrorCode;
export declare function decodeDocumentLoadState(value: unknown, path?: string): DocumentLoadState;
export declare function decodeDocumentLoadReasonCode(value: unknown, path?: string): DocumentLoadReasonCode;
export declare function decodeEditTransactionState(value: unknown, path?: string): EditTransactionState;
export declare function decodeOpenEditorDocumentValue(value: unknown, path?: string): OpenEditorDocumentValue;
export declare function decodeEditorDocumentPageValue(value: unknown, path?: string): EditorDocumentPageValue;
export declare function decodeEditorPageItemDto(value: unknown, path: string, queryKind: EditorPageQuery['kind']): EditorPageItemDto;
export declare function decodeEditorContentValue(value: unknown, path?: string): EditorContentValue;
export declare function decodeApplyEditorMutationValue(value: unknown, path?: string): ApplyEditorMutationValue;
export declare function decodeEditorDocumentResult(value: unknown, path?: string): EditorDocumentResult<unknown>;
export {};
