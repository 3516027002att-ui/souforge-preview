/**
 * DarkScript3 式源码 → 现有 typed mutation plan。
 *
 * 对齐规则：$Event 块按「反汇编形状」逐事件对齐；事件体内做 LCS 行对齐 —
 * 已对齐的行只写参数/id/rest 差异；多出来的行编码成 insert_instruction（EMEDF
 * 可编码的固定参数指令），删掉行生成 delete_instruction；新增/删除 $Event 块
 * 生成 insert_event / delete_event。写不了的行（新增 WaitFor 折叠块、vararg
 * 指令、EMEDF 里查不到的名字、改了未解码注释）标 warning「未解码」，并且该事件
 * 的结构性改动整体抑制（只保留已对齐行的参数写入），不锁整份文件、不假成功。
 */
import type { EmevdDslCompileRequest, EmevdDslCompileResult, EmevdEditorDocument } from '@soulforge/shared';
import { type EmedfRegistry } from './emedfSchema.js';
export declare function looksLikeDarkScript(source: string): boolean;
export declare function compileEmevdDarkScript(request: EmevdDslCompileRequest, document: EmevdEditorDocument, registry?: EmedfRegistry): EmevdDslCompileResult;
