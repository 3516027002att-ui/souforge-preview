/**
 * 脚本 IDE 写回：打开时用哪套解码，保存必须用回那套。
 *
 * 明文：ascii / utf8 / utf8-bom / shift_jis（CP932）走 encodePlaintext。
 * 混合编码：只允许改纯 ASCII 行，非 ASCII 字节原样复制（O(B+E) 纯字节 line span 算法）。
 * Lua 字节码：受 ScriptLoaderProfile 守卫；当前 Sekiro HKS 的源码编译由
 * Bridge 完成，本通用字节级编码器不把文本冒充成 HKS 字节码。
 */
import { type StructuredDiagnostic } from '@soulforge/shared';
import { type PlaintextEncoding } from './plaintextScriptEntry.js';
import { type ScriptLoaderProfile } from './scriptLoaderProfile.js';
export type ScriptSourceWritebackKind = 'plaintext' | 'decompiled-as-utf8' | 'mixed-ascii';
export interface ScriptWritebackOptions {
    profile?: ScriptLoaderProfile;
    requireProfile?: boolean;
}
export type ScriptSourceWritebackResult = {
    ok: true;
    bytes: Uint8Array;
    encoding: PlaintextEncoding | 'utf8';
    writeKind: ScriptSourceWritebackKind;
} | {
    ok: false;
    code: string;
    message: string;
    diagnostics: StructuredDiagnostic[];
};
export declare function encodeScriptSourceForWriteback(originalBytes: Uint8Array, newText: string, options?: ScriptWritebackOptions): ScriptSourceWritebackResult;
