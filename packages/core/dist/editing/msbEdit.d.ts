import type { Diagnostic } from '@soulforge/shared';
import type { NativeEditSession } from './nativeEditSession.js';
export interface MsbPartSnapshot {
    address: string;
    name: string;
    family: 'part';
    nativeOffset: number;
    typeId: number;
    mapId: string;
    posX: number;
    posY: number;
    posZ: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
    /** Enemy/DummyEnemy 的原生 NpcParam 行 ID（MSBS NPCParamID）；其它 part 不出现。 */
    npcParamRowId?: number;
}
export interface MsbPartTransformEdit {
    /** `m11_01_00_00#c1050_0000`。 */
    address: string;
    /** Native identity is mandatory for writes; address/name is diagnostic context only. */
    nativeOffset?: number;
    posX?: number;
    posY?: number;
    posZ?: number;
    rotX?: number;
    rotY?: number;
    rotZ?: number;
    scaleX?: number;
    scaleY?: number;
    scaleZ?: number;
}
export interface MsbEditFailure {
    code: string;
    message: string;
    details?: unknown;
}
export type MsbReadResult = {
    ok: true;
    filePath: string;
    mapId: string;
    sourceUri: string;
    sourceHash: string;
    parts: MsbPartSnapshot[];
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: MsbEditFailure;
    diagnostics: Diagnostic[];
};
export type MsbSetResult = {
    ok: true;
    filePath: string;
    before: MsbPartSnapshot[];
    after: MsbPartSnapshot[];
    mutations: number;
    diagnostics: Diagnostic[];
} | {
    ok: false;
    error: MsbEditFailure;
    diagnostics: Diagnostic[];
    before?: MsbPartSnapshot[];
};
export declare function readMsbParts(input: {
    edit: NativeEditSession;
    file: string;
    addresses?: string[];
}): Promise<MsbReadResult>;
export declare function setMsbPartTransform(input: {
    edit: NativeEditSession;
    file: string;
    edits: MsbPartTransformEdit[];
}): Promise<MsbSetResult>;
