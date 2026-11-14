/**
 * Agent / CLI standalone HKS facade.
 *
 * A standalone `action/script/*.hks` is one compiled bytecode file, not a container child, so it has
 * its own write path: decompile with the first-party Bridge, compile the edited source back, and put
 * the bytes through Patch Engine like every other native write.
 *
 * Plaintext `.hks` sources are rejected here on purpose: the Bridge only compiles the Sekiro 1.6.x
 * dialect, and writing source text into a file the game loads as bytecode would corrupt it.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBridge } from '../bridge/runBridge.js';
import { applyNativeMutation } from './editorMutationService.js';
const fail = (code, message, diagnostics = [], details) => ({
    ok: false,
    error: { code, message, ...(details === undefined ? {} : { details }) },
    diagnostics
});
/** The Bridge reports source hashes as "sha256:<hex>"; receipts carry the bare hex. */
function normalizeSourceHash(value) {
    if (typeof value !== 'string' || value.trim() === '')
        return undefined;
    return value.trim().replace(/^sha256:/iu, '');
}
export async function setStandaloneHksSource(input) {
    const diagnostics = [];
    const sourceUri = pathToFileURL(input.file).href;
    let beforeBytes;
    try {
        beforeBytes = await readFile(input.file);
    }
    catch (error) {
        return fail('HKS_SOURCE_NOT_FOUND', `无法读取脚本文件：${error instanceof Error ? error.message : String(error)}`);
    }
    const beforeHash = createHash('sha256').update(beforeBytes).digest('hex');
    const read = await runBridge({
        command: 'read-hks-source',
        filePath: input.file,
        resourceUri: sourceUri,
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        commandOptions: { contentBase64: beforeBytes.toString('base64') },
        allowedRoots: input.edit.allowedRoots(),
        timeoutMs: input.timeoutMs ?? 120_000,
        ...(input.signal ? { signal: input.signal } : {}),
        maxFrameBytes: 32 * 1024 * 1024
    });
    diagnostics.push(...read.diagnostics);
    if (read.parseStatus === 'failed' || !read.data?.sourceText) {
        const first = read.diagnostics.find((item) => item.severity === 'error');
        if (first?.code === 'HKS_DIALECT_NOT_SUPPORTED') {
            return fail('HKS_SOURCE_NOT_COMPILED', `${basename(input.file)} 不是可编译的 Sekiro 1.6.x 字节码（可能是纯文本源码），本工具不能改写它；`
                + '纯文本脚本请走文本补丁路径，字节码脚本请确认文件未损坏。', diagnostics);
        }
        return fail(first?.code ?? 'HKS_SOURCE_READ_FAILED', first?.message ?? 'Bridge 未能把该脚本反编译为源码。', diagnostics);
    }
    const beforeSourceHash = normalizeSourceHash(read.data.sourceHash ?? read.data.contentHash) ?? beforeHash;
    if (input.expectedSourceHash !== undefined && input.expectedSourceHash !== beforeSourceHash) {
        return fail('STALE_READ_CURSOR', '脚本已改变，请重新读取后再改写。', diagnostics);
    }
    if (input.text === read.data.sourceText) {
        return fail('HKS_SOURCE_UNCHANGED', '新源码与当前源码相同，未提交。如需重写，请先修改源码内容再提交。', diagnostics);
    }
    const compiled = await runBridge({
        command: 'compile-hks-source',
        filePath: input.file,
        resourceUri: sourceUri,
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        commandOptions: {
            sourceText: input.text,
            expectedDialect: read.data.dialect ?? 'sekiro-hks-1.6.x',
            expectedSourceHash: beforeSourceHash,
            sourceContentBase64: beforeBytes.toString('base64')
        },
        allowedRoots: input.edit.allowedRoots(),
        timeoutMs: input.timeoutMs ?? 120_000,
        ...(input.signal ? { signal: input.signal } : {}),
        maxFrameBytes: 32 * 1024 * 1024
    });
    diagnostics.push(...compiled.diagnostics);
    if (compiled.parseStatus === 'failed' || !compiled.data?.contentBase64) {
        const first = compiled.diagnostics.find((item) => item.severity === 'error');
        return fail(first?.code ?? 'HKS_COMPILER_FAILED', first?.message ?? 'Bridge 编译器未返回字节码，未提交。', diagnostics);
    }
    const compiledBytes = Buffer.from(compiled.data.contentBase64, 'base64');
    const indexed = await input.edit.indexFile(input.file, 'action');
    const outcome = await applyNativeMutation({
        file: { ...indexed, sha256: beforeHash },
        sourceUri,
        expectedHash: beforeHash,
        stagingRoot: input.edit.stagingRoot,
        allowedRoots: () => [...input.edit.allowedRoots()],
        stagingPrefix: 'hks',
        stagingFileName: `${basename(input.file)}.mut.hks`,
        title: `修改独立 HKS 脚本: ${basename(input.file)}`,
        confirmActionLabel: `修改 HKS 脚本: ${basename(input.file)}`,
        stageWrite: async (context) => {
            try {
                await writeFile(context.outputPath, compiledBytes);
                return { ok: true, diagnostics: [] };
            }
            catch (error) {
                return {
                    ok: false,
                    diagnostics: [{
                            severity: 'error',
                            code: 'HKS_STAGING_WRITE_FAILED',
                            message: error instanceof Error ? error.message : String(error)
                        }]
                };
            }
        }
    }, {
        ...(input.edit.confirmationPort ? { confirm: input.edit.confirmationPort } : {}),
        commit: input.edit.commitPort
    });
    if (outcome.status !== 'committed' || !outcome.result.ok) {
        const failures = outcome.status === 'failed'
            ? outcome.diagnostics
            : outcome.status === 'committed'
                ? outcome.result.diagnostics
                : [{ severity: 'error', code: 'HKS_WRITE_CANCELLED', message: '写入被取消。', sourceUri }];
        return fail(failures[0]?.code ?? 'HKS_MUTATION_FAILED', failures[0]?.message ?? 'HKS 脚本写入失败。', [...diagnostics, ...failures], outcome);
    }
    const afterBytes = await readFile(input.file);
    const afterHash = createHash('sha256').update(afterBytes).digest('hex');
    const readback = await runBridge({
        command: 'read-hks-source',
        filePath: input.file,
        resourceUri: sourceUri,
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        commandOptions: { contentBase64: afterBytes.toString('base64') },
        allowedRoots: input.edit.allowedRoots(),
        timeoutMs: input.timeoutMs ?? 120_000,
        maxFrameBytes: 32 * 1024 * 1024
    });
    diagnostics.push(...readback.diagnostics);
    return {
        ok: true,
        filePath: input.file,
        scriptName: basename(input.file),
        beforeSourceHash,
        ...(normalizeSourceHash(readback.data?.sourceHash ?? readback.data?.contentHash) ? { afterSourceHash: normalizeSourceHash(readback.data?.sourceHash ?? readback.data?.contentHash) } : {}),
        beforeHash,
        afterHash,
        diagnostics
    };
}
//# sourceMappingURL=hksEdit.js.map