/**
 * Shared EMEVD corpus-matrix logic for the wave-1 full-corpus typed-mutation
 * matrix smoke (runEmevdCorpusMatrixSmoke) and the multi-corpus extension
 * (runEmevdMultiCorpusMatrixSmoke).
 *
 * Contains the registry-driven sampling, fail-closed verification and commit
 * verification helpers used by both smokes so the behavior stays identical
 * instead of being copy-pasted. Pure / Bridge-agnostic: all filesystem and
 * Bridge access stays in the calling smoke.
 */
import { compileEmevdPatchDsl } from './dslCompiler.js';
import { decodeInstructionArgs, encodedEmedfArgsLength, findInstructionDef, hasVararg, varargCount } from './emedfSchema.js';
import { decodeStrictBase64 } from '../util/base64.js';
import { formatEmevdAnchor } from './stableIdentity.js';
const NUMERIC_RANGE = {
    u8: [0, 0xff],
    s8: [-0x80, 0x7f],
    u16: [0, 0xffff],
    s16: [-0x8000, 0x7fff],
    u32: [0, 0xffff_ffff],
    s32: [-0x8000_0000, 0x7fff_ffff]
};
export function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}
export function argsBytesEqual(a, b) {
    return Buffer.from(a, 'base64').equals(Buffer.from(b, 'base64'));
}
export function argsLengthOf(argsBase64) {
    return Buffer.from(argsBase64, 'base64').length;
}
export function flipInRange(value, min, max) {
    if (value === max)
        return Math.max(min, max - 1);
    if (value === min)
        return Math.min(max, min + 1);
    return value + 1;
}
export function numericRangeOf(type) {
    const range = NUMERIC_RANGE[type];
    if (!range)
        throw new Error(`unexpected numeric arg type ${type}`);
    return range;
}
export function flatInstructions(document) {
    const result = [];
    for (const event of document.events) {
        for (const instruction of event.instructions) {
            result.push({ globalIndex: result.length, event, instruction });
        }
    }
    return result;
}
export function compileRequestFor(sourceText, schemaFingerprint, document) {
    if (!document.documentInstanceId)
        throw new Error('documentInstanceId missing');
    return {
        schemaVersion: 1,
        resourceUri: document.resourceUri,
        documentInstanceId: document.documentInstanceId,
        baseRevision: document.revision,
        emedfSchemaFingerprint: schemaFingerprint,
        sourceText,
        mode: 'patch'
    };
}
export function buildMatrixDslSource(schemaFingerprint, resourceUri, eventMutation, samples) {
    const lines = [
        `resource "${resourceUri}"`,
        `base revision 0 schema "${schemaFingerprint}"`
    ];
    if (eventMutation) {
        lines.push(`event ${eventMutation.eventAnchor} {`);
        lines.push(`  set id = ${eventMutation.newId};`);
        lines.push(`  set rest = ${eventMutation.newRest};`);
        lines.push('}');
    }
    for (const sample of samples) {
        lines.push(`instruction ${sample.instructionAnchor} {`);
        lines.push(`  set arg ${sample.argument} = ${sample.after};`);
        lines.push('}');
    }
    return lines.join('\n');
}
export function singleInstructionDsl(schemaFingerprint, resourceUri, anchor, argName, value) {
    return `resource "${resourceUri}"
base revision 0 schema "${schemaFingerprint}"
instruction ${anchor} {
  set arg ${argName} = ${value};
}`;
}
/** Prefer a second sample at a different args length so vararg variants are hit. */
export function pickSampleIndices(entries, count) {
    if (entries.length === 0)
        return [];
    if (count <= 1)
        return [0];
    if (entries.length === 1)
        return [0];
    const firstLength = argsLengthOf(entries[0].instruction.argsBase64);
    const different = entries.findIndex((entry, i) => i > 0 && argsLengthOf(entry.instruction.argsBase64) !== firstLength);
    return different > 0 ? [0, different] : [0, Math.floor(entries.length / 2)];
}
export function chooseArgName(def, sampleIndex) {
    const writable = def.args.filter((arg) => !arg.vararg && arg.type !== 'f32');
    if (writable.length === 0)
        return undefined;
    if (sampleIndex === 0 && def.bank === 2000 && def.id === 0) {
        const eventId = writable.find((arg) => arg.name === 'eventId');
        if (eventId)
            return eventId.name;
    }
    return writable[0].name;
}
/** Sample 1-2 instances per schema-covered kind present in the corpus and plan typed mutations. */
export function planCoveredMutations(registry, document) {
    const flat = flatInstructions(document);
    const byKind = new Map();
    for (const entry of flat) {
        if (entry.instruction.unknown)
            continue;
        const key = `${entry.instruction.bank}:${entry.instruction.id}`;
        const list = byKind.get(key) ?? [];
        list.push(entry);
        byKind.set(key, list);
    }
    const samples = [];
    const skippedInstances = [];
    const coveredKindsPresent = [];
    const coveredKindsAbsent = [];
    for (const def of registry.instructions) {
        const key = `${def.bank}:${def.id}`;
        const entries = byKind.get(key) ?? [];
        if (entries.length === 0) {
            coveredKindsAbsent.push({ bank: def.bank, id: def.id });
            continue;
        }
        const mutableArgCount = def.args.filter((arg) => !arg.vararg && arg.type !== 'f32').length;
        coveredKindsPresent.push({ bank: def.bank, id: def.id, count: entries.length, mutableArgCount });
        const indices = pickSampleIndices(entries, Math.min(2, entries.length));
        for (let s = 0; s < indices.length; s++) {
            const entry = entries[indices[s]];
            let raw;
            try {
                raw = decodeStrictBase64(entry.instruction.argsBase64, { allowEmpty: true });
            }
            catch (error) {
                skippedInstances.push({
                    bank: def.bank,
                    id: def.id,
                    globalIndex: entry.globalIndex,
                    code: 'BASE64_INVALID',
                    message: error instanceof Error ? error.message : String(error)
                });
                continue;
            }
            const decoded = decodeInstructionArgs(registry, def.bank, def.id, raw);
            if (!decoded.ok) {
                skippedInstances.push({ bank: def.bank, id: def.id, globalIndex: entry.globalIndex, code: decoded.code, message: decoded.message });
                continue;
            }
            const anchor = entry.instruction.anchor;
            if (!anchor) {
                skippedInstances.push({ bank: def.bank, id: def.id, globalIndex: entry.globalIndex, code: 'ANCHOR_MISSING', message: 'instruction anchor missing' });
                continue;
            }
            const argName = chooseArgName(def, s);
            if (!argName) {
                skippedInstances.push({ bank: def.bank, id: def.id, globalIndex: entry.globalIndex, code: 'EMEDF_NO_WRITABLE_ARG', message: `schema ${def.name} 无可写非 vararg 参数` });
                continue;
            }
            const decodedArg = decoded.args.find((a) => a.name === argName);
            if (!decodedArg || typeof decodedArg.value !== 'number') {
                skippedInstances.push({ bank: def.bank, id: def.id, globalIndex: entry.globalIndex, code: 'EMEDF_ARG_NOT_DECODED', message: `参数 ${argName} 无法解码为数值` });
                continue;
            }
            const [min, max] = numericRangeOf(decodedArg.type);
            const after = flipInRange(decodedArg.value, min, max);
            if (after === decodedArg.value) {
                skippedInstances.push({ bank: def.bank, id: def.id, globalIndex: entry.globalIndex, code: 'EMEDF_ARG_NO_DELTA', message: `参数 ${argName} 无法生成不同值` });
                continue;
            }
            const sample = {
                globalIndex: entry.globalIndex,
                instructionAnchor: formatEmevdAnchor('instruction', anchor),
                bank: def.bank,
                id: def.id,
                argument: argName,
                before: decodedArg.value,
                after,
                argsBase64Before: entry.instruction.argsBase64
            };
            if (hasVararg(def)) {
                sample.tailBefore = raw.subarray(encodedEmedfArgsLength(def));
            }
            samples.push(sample);
        }
    }
    return { samples, skippedInstances, coveredKindsPresent, coveredKindsAbsent };
}
export function pickEventMutation(document) {
    const targetEvent = document.events.find((e) => e.eventId !== 0 && e.instructions.length > 0)
        ?? document.events.find((e) => e.eventId !== 0)
        ?? document.events[0];
    let newId = 9_000_004;
    while (document.events.some((e) => e.eventId === newId))
        newId += 1;
    const newRest = targetEvent.restBehavior === 0 ? 1 : 0;
    return { event: targetEvent, newId, newRest };
}
/**
 * Every unknown kind must fail closed twice: decode (EMEDF_UNKNOWN_INSTRUCTION)
 * and DSL write (EMEVD_DSL_UNKNOWN_INSTRUCTION_READONLY with zero plan ops).
 * When the registry covers every kind in the document, the verification is a
 * no-op that reports zero checked kinds (callers must not require > 0).
 */
