/**
 * Agent / CLI MSB facade（问题 6-F）。
 *
 * 读：read-msb-document。写：将 part 变换 lowering 为统一的
 * MapEditTransaction → Patch Engine → native reread 路径。
 *
 * 入参是地址字符串（m11_01_00_00#c1050_0000），内部 parseMapAddress。未解码的
 * 其他 MSB 字段不开放 set。
 */
import { access } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { parseMapAddress } from '@soulforge/shared';
import { executeMapTransaction } from './mapService.js';
import { readMsbDocumentViaBridge } from './msbBridgeRead.js';
import { formatMsbPartAddresses, selectMsbParts } from './msbPartAddress.js';
export async function readMsbParts(input) {
    const resolved = await resolveMsbFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    const mapId = resolved.mapId;
    const doc = await readMsbDocumentViaBridge({
        sourcePath: resolved.path,
        allowedRoots: input.edit.allowedRoots(),
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        timeoutMs: 120_000
    });
    if (!doc.ok || !doc.data) {
        return { ok: false, error: { code: 'MSB_READ_FAILED', message: `无法读取 MSB：${resolved.path}` }, diagnostics: asDiagnostics(doc.diagnostics) };
    }
    const nativeParts = doc.data.parts.map((part) => ({
        ...part,
        nativeOffset: requireNativeOffset(part.nativeOffset, part.name)
    }));
    // Address is an identity: duplicated MSB names get `@0x<offset>`, unique names keep the old form.
    const addresses = formatMsbPartAddresses(mapId, nativeParts);
    const parts = nativeParts.map((part) => ({
        address: addresses.get(part.nativeOffset) ?? `#${part.name}`,
        name: part.name,
        family: 'part',
        nativeOffset: part.nativeOffset,
        typeId: part.typeId,
        mapId,
        posX: part.posX,
        posY: part.posY,
        posZ: part.posZ,
        ...(part.rotX !== undefined ? { rotX: part.rotX } : {}),
        ...(part.rotY !== undefined ? { rotY: part.rotY } : {}),
        ...(part.rotZ !== undefined ? { rotZ: part.rotZ } : {}),
        ...(part.scaleX !== undefined ? { scaleX: part.scaleX } : {}),
        ...(part.scaleY !== undefined ? { scaleY: part.scaleY } : {}),
        ...(part.scaleZ !== undefined ? { scaleZ: part.scaleZ } : {}),
        ...(part.npcParamRowId !== undefined ? { npcParamRowId: part.npcParamRowId } : {})
    }));
    const requested = (input.addresses ?? []).map((address) => ({ raw: address, parsed: parseMapAddress(address) }));
    const unparsable = requested.filter((item) => item.parsed === null).map((item) => item.raw);
    if (unparsable.length > 0) {
        return {
            ok: false,
            error: { code: 'MSB_ADDRESS_INVALID', message: `地址无法解析：${unparsable.join(', ')}` },
            diagnostics: []
        };
    }
    const requests = [];
    const foreignMaps = [];
    for (const item of requested) {
        const parsed = item.parsed;
        if (parsed.name === undefined)
            continue;
        // Reading a part of another map from this file used to silently pick the same-named part here.
        if (parsed.block !== mapId) {
            foreignMaps.push(item.raw);
            continue;
        }
        requests.push({
            raw: item.raw,
            name: parsed.name,
            ...(parsed.nativeOffset === undefined ? {} : { nativeOffset: parsed.nativeOffset })
        });
    }
    if (foreignMaps.length > 0) {
        return {
            ok: false,
            error: {
                code: 'MSB_ADDRESS_MAP_MISMATCH',
                message: `地址不属于当前地图：${foreignMaps.join(', ')}（文件 ${resolved.path} 的地图 id 是 ${mapId}）。`
                    + '请把 file 换成该地址所属的地图，或改用本图的地址。'
            },
            diagnostics: []
        };
    }
    const selection = selectMsbParts(mapId, parts, requests);
    if (!selection.ok) {
        return {
            ok: false,
            error: {
                code: selection.code,
                message: selection.message
                    + (selection.code === 'MSB_PART_NOT_FOUND'
                        ? 'read_msb_parts 只列 part；若这是 region / event 的地址，请用 inspect_map_object 查看，或用 query_map_objects 的 kind="region" / "event" 列表。'
                        : ''),
                details: selection.details
            },
            diagnostics: []
        };
    }
    return {
        ok: true,
        filePath: resolved.path,
        mapId,
        sourceUri: `map://${mapId}/${basename(resolved.path)}`,
        sourceHash: doc.data.sourceHash,
        parts: selection.parts,
        diagnostics: asDiagnostics(doc.diagnostics)
    };
}
export async function setMsbPartTransform(input) {
    if (input.edits.length === 0) {
        return { ok: false, error: { code: 'MSB_EDIT_EMPTY', message: '没有要写入的变换。' }, diagnostics: [] };
    }
    const resolved = await resolveMsbFile(input.edit, input.file);
    if (!resolved.ok)
        return { ok: false, error: resolved.error, diagnostics: [] };
    const doc = await readMsbDocumentViaBridge({
        sourcePath: resolved.path,
        allowedRoots: input.edit.allowedRoots(),
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        timeoutMs: 120_000
    });
    if (!doc.ok || !doc.data) {
        return { ok: false, error: { code: 'MSB_READ_FAILED', message: `无法读取 MSB：${resolved.path}` }, diagnostics: asDiagnostics(doc?.diagnostics ?? []) };
    }
    const before = [];
    const mutations = [];
    const partAddresses = formatMsbPartAddresses(resolved.mapId, doc.data.parts.map((item) => ({
        name: item.name,
        nativeOffset: requireNativeOffset(item.nativeOffset, item.name)
    })));
    for (const edit of input.edits) {
        const parsed = parseMapAddress(edit.address);
        if (!parsed || !parsed.name) {
            return { ok: false, error: { code: 'MSB_ADDRESS_INVALID', message: `地址需含 part 名：${edit.address}` }, diagnostics: [] };
        }
        if (edit.nativeOffset === undefined) {
            return {
                ok: false,
                error: { code: 'MSB_NATIVE_OFFSET_REQUIRED', message: `写入目标必须携带 nativeOffset：${edit.address}` },
                diagnostics: []
            };
        }
        // A `@0x<offset>` address suffix and the nativeOffset field are two spellings of one identity;
        // accepting two different values would let the address and the write disagree about the target.
        if (parsed.nativeOffset !== undefined && parsed.nativeOffset !== edit.nativeOffset) {
            return {
                ok: false,
                error: {
                    code: 'MSB_NATIVE_IDENTITY_MISMATCH',
                    message: `地址里的偏移与 nativeOffset 不一致：address=${edit.address} addressOffset=${parsed.nativeOffset} nativeOffset=${edit.nativeOffset}`
                },
                diagnostics: []
            };
        }
        // Native offset is the identity.  Name is only an expected-name guard and
        // diagnostic context; finding by name first is ambiguous for legitimate
        // duplicate MSB names and can select the wrong entity.
        const part = doc.data.parts.find((item) => item.nativeOffset === edit.nativeOffset);
        if (!part) {
            return {
                ok: false,
                error: {
                    code: 'MSB_NATIVE_IDENTITY_NOT_FOUND',
                    message: `nativeOffset 不存在：${edit.nativeOffset}（expectedName=${parsed.name}，文件 ${resolved.path}）`
                },
                diagnostics: []
            };
        }
        if (part.name !== parsed.name) {
            return {
                ok: false,
                error: {
                    code: 'MSB_NATIVE_IDENTITY_MISMATCH',
                    message: `nativeOffset 与 expectedName 不匹配：offset=${edit.nativeOffset} expectedName=${parsed.name} actualName=${part.name}`
                },
                diagnostics: []
            };
        }
        const nativeOffset = requireNativeOffset(part.nativeOffset, part.name);
        if (!hasAnyTransform(edit)) {
            return { ok: false, error: { code: 'MSB_EDIT_EMPTY', message: `${edit.address} 没有任何要写入的变换字段。` }, diagnostics: [] };
        }
        before.push({
            address: partAddresses.get(nativeOffset) ?? `#${part.name}`,
            name: part.name,
            family: 'part',
            nativeOffset,
            typeId: part.typeId,
            mapId: resolved.mapId,
            posX: part.posX ?? 0,
            posY: part.posY ?? 0,
            posZ: part.posZ ?? 0,
            ...(part.rotX !== undefined ? { rotX: part.rotX } : {}),
            ...(part.rotY !== undefined ? { rotY: part.rotY } : {}),
            ...(part.rotZ !== undefined ? { rotZ: part.rotZ } : {}),
            ...(part.scaleX !== undefined ? { scaleX: part.scaleX } : {}),
            ...(part.scaleY !== undefined ? { scaleY: part.scaleY } : {}),
            ...(part.scaleZ !== undefined ? { scaleZ: part.scaleZ } : {})
        });
        const mutation = {
            kind: hasRotScale(edit) ? 'set_part_transform' : 'set_part_position',
            family: 'part',
            nativeOffset,
            expectedName: parsed.name,
            ...(edit.posX !== undefined ? { posX: edit.posX } : {}),
            ...(edit.posY !== undefined ? { posY: edit.posY } : {}),
            ...(edit.posZ !== undefined ? { posZ: edit.posZ } : {}),
            ...(edit.rotX !== undefined ? { rotX: edit.rotX } : {}),
            ...(edit.rotY !== undefined ? { rotY: edit.rotY } : {}),
            ...(edit.rotZ !== undefined ? { rotZ: edit.rotZ } : {}),
            ...(edit.scaleX !== undefined ? { scaleX: edit.scaleX } : {}),
            ...(edit.scaleY !== undefined ? { scaleY: edit.scaleY } : {}),
            ...(edit.scaleZ !== undefined ? { scaleZ: edit.scaleZ } : {})
        };
        mutations.push(mutation);
    }
    const file = await input.edit.indexFile(resolved.path, 'map');
    const expectedHash = file.sha256 || doc.data.sourceHash;
    const beforeByOffset = new Map(before.map((snapshot) => [snapshot.nativeOffset, snapshot]));
    const transaction = {
        id: `tx-msb-transform-${Date.now()}`,
        mapId: resolved.mapId,
        baseRevision: expectedHash,
        description: `MSB transform (${mutations.length} 个 part)`,
        author: 'human',
        operations: mutations.map((mutation) => {
            const snapshot = beforeByOffset.get(mutation.nativeOffset);
            if (!snapshot)
                throw new Error(`MSB_NATIVE_IDENTITY_NOT_FOUND: ${mutation.nativeOffset}`);
            return {
                kind: 'set_transform',
                target: `part:${resolved.mapId}:offset-${mutation.nativeOffset.toString(16)}`,
                ...(mutation.posX !== undefined || mutation.posY !== undefined || mutation.posZ !== undefined
                    ? { position: [mutation.posX ?? snapshot.posX, mutation.posY ?? snapshot.posY, mutation.posZ ?? snapshot.posZ] }
                    : {}),
                ...(mutation.rotX !== undefined || mutation.rotY !== undefined || mutation.rotZ !== undefined
                    ? { rotation: [mutation.rotX ?? snapshot.rotX ?? 0, mutation.rotY ?? snapshot.rotY ?? 0, mutation.rotZ ?? snapshot.rotZ ?? 0] }
                    : {}),
                ...(mutation.scaleX !== undefined || mutation.scaleY !== undefined || mutation.scaleZ !== undefined
                    ? { scale: [mutation.scaleX ?? snapshot.scaleX ?? 1, mutation.scaleY ?? snapshot.scaleY ?? 1, mutation.scaleZ ?? snapshot.scaleZ ?? 1] }
                    : {})
            };
        }),
        timestamp: Date.now()
    };
    const outcome = await executeMapTransaction(input.edit, resolved.path, transaction);
    if (!outcome.ok) {
        return {
            ok: false,
            error: outcome.error ?? { code: 'MSB_WRITE_FAILED', message: 'MSB 写入失败。' },
            diagnostics: outcome.error?.details && Array.isArray(outcome.error.details)
                ? outcome.error.details
                : [],
            before
        };
    }
    // executeMapTransaction 已经完成 authoritative reread；这里再次投影
    // 仅用于维持 facade 的 before/after 返回契约，不参与成功判定。
    const after = [];
    const reread = await readMsbDocumentViaBridge({
        sourcePath: resolved.path,
        allowedRoots: input.edit.allowedRoots(),
        ...(input.edit.oodleRuntimeRoot ? { oodleRuntimeRoot: input.edit.oodleRuntimeRoot } : {}),
        timeoutMs: 120_000
    });
    if (reread.ok && reread.data) {
        // Addresses come from the post-write document too: a duplicated name stays unambiguous even if
        // the writer re-serialised the file.
        const afterAddresses = formatMsbPartAddresses(resolved.mapId, reread.data.parts.map((item) => ({
            name: item.name,
            nativeOffset: requireNativeOffset(item.nativeOffset, item.name)
        })));
        for (const mutation of mutations) {
            const part = reread.data.parts.find((item) => item.nativeOffset === mutation.nativeOffset);
            if (!part) {
                return {
                    ok: false,
                    error: { code: 'MSB_REREAD_FAILED', message: `写入后 nativeOffset ${mutation.nativeOffset} 无法读回。` },
                    diagnostics: asDiagnostics(reread.diagnostics),
                    before
                };
            }
            if (part.name !== mutation.expectedName) {
                return {
                    ok: false,
                    error: { code: 'MSB_NATIVE_IDENTITY_MISMATCH', message: `写入后 expectedName 不匹配：offset=${mutation.nativeOffset} expectedName=${mutation.expectedName} actualName=${part.name}` },
                    diagnostics: asDiagnostics(reread.diagnostics),
                    before
                };
            }
            const nativeOffset = requireNativeOffset(part.nativeOffset, part.name);
            after.push({
                address: afterAddresses.get(nativeOffset) ?? `#${part.name}`,
                name: part.name,
                family: 'part',
                nativeOffset,
                typeId: part.typeId,
                mapId: resolved.mapId,
                posX: part.posX,
                posY: part.posY,
                posZ: part.posZ,
                ...(part.rotX !== undefined ? { rotX: part.rotX } : {}),
                ...(part.rotY !== undefined ? { rotY: part.rotY } : {}),
                ...(part.rotZ !== undefined ? { rotZ: part.rotZ } : {}),
                ...(part.scaleX !== undefined ? { scaleX: part.scaleX } : {}),
                ...(part.scaleY !== undefined ? { scaleY: part.scaleY } : {}),
                ...(part.scaleZ !== undefined ? { scaleZ: part.scaleZ } : {})
            });
        }
    }
    else {
        return {
            ok: false,
            error: { code: 'MSB_REREAD_FAILED', message: `写入后无法重新读取 MSB：${resolved.path}` },
            diagnostics: asDiagnostics(reread.diagnostics),
            before
        };
    }
    return {
        ok: true,
        filePath: resolved.path,
        before,
        after,
        mutations: mutations.length,
        diagnostics: []
    };
}
function requireNativeOffset(value, name) {
    if (value === undefined || !Number.isSafeInteger(value) || value < 0) {
        throw new Error(`MSB_NATIVE_OFFSET_REQUIRED: part ${name} 缺少有效 nativeOffset。`);
    }
    return value;
}
function hasAnyTransform(edit) {
    return edit.posX !== undefined || edit.posY !== undefined || edit.posZ !== undefined
        || edit.rotX !== undefined || edit.rotY !== undefined || edit.rotZ !== undefined
        || edit.scaleX !== undefined || edit.scaleY !== undefined || edit.scaleZ !== undefined;
}
function hasRotScale(edit) {
    return edit.rotX !== undefined || edit.rotY !== undefined || edit.rotZ !== undefined
        || edit.scaleX !== undefined || edit.scaleY !== undefined || edit.scaleZ !== undefined;
}
async function resolveMsbFile(edit, file) {
    const overlay = edit.session.layers.overlayRoot;
    const candidates = [
        resolve(file),
        join(overlay, file),
        join(overlay, 'map', file)
    ];
    for (const candidate of candidates) {
        try {
            await access(candidate);
            const writable = edit.session.resolveWritablePath(candidate);
            if (!writable.ok)
                continue;
            const mapId = basename(candidate).replace(/\.msb(\.dcx)?$/i, '');
            return { ok: true, path: candidate, mapId };
        }
        catch {
            // try next
        }
    }
    return {
        ok: false,
        error: { code: 'MSB_FILE_NOT_FOUND', message: `工作区内找不到地图文件：${file}（期望 mAA_BB_CC_DD.msb 或 .msb.dcx）` }
    };
}
function asDiagnostics(items) {
    return items.map((item) => ({
        severity: item.severity === 'warning' || item.severity === 'info' ? item.severity : 'error',
        code: item.code,
        message: item.message
    }));
}
//# sourceMappingURL=msbEdit.js.map