export function verifyUnknownKindFailClosed(registry, document, schemaFingerprint) {
    const flat = flatInstructions(document);
    const unknownByKind = new Map();
    for (const entry of flat) {
        if (!entry.instruction.unknown)
            continue;
        const key = `${entry.instruction.bank}:${entry.instruction.id}`;
        if (!unknownByKind.has(key))
            unknownByKind.set(key, entry);
    }
    const entries = [...unknownByKind.values()];
    if (entries.length === 0) {
        return { unknownKindsChecked: 0, readOnlyDiagnostics: 0, decodeFailCodes: [] };
    }
    const decodeFailCodes = [];
    for (const entry of entries) {
        const raw = decodeStrictBase64(entry.instruction.argsBase64, { allowEmpty: true });
        const decoded = decodeInstructionArgs(registry, entry.instruction.bank, entry.instruction.id, raw);
        assert(!decoded.ok, `unknown ${entry.instruction.bank}:${entry.instruction.id} must not decode`);
        assert(decoded.code === 'EMEDF_UNKNOWN_INSTRUCTION', `unexpected unknown decode code ${decoded.code}`);
        if (!decodeFailCodes.includes(decoded.code))
            decodeFailCodes.push(decoded.code);
    }
    const lines = [`resource "${document.resourceUri}"`, `base revision 0 schema "${schemaFingerprint}"`];
    for (const entry of entries) {
        const anchor = entry.instruction.anchor;
        assert(anchor !== undefined, 'unknown instruction anchor missing');
        lines.push(`instruction ${formatEmevdAnchor('instruction', anchor)} {`);
        lines.push('  set arg unknownArg = 1;');
        lines.push('}');
    }
    const compiled = compileEmevdPatchDsl(compileRequestFor(lines.join('\n'), schemaFingerprint, document), document, registry);
    assert(compiled.ok === false, 'unknown-kind patch must fail closed');
    assert(!('plan' in compiled), 'unknown-kind patch must not produce a plan');
    const readOnly = compiled.diagnostics.filter((d) => d.code === 'EMEVD_DSL_UNKNOWN_INSTRUCTION_READONLY').length;
    assert(readOnly === entries.length, `expected ${entries.length} read-only diagnostics, got ${readOnly}`);
    const unexpected = compiled.diagnostics.filter((d) => d.code !== 'EMEVD_DSL_UNKNOWN_INSTRUCTION_READONLY');
    assert(unexpected.length === 0, `unexpected diagnostics: ${JSON.stringify(unexpected)}`);
    return { unknownKindsChecked: unknownByKind.size, readOnlyDiagnostics: readOnly, decodeFailCodes };
}
/** Kinds observed at more than one args length; covered vararg kinds are length-signature valid. */
export function analyzeMultiLengthKinds(registry, distribution) {
    const results = [];
    for (const entry of distribution) {
        const lengths = Object.keys(entry.argsLengths)
            .map(Number)
            .filter(Number.isSafeInteger)
            .sort((a, b) => a - b);
        if (lengths.length <= 1)
            continue;
        const def = findInstructionDef(registry, entry.bank, entry.id);
        const covered = def !== undefined;
        const vararg = def ? hasVararg(def) : false;
        results.push({
            bank: entry.bank,
            id: entry.id,
            count: entry.count,
            lengths,
            covered,
            vararg,
            ...(covered && vararg ? { allValidVarargMultiples: lengths.every((l) => varargCount(def, l) >= 0) } : {})
        });
    }
    return results;
}
/**
 * Verify a committed matrix against full before/after documents:
 * typed mutations observable, opaque instructions byte-preserved, covered
 * untouched instructions byte-preserved.
 */
export function verifyMatrixCommit(registry, beforeDoc, afterDoc, samples) {
    const beforeFlat = flatInstructions(beforeDoc);
    const afterByIndex = new Map(flatInstructions(afterDoc).map((f) => [f.globalIndex, f.instruction]));
    let typedVerified = 0;
    for (const sample of samples) {
        const afterInstr = afterByIndex.get(sample.globalIndex);
        assert(afterInstr !== undefined, `mutated instruction ${sample.globalIndex} missing after commit`);
        assert(afterInstr.bank === sample.bank && afterInstr.id === sample.id, `sample ${sample.globalIndex} bank/id changed`);
        const beforeRaw = decodeStrictBase64(sample.argsBase64Before, { allowEmpty: true });
        const afterRaw = decodeStrictBase64(afterInstr.argsBase64, { allowEmpty: true });
        assert(afterRaw.length === beforeRaw.length, `sample ${sample.globalIndex} args length changed`);
        const decoded = decodeInstructionArgs(registry, sample.bank, sample.id, afterRaw);
        if (!decoded.ok) {
            throw new Error(`sample ${sample.globalIndex} after-decode failed: ${decoded.message}`);
        }
        const arg = decoded.args.find((a) => a.name === sample.argument);
        assert(arg !== undefined && arg.value === sample.after, `sample ${sample.globalIndex} arg ${sample.argument} not mutated to ${sample.after}`);
        if (sample.tailBefore) {
            const baseSize = encodedEmedfArgsLength(decoded.def);
            const tail = afterRaw.subarray(baseSize);
            assert(tail.equals(sample.tailBefore), `sample ${sample.globalIndex} vararg tail changed`);
        }
        typedVerified += 1;
    }
    let opaqueTotalKinds = 0;
    let opaqueTotalInstances = 0;
    let opaquePreservedKinds = 0;
    let opaquePreservedInstances = 0;
    const opaqueViolations = [];
    const opaqueKindResults = new Map();
    for (const before of beforeFlat) {
        if (!before.instruction.unknown)
            continue;
        opaqueTotalInstances += 1;
        const key = `${before.instruction.bank}:${before.instruction.id}`;
        if (!opaqueKindResults.has(key)) {
            opaqueTotalKinds += 1;
            opaqueKindResults.set(key, true);
        }
        const afterInstr = afterByIndex.get(before.globalIndex);
        assert(afterInstr !== undefined, `opaque instruction ${before.globalIndex} missing after commit`);
        const preserved = argsBytesEqual(afterInstr.argsBase64, before.instruction.argsBase64);
        if (!preserved) {
            opaqueViolations.push(`${before.globalIndex}:${key}`);
            opaqueKindResults.set(key, false);
        }
        else {
            opaquePreservedInstances += 1;
        }
    }
    for (const preserved of opaqueKindResults.values()) {
        if (preserved)
            opaquePreservedKinds += 1;
    }
    let coveredUntouchedTotal = 0;
    let coveredUntouchedPreserved = 0;
    const mutatedIndices = new Set(samples.map((s) => s.globalIndex));
    for (const before of beforeFlat) {
        if (before.instruction.unknown || mutatedIndices.has(before.globalIndex))
            continue;
        const afterInstr = afterByIndex.get(before.globalIndex);
        assert(afterInstr !== undefined, `covered instruction ${before.globalIndex} missing after commit`);
        coveredUntouchedTotal += 1;
        if (argsBytesEqual(afterInstr.argsBase64, before.instruction.argsBase64))
            coveredUntouchedPreserved += 1;
    }
    return {
        typedVerified,
        opaquePreservedKinds,
        opaquePreservedInstances,
        opaqueTotalKinds,
        opaqueTotalInstances,
        opaqueViolations,
        coveredUntouchedPreserved,
        coveredUntouchedTotal
    };
}
/** 2000:0 length-signature distinction: 8/12/16/20/24/32 -> 0/1/2/3/4/6 params. */
export function verifyVarargLengthSignature(registry) {
    const def = findInstructionDef(registry, 2000, 0);
    assert(def !== undefined, '2000:0 def missing');
    assert(hasVararg(def), '2000:0 must be vararg');
    const counts = [];
    for (const length of [8, 12, 16, 20, 24, 32]) {
        const decoded = decodeInstructionArgs(registry, 2000, 0, Buffer.alloc(length));
        assert(decoded.ok, `2000:0 at ${length} bytes must decode under vararg signature`);
        counts.push({ length, varargCount: varargCount(def, length) });
    }
    assert(counts.map((c) => c.varargCount).join(',') === '0,1,2,3,4,6', `unexpected vararg counts ${JSON.stringify(counts)}`);
    const invalid = decodeInstructionArgs(registry, 2000, 0, Buffer.alloc(10));
    assert(!invalid.ok && invalid.code === 'EMEDF_ARGS_LENGTH_MISMATCH', 'invalid vararg length must fail decode');
    const belowBase = decodeInstructionArgs(registry, 2000, 0, Buffer.alloc(6));
    assert(!belowBase.ok && belowBase.code === 'EMEDF_ARGS_LENGTH_MISMATCH', 'below-base length must fail decode');
    const fixedMismatch = decodeInstructionArgs(registry, 0, 0, Buffer.alloc(8));
    assert(!fixedMismatch.ok && fixedMismatch.code === 'EMEDF_ARGS_LENGTH_MISMATCH', 'fixed length mismatch must fail decode');
    return {
        counts,
        invalidLengthRejectedCode: invalid.code,
        belowBaseRejectedCode: belowBase.code,
        fixedMismatchRejectedCode: fixedMismatch.code
    };
}
export function verifySyntheticSamples(registry, sample, samples) {
    const byIndex = new Map(sample.map((entry) => [entry.index, entry]));
    for (const s of samples) {
        const entry = byIndex.get(s.globalIndex);
        assert(entry !== undefined, `sample ${s.globalIndex} missing in re-read`);
        assert(entry.bank === s.bank && entry.id === s.id, `sample ${s.globalIndex} bank/id changed`);
        const raw = decodeStrictBase64(entry.argsBase64, { allowEmpty: true });
        const beforeLen = decodeStrictBase64(s.argsBase64Before, { allowEmpty: true }).length;
        assert(raw.length === beforeLen, `sample ${s.globalIndex} args length changed`);
        const decoded = decodeInstructionArgs(registry, s.bank, s.id, raw);
        if (!decoded.ok) {
            throw new Error(`sample ${s.globalIndex} after-decode failed: ${decoded.message}`);
        }
        const arg = decoded.args.find((a) => a.name === s.argument);
        assert(arg !== undefined && arg.value === s.after, `sample ${s.globalIndex} arg ${s.argument} not mutated to ${s.after}`);
        if (s.tailBefore) {
            const baseSize = encodedEmedfArgsLength(decoded.def);
            const tail = raw.subarray(baseSize);
            assert(tail.equals(s.tailBefore), `sample ${s.globalIndex} vararg tail changed`);
        }
    }
}
//# sourceMappingURL=emevdCorpusMatrix.js.map