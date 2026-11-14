import { basename } from 'node:path';
import { parseActionAddress } from '@soulforge/shared';
/** T09 写入要求：从实际修改 payload 逐项提取目标及所需读取形状；未分类工具失败关闭。 */
import { resolveGameparamContainer } from '../param/containerParamEdit.js';
import { ProofError } from './nativeReadProofStore.js';
import { paramObjectKey, paramOuterKey, paramTableObjectKey, emevdObjectKey, emevdFileObjectKey, scriptObjectKey } from './proofIdentities.js';
import { outerFileKey, fmgObjectKey, fmgContainerKey, taeObjectKey, taeActionKey, parseTaeAddress, msbObjectKey, msbAddressKey, msbModifiedFields } from './proofIdentities.js';
function recordOf(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : {};
}
function stringOf(value) {
    return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}
function intOf(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined;
}
function paramEdits(input, outerSourceKey) {
    const edits = recordOf(input).edits;
    if (!Array.isArray(edits) || edits.length === 0)
        throw new Error('WRITE_REQUIREMENT_EMPTY_EDITS');
    return edits.map((edit) => {
        const record = recordOf(edit);
        const table = stringOf(record.table) ?? '?';
        const rowId = intOf(record.rowId);
        const rowIndex = intOf(record.rowIndex);
        const fieldId = stringOf(record.fieldId);
        if (!fieldId || rowId === undefined)
            throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
        const fields = [fieldId];
        const requirement = {
            objectKey: paramObjectKey({
                outerKey: outerSourceKey, table, rowId,
                ...(rowIndex === undefined ? {} : { rowIndex }),
                fieldId
            }),
            outerSourceKey,
            requiredFields: fields,
            requiredShape: 'fields'
        };
        return requirement;
    });
}
/**
 * 从实际修改 payload 构建写入要求。不从模型填写的 task target 取目标。
 * 未覆盖的修改/提交工具一律抛错（失败关闭），不得默认放行。
 */
export function buildWriteRequirement(toolName, input, outerSourceKey) {
    switch (toolName) {
        case 'mutate_param_fields':
            return paramEdits(input, outerSourceKey);
        case 'create_param_row': {
            // Creation has no existing row to have read, so the target key is the table itself. The key
            // is deliberately not satisfiable by mutating tools (their keys are per row+field); an
            // occupied rowId is refused by the writer against its own fresh read, not proven here.
            const record = recordOf(input);
            const table = stringOf(record.table) ?? '?';
            const rowId = intOf(record.rowId);
            if (rowId === undefined)
                throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
            return [{
                    objectKey: paramTableObjectKey({ outerKey: outerSourceKey, table }),
                    outerSourceKey,
                    requiredFields: [],
                    requiredShape: 'fields'
                }];
        }
        case 'mutate_fmg_entries': {
            const entries = recordOf(input).entries;
            if (!Array.isArray(entries) || entries.length === 0)
                throw new Error('WRITE_REQUIREMENT_EMPTY_EDITS');
            return entries.map((entry) => {
                const record = recordOf(entry);
                const textId = intOf(record.textId);
                if (textId === undefined)
                    throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
                return {
                    objectKey: `fmg|${stringOf(record.table) ?? '?'}|${textId}`,
                    outerSourceKey,
                    requiredFields: ['text'],
                    requiredShape: 'fields'
                };
            });
        }
        case 'apply_emevd_dsl': {
            const events = recordOf(input).events ?? recordOf(input).changes;
            const list = Array.isArray(events) ? events : [input];
            return list.map((event) => {
                const record = recordOf(event);
                const eventId = intOf(record.eventId);
                if (eventId === undefined)
                    throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
                return { objectKey: `emevd|${eventId}`, outerSourceKey, requiredShape: 'full-event' };
            });
        }
        case 'mutate_luabnd_script': {
            const record = recordOf(input);
            // The write tool receives childPath; childChain only exists on catalog listings. Keying on the
            // field the tool never receives produced `script|?`, which no read could ever match.
            const childPath = typeof record.childPath === 'string' && record.childPath.trim() !== ''
                ? record.childPath.trim()
                : Array.isArray(record.childChain) ? record.childChain.join('/') : '';
            if (childPath === '')
                throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
            return [{ objectKey: scriptObjectKey(outerSourceKey, childPath), outerSourceKey, requiredShape: 'full-script' }];
        }
        case 'insert_tae_events':
            return taeInsertionRequirements(input, outerSourceKey, () => outerSourceKey);
        case 'mutate_tae_event_times': {
            const record = recordOf(input);
            // When the caller addresses the event the way the read tools do, build the same six-part key the
            // session gate uses (observed for a real write: tae|<outer>|c6210|tae|3000|0). The old four-part
            // key names no outer source or chr, so nothing can ever have registered it.
            const parsedAddress = parseTaeAddress(stringOf(record.address) ?? '');
            if (parsedAddress) {
                return [{
                        objectKey: taeObjectKey(outerSourceKey, parsedAddress.chrId, parsedAddress.animId, parsedAddress.eventIndex, parsedAddress),
                        outerSourceKey,
                        requiredFields: ['start', 'end'],
                        requiredShape: 'fields'
                    }];
            }
            const animId = intOf(record.animId);
            const eventIndex = intOf(record.eventIndex);
            if (animId === undefined || eventIndex === undefined)
                throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
            return [{
                    objectKey: `tae|${intOf(record.taeEntryIndex) ?? '?'}|${animId}|${eventIndex}`,
                    outerSourceKey,
                    requiredFields: ['start', 'end'],
                    requiredShape: 'fields'
                }];
        }
        case 'mutate_tae_event_fields': {
            const edits = recordOf(input).edits;
            const rawEdits = Array.isArray(edits) ? edits : [input];
            if (rawEdits.length === 0)
                throw new Error('WRITE_REQUIREMENT_EMPTY_EDITS');
            return rawEdits.map((edit) => {
                const record = recordOf(edit);
                const parsed = parseTaeAddress(stringOf(record.address) ?? '');
                if (!parsed)
                    throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
                const fieldName = stringOf(record.fieldName);
                const fieldIndex = intOf(record.fieldIndex);
                if (!fieldName && fieldIndex === undefined)
                    throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
                return {
                    objectKey: taeObjectKey(outerSourceKey, parsed.chrId, parsed.animId, parsed.eventIndex, parsed),
                    outerSourceKey,
                    requiredFields: [
                        ...(fieldName ? [fieldName] : []),
                        ...(fieldIndex === undefined ? [] : [`fieldIndex:${fieldIndex}`])
                    ],
                    requiredShape: 'fields'
                };
            });
        }
        case 'mutate_msb_part_transform':
        case 'batch_transform_map_objects': {
            const parts = recordOf(input).parts ?? recordOf(input).transforms ?? [input];
            const list = Array.isArray(parts) ? parts : [parts];
            return list.map((part) => {
                const record = recordOf(part);
                const key = stringOf(record.nativeObjectKey);
                if (!key)
                    throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
                return { objectKey: `map|${key}`, outerSourceKey, requiredFields: ['transform'], requiredShape: 'fields' };
            });
        }
        case 'import_map_from_blender': {
            return [{ objectKey: 'map|blender-import', outerSourceKey, requiredFields: ['mapping'], requiredShape: 'fields' }];
        }
        case 'commit_patch': {
            const changes = recordOf(input).changes;
            if (!Array.isArray(changes) || changes.length === 0)
                throw new Error('WRITE_REQUIREMENT_EMPTY_EDITS');
            // 通用 proposal 不能成为旁路：展开每个 change 的实际目标递归构建。
            return changes.flatMap((change) => {
                const record = recordOf(change);
                const nestedTool = stringOf(record.tool);
                if (!nestedTool)
                    throw new Error('WRITE_REQUIREMENT_MISSING_TOOL');
                return buildWriteRequirement(nestedTool, record.args ?? {}, outerSourceKey);
            });
        }
        default:
            throw new Error(`WRITE_REQUIREMENT_UNCLASSIFIED_TOOL:${toolName}`);
    }
}
/** 注册表级断言：全部生产写入工具都必须有明确 requirement。 */
export function assertAllMutatingToolsClassified(mutatingTools) {
    for (const tool of mutatingTools) {
        buildWriteRequirement(tool, probeInputFor(tool), 'probe-outer');
    }
}
/** 新边界无法表达时回退旧边界（非 {tool,args} 形态的通用 proposal）。 */
export class LegacyFallbackError extends Error {
    constructor(message) {
        super(message);
        this.name = 'LegacyFallbackError';
    }
}
/**
 * 会话级写入要求：读写两侧用同一外层源推导，保证证明键一致。
 * 仅覆盖证明已生产的读取形态（PARAM 字段、整事件）；其余工具抛
 * ProofError，由调用方回退旧边界或失败关闭。
 */
export async function buildSessionWriteRequirements(toolName, input, session, resolvedEmevdTarget, paramChildHashes, depth = 0) {
    const record = typeof input === 'object' && input !== null && !Array.isArray(input)
        ? input : {};
    const overlayRoot = session?.layers.overlayRoot;
    if (toolName === 'commit_patch') {
        if (depth > 2)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'proposal 嵌套过深。');
        const changes = record.changes;
        if (!Array.isArray(changes) || changes.length === 0) {
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空 proposal 无写入目标。');
        }
        const nested = [];
        for (const change of changes) {
            const item = typeof change === 'object' && change !== null ? change : {};
            const nestedTool = typeof item.tool === 'string' ? item.tool : '';
            // 文本提案等非工具形态 change 走旧边界检查（门禁层回退），不绕过、不误杀。
            if (!nestedTool)
                throw new LegacyFallbackError('proposal change 不是工具调用形态，回退旧边界。');
            nested.push(...await buildSessionWriteRequirements(nestedTool, item.args ?? {}, session, resolvedEmevdTarget, paramChildHashes, depth + 1));
        }
        return nested;
    }
    if (toolName === 'mutate_param_fields') {
        if (!overlayRoot)
            throw new ProofError('NATIVE_READ_REQUIRED', '写入需要工作区会话解析容器身份。');
        const container = await resolveGameparamContainer(overlayRoot, typeof record.containerPath === 'string' ? record.containerPath : undefined);
        if (!container.ok)
            throw new ProofError('NATIVE_READ_REQUIRED', `写入需要先解析容器：${container.error.message}`);
        const outerKey = paramOuterKey(container.path);
        const edits = record.edits;
        if (!Array.isArray(edits) || edits.length === 0)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空修改无写入目标：edits 至少需要一条修改项。');
        const targets = edits.map((edit) => {
            const item = typeof edit === 'object' && edit !== null ? edit : {};
            const table = typeof item.table === 'string' ? item.table : '';
            const rowId = typeof item.rowId === 'number' ? item.rowId : NaN;
            const fieldId = typeof item.fieldId === 'string' ? item.fieldId : '';
            const rowIndex = typeof item.rowIndex === 'number' ? item.rowIndex : undefined;
            if (!table || !Number.isSafeInteger(rowId) || !fieldId) {
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '修改目标缺少表/行/字段，无法匹配读取证明。');
            }
            return { table, rowId, fieldId, ...(rowIndex === undefined ? {} : { rowIndex }) };
        });
        // 每个 PARAM 子表都有自己的内容哈希：把「写哪几张表」的当前哈希交给证明门禁，
        // 从而只让真正变了的子表的读证明失效（见 nativeReadProofStore.requireCoverage）。
        // 同一张表的多个行合并成一次判定：锚点按物理子表给，一张表只解析一次。
        const anchorTargets = [];
        for (const target of targets) {
            const known = anchorTargets.find((item) => item.table === target.table);
            if (known === undefined)
                anchorTargets.push({ table: target.table, rowIds: [target.rowId] });
            else
                known.rowIds.push(target.rowId);
        }
        const childHashes = await resolveParamChildHashes(paramChildHashes, container.path, anchorTargets);
        const childHashByTable = new Map();
        anchorTargets.forEach((target, index) => {
            if (!childHashByTable.has(target.table))
                childHashByTable.set(target.table, childHashes[index]);
        });
        return targets.map((target) => {
            const childHash = childHashByTable.get(target.table);
            return {
                objectKey: paramObjectKey({
                    outerKey, table: target.table, rowId: target.rowId,
                    ...(target.rowIndex === undefined ? {} : { rowIndex: target.rowIndex }),
                    fieldId: target.fieldId
                }),
                outerSourceKey: outerKey,
                requiredFields: [target.fieldId],
                requiredShape: 'fields',
                ...(childHash === undefined ? {} : { version: { childHash } })
            };
        });
    }
    if (toolName === 'create_param_row') {
        if (!overlayRoot)
            throw new ProofError('NATIVE_READ_REQUIRED', '写入需要工作区会话解析容器身份。');
        const container = await resolveGameparamContainer(overlayRoot, typeof record.containerPath === 'string' ? record.containerPath : undefined);
        if (!container.ok)
            throw new ProofError('NATIVE_READ_REQUIRED', `写入需要先解析容器：${container.error.message}`);
        const outerKey = paramOuterKey(container.path);
        const table = typeof record.table === 'string' ? record.table.trim() : '';
        if (!table)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '创建行缺少目标表名，无法匹配读取证明。');
        // Creating a row has no existing row to have read. The substitute is the whole table's row
        // set, delivered page by page by read_param_fields { allRows: true } and pinned to its child
        // hash. It is deliberately not an "any page is enough" claim: a single page of a 7790-row
        // table does not tell the caller which row ids are already taken, so the gate requires the
        // page union to cover [0, rowCount). An occupied rowId is still refused by the writer against
        // its own freshly read document. A copyFrom in another table additionally needs that source
        // table's whole row set observed, because its bytes are copied wholesale.
        const copy = typeof record.copyFrom === 'object' && record.copyFrom !== null && !Array.isArray(record.copyFrom)
            ? record.copyFrom
            : {};
        const copyTable = typeof copy.table === 'string' ? copy.table.trim() : '';
        const rowId = typeof record.rowId === 'number' && Number.isSafeInteger(record.rowId) ? record.rowId : undefined;
        const copyRowId = typeof copy.rowId === 'number' && Number.isSafeInteger(copy.rowId) ? copy.rowId : undefined;
        // The destination row does not exist yet, so its id is only a hint for the physical-subtable
        // decision: if the spelling matches more than one table, the row is in none of them and the
        // anchor comes back undefined. That is the documented fail-closed outcome — no content-version
        // pin — and the writer refuses an ambiguous spelling anyway (PARAM_TABLE_AMBIGUOUS).
        // A cross-table copyFrom anchors on the row actually copied, never on the new id: anchoring the
        // source table to a row it does not contain would silently drop "the source was read" instead of
        // failing it.
        const targets = [{ table, rowIds: rowId === undefined ? [] : [rowId] }];
        if (copyTable !== '' && copyTable !== table) {
            targets.push({ table: copyTable, rowIds: copyRowId === undefined ? [] : [copyRowId] });
        }
        const childHashes = await resolveParamChildHashes(paramChildHashes, container.path, targets);
        return targets.map((target, index) => {
            const childHash = childHashes[index];
            return {
                objectKey: paramTableObjectKey({ outerKey, table: target.table }),
                outerSourceKey: outerKey,
                requiredFields: [],
                requiredShape: 'fields',
                // 只读过一页（哪怕 128 行）不能授权对整张表建行：要求页并集覆盖 [0, rowCount)，
                // 让 NATIVE_READ_COVERAGE_INCOMPLETE 点名缺哪些行、从哪个 rowOffset 续读。
                requiredItemSet: true,
                ...(childHash === undefined ? {} : { version: { childHash } })
            };
        });
    }
    if (toolName === 'apply_emevd_dsl' && resolvedEmevdTarget?.canonical === true) {
        if (record.createIfMissing === true) {
            // Creation has no target content to have read, so the per-event receipt cannot exist. The
            // substitute is the file's delivered event set: it pins the source version and proves this
            // file's ids were delivered to the session. It is deliberately not an "I saw every id" claim —
            // an occupied id is refused by the writer against its own freshly read document, which is the
            // guarantee; the read only has to make the file, not the event, the thing that was observed.
            //
            // The set arrives page by page, so the gate requires the full page union: a single 256-event
            // page of a 1744-event file does not tell the caller which ids are already taken, and the old
            // "last page replaces the proof" shape silently turned any one page into a whole-set receipt.
            return [{
                    objectKey: emevdFileObjectKey(resolvedEmevdTarget.sourceUri),
                    outerSourceKey: resolvedEmevdTarget.sourceUri,
                    requiredFields: ['event-set'],
                    requiredShape: 'fields',
                    requiredItemSet: true
                }];
        }
        return [{
                objectKey: emevdObjectKey(resolvedEmevdTarget.sourceUri, resolvedEmevdTarget.eventId),
                outerSourceKey: resolvedEmevdTarget.sourceUri,
                requiredShape: 'full-event'
            }];
    }
    if (toolName === 'mutate_fmg_entries') {
        const rawEdits = Array.isArray(record.edits) ? record.edits : [record];
        const topTable = typeof record.table === 'string' ? record.table : '';
        let outerKey;
        try {
            outerKey = outerFileKey(overlayRoot, typeof record.containerPath === 'string' ? record.containerPath : undefined);
        }
        catch {
            throw new ProofError('NATIVE_READ_REQUIRED', 'FMG 写入需要显式容器路径：先用 read_fmg_entries 读取一次，把回执里的 containerPath 原样传回来。');
        }
        if (rawEdits.length === 0)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空修改无写入目标：edits 至少需要一条修改项。');
        return rawEdits.map((edit) => {
            const item = typeof edit === 'object' && edit !== null ? edit : {};
            // 每条 edit 自带表名（工具层允许多表）；无则回退顶层 table。
            const table = typeof item.table === 'string' && item.table.trim() !== '' ? item.table : topTable;
            if (!table)
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'FMG 修改缺少表名。');
            const id = typeof item.id === 'number' ? item.id : NaN;
            if (!Number.isSafeInteger(id))
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'FMG 修改缺少条目 id。');
            return {
                objectKey: fmgObjectKey(outerKey, table, id),
                outerSourceKey: outerKey,
                requiredFields: ['text'],
                requiredShape: 'fields',
                fallback: {
                    objectKey: fmgContainerKey(outerKey, table),
                    outerSourceKey: outerKey,
                    requiredFields: [],
                    requiredShape: 'fields',
                    // 新增条目没有既有条目可读：容器级证明必须覆盖整表条目集合（页并集），
                    // 单页条目不能作为「新增」的回退授权。
                    requiredItemSet: true
                }
            };
        });
    }
    if (toolName === 'insert_tae_events') {
        try {
            const outerKey = outerFileKey(overlayRoot, stringOf(record.file));
            return taeInsertionRequirements(input, outerKey, file => outerFileKey(overlayRoot, file));
        }
        catch (error) {
            throw new ProofError('NATIVE_READ_REQUIRED', error instanceof Error ? error.message : String(error));
        }
    }
    if (toolName === 'import_map_from_blender') {
        // A Blender delta only modifies existing entities, so it is authorized by the same per-object
        // field proofs that read_msb_parts delivers — not by a container-level "mapping" token that no
        // reader ever mints.
        let outerKey;
        try {
            outerKey = outerFileKey(overlayRoot, typeof record.file === 'string' ? record.file : undefined);
        }
        catch {
            throw new ProofError('NATIVE_READ_REQUIRED', 'Blender 导入需要显式 file（与导出时一致）。');
        }
        const delta = recordOf(record.delta);
        const mutations = Array.isArray(delta.mutations) ? delta.mutations : [];
        if (mutations.length === 0)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空导入无写入目标。');
        return mutations.map((raw) => {
            const item = recordOf(raw);
            const action = stringOf(item.action) ?? 'modify';
            if (action !== 'modify') {
                // A capability boundary, not a coverage gap: re-reading the map cannot make a create/delete
                // admissible, so the code must not invite a retry.
                throw new ProofError('BLENDER_IMPORT_ACTION_UNSUPPORTED', `Blender 导入目前只支持 action: modify（收到 ${action}）。`
                    + 'create / duplicate / delete 尚无写入证明与校验路径；请在 Blender 侧只导出 transform 变更。');
            }
            if (item.modelName !== undefined) {
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'Blender 导入暂不支持 modelName 替换，请只导入 position/rotation/scale。');
            }
            const requiredFields = [
                ...(item.position !== undefined ? ['posX', 'posY', 'posZ'] : []),
                ...(item.rotation !== undefined ? ['rotX', 'rotY', 'rotZ'] : []),
                ...(item.scale !== undefined ? ['scaleX', 'scaleY', 'scaleZ'] : [])
            ];
            if (requiredFields.length === 0) {
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'Blender modify 未提供 position、rotation 或 scale。');
            }
            const stableKey = stringOf(item.stableKey) ?? '';
            const explicitOffset = intOf(item.nativeOffset);
            const parsedOffset = /offset-([0-9a-f]+)/iu.exec(stableKey);
            const nativeOffset = explicitOffset ?? (parsedOffset ? Number.parseInt(parsedOffset[1], 16) : undefined);
            if (nativeOffset === undefined || !Number.isSafeInteger(nativeOffset)) {
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', `无法从 stableKey 解析原生偏移：${stableKey}`);
            }
            return { objectKey: msbObjectKey(outerKey, nativeOffset), outerSourceKey: outerKey, requiredFields, requiredShape: 'fields' };
        });
    }
    if (toolName === 'mutate_luabnd_script') {
        // Session path: the outer file has to be resolved from the workspace before the script identity
        // can be built, exactly like the TAE branches below.
        let outerKey;
        try {
            outerKey = outerFileKey(overlayRoot, typeof record.file === 'string' ? record.file : undefined);
        }
        catch {
            throw new ProofError('NATIVE_READ_REQUIRED', '脚本写入需要显式 file（与读取返回的容器一致）。');
        }
        // A standalone .hks has no child path: its identity is the file itself.
        const declaredChild = typeof record.childPath === 'string' && record.childPath.trim() !== ''
            ? record.childPath.trim()
            : Array.isArray(record.childChain) ? record.childChain.join('/') : '';
        const childPath = declaredChild !== ''
            ? declaredChild
            : typeof record.file === 'string' && /\.hks$/iu.test(record.file) ? basename(record.file.replaceAll('\\', '/')) : '';
        if (childPath === '')
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '脚本写入缺少 childPath。');
        return [{ objectKey: scriptObjectKey(outerKey, childPath), outerSourceKey: outerKey, requiredShape: 'full-script' }];
    }
    if (toolName === 'mutate_tae_event_times') {
        const rawEdits = Array.isArray(record.edits) ? record.edits : [record];
        let outerKey;
        try {
            outerKey = outerFileKey(overlayRoot, typeof record.file === 'string' ? record.file : undefined);
        }
        catch {
            throw new ProofError('NATIVE_READ_REQUIRED', 'TAE 写入需要显式 file（与读取返回的文件一致）。');
        }
        if (rawEdits.length === 0)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空修改无写入目标：edits 至少需要一条修改项。');
        return rawEdits.map((edit) => {
            const item = typeof edit === 'object' && edit !== null ? edit : {};
            const address = typeof item.address === 'string' ? item.address : '';
            const parsed = parseTaeAddress(address);
            if (!parsed)
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', `TAE 地址无法解析：${address}`);
            const requiredFields = [
                ...(typeof item.startFrame === 'number' ? ['startFrame'] : []),
                ...(typeof item.endFrame === 'number' ? ['endFrame'] : [])
            ];
            if (requiredFields.length === 0)
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'TAE 修改未指定时间字段。');
            return {
                objectKey: taeObjectKey(outerKey, parsed.chrId, parsed.animId, parsed.eventIndex, parsed),
                outerSourceKey: outerKey,
                requiredFields,
                requiredShape: 'fields'
            };
        });
    }
    if (toolName === 'mutate_tae_event_fields') {
        const rawEdits = Array.isArray(record.edits) ? record.edits : [record];
        let outerKey;
        try {
            outerKey = outerFileKey(overlayRoot, typeof record.file === 'string' ? record.file : undefined);
        }
        catch {
            throw new ProofError('NATIVE_READ_REQUIRED', 'TAE 字段写入需要显式 file（与读取返回的文件一致）。');
        }
        if (rawEdits.length === 0)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空修改无写入目标：edits 至少需要一条修改项。');
        return rawEdits.map((edit) => {
            const item = typeof edit === 'object' && edit !== null ? edit : {};
            const address = typeof item.address === 'string' ? item.address : '';
            const parsed = parseTaeAddress(address);
            if (!parsed)
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', `TAE 地址无法解析：${address}`);
            // `name` is the alias read_tae_events used to return for the same selector; the requirement
            // must be keyed on the field name the read actually proved, not on the spelling of the input.
            const fieldName = typeof item.fieldName === 'string' && item.fieldName.trim() !== ''
                ? item.fieldName
                : (typeof item.name === 'string' && item.name.trim() !== '' ? item.name : undefined);
            const fieldIndex = typeof item.fieldIndex === 'number' && Number.isSafeInteger(item.fieldIndex) && item.fieldIndex >= 0
                ? item.fieldIndex
                : undefined;
            if (fieldName === undefined && fieldIndex === undefined) {
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', `TAE 字段修改缺少 fieldName/fieldIndex：${address}`);
            }
            return {
                objectKey: taeObjectKey(outerKey, parsed.chrId, parsed.animId, parsed.eventIndex, parsed),
                outerSourceKey: outerKey,
                requiredFields: [
                    ...(fieldName === undefined ? [] : [fieldName]),
                    ...(fieldIndex === undefined ? [] : [`fieldIndex:${fieldIndex}`])
                ],
                requiredShape: 'fields'
            };
        });
    }
    if (toolName === 'mutate_msb_part_transform' || toolName === 'batch_transform_map_objects') {
        let outerKey;
        try {
            outerKey = outerFileKey(overlayRoot, typeof record.file === 'string' ? record.file : undefined);
        }
        catch {
            throw new ProofError('NATIVE_READ_REQUIRED', '地图写入需要显式 file（与读取返回的文件一致）。');
        }
        if (toolName === 'batch_transform_map_objects') {
            const targets = Array.isArray(record.targets) ? record.targets : [];
            if (targets.length === 0)
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空 targets 无写入目标。');
            const shared = {
                ...(typeof record.deltaX === 'number' ? { posX: record.deltaX } : {}),
                ...(typeof record.deltaY === 'number' ? { posY: record.deltaY } : {}),
                ...(typeof record.deltaZ === 'number' ? { posZ: record.deltaZ } : {}),
                ...(typeof record.rotDeltaX === 'number' ? { rotX: record.rotDeltaX } : {}),
                ...(typeof record.rotDeltaY === 'number' ? { rotY: record.rotDeltaY } : {}),
                ...(typeof record.rotDeltaZ === 'number' ? { rotZ: record.rotDeltaZ } : {}),
                ...(typeof record.scaleMultiplier === 'number'
                    ? { scaleX: record.scaleMultiplier, scaleY: record.scaleMultiplier, scaleZ: record.scaleMultiplier } : {})
            };
            const requiredFields = msbModifiedFields(shared);
            if (requiredFields.length === 0)
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '批量变换未指定变换字段；每次批量修改需要 posX/posY/posZ、rotX/rotY/rotZ、scaleX/scaleY/scaleZ 中至少一个，或 deltaX/deltaY/deltaZ 与 rotDeltaX/rotDeltaY/rotDeltaZ、scaleMultiplier。');
            return targets.map((target) => {
                if (typeof target !== 'string' || target.trim() === '') {
                    throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '批量变换目标地址缺失。');
                }
                return {
                    objectKey: msbAddressKey(outerKey, target),
                    outerSourceKey: outerKey,
                    requiredFields: [...requiredFields],
                    requiredShape: 'fields'
                };
            });
        }
        const rawEdits = Array.isArray(record.edits) ? record.edits : [record];
        if (rawEdits.length === 0)
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '空修改无写入目标：edits 至少需要一条修改项。');
        return rawEdits.map((edit) => {
            const item = typeof edit === 'object' && edit !== null ? edit : {};
            const requiredFields = msbModifiedFields(item);
            if (requiredFields.length === 0)
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '地图修改未指定变换字段；每处修改需要 posX/posY/posZ、rotX/rotY/rotZ、scaleX/scaleY/scaleZ 中至少一个（字段名与 read_msb_parts 返回的一致）。');
            const nativeOffset = typeof item.nativeOffset === 'number' ? item.nativeOffset : undefined;
            const address = typeof item.address === 'string' ? item.address : '';
            if (nativeOffset !== undefined && Number.isSafeInteger(nativeOffset)) {
                return {
                    objectKey: msbObjectKey(outerKey, nativeOffset),
                    outerSourceKey: outerKey,
                    requiredFields,
                    requiredShape: 'fields'
                };
            }
            if (address.trim() !== '') {
                return {
                    objectKey: msbAddressKey(outerKey, address),
                    outerSourceKey: outerKey,
                    requiredFields,
                    requiredShape: 'fields'
                };
            }
            throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', '地图修改缺少 nativeOffset 或 address。');
        });
    }
    throw new ProofError('NATIVE_READ_REQUIRED', `工具 ${toolName} 的新证明边界尚未覆盖其读取形态；请使用旧边界或先补充对应读取证明。`);
}
/** 宿主没注入解析器、或原生读取失败时，锚点缺席（写入退回失败关闭，而不是丢掉安全性）。 */
async function resolveParamChildHashes(resolver, containerPath, targets) {
    if (resolver === undefined)
        return targets.map(() => undefined);
    try {
        const hashes = await resolver(containerPath, targets);
        // 位置对齐是契约的一部分：长度不符时整批按「没有锚点」处理，绝不把另一张表的哈希
        // 安到这张表上。
        return hashes.length === targets.length ? hashes : targets.map(() => undefined);
    }
    catch {
        return targets.map(() => undefined);
    }
}
function taeInsertionRequirements(input, outerKey, templateKey) {
    const record = recordOf(input);
    const events = record.events;
    if (!Array.isArray(events) || events.length === 0)
        throw new Error('WRITE_REQUIREMENT_EMPTY_EDITS');
    return events.flatMap(raw => {
        const event = recordOf(raw);
        const template = recordOf(event.template);
        const target = parseActionAddress(stringOf(event.address) ?? '');
        const source = parseTaeAddress(stringOf(template.address) ?? '');
        if (!target || target.animId === undefined || target.eventIndex !== undefined || !source)
            throw new Error('WRITE_REQUIREMENT_MISSING_FIELD');
        const sourceKey = stringOf(template.file) ? templateKey(stringOf(template.file)) : outerKey;
        const fields = Array.isArray(event.fields) ? event.fields.flatMap(rawField => {
            const field = recordOf(rawField);
            return [...(stringOf(field.fieldName) ? [stringOf(field.fieldName)] : []),
                ...(intOf(field.fieldIndex) === undefined ? [] : [`fieldIndex:${intOf(field.fieldIndex)}`])];
        }) : [];
        return [{ objectKey: taeActionKey(outerKey, target.chr, target.animId, target), outerSourceKey: outerKey,
                requiredFields: ['actionIdentity'], requiredShape: 'fields' },
            { objectKey: taeObjectKey(sourceKey, source.chrId, source.animId, source.eventIndex, source), outerSourceKey: sourceKey,
                requiredFields: ['eventTypeId', ...fields], requiredShape: 'fields' }];
    });
}
function probeInputFor(tool) {
    switch (tool) {
        case 'mutate_param_fields': return { edits: [{ table: 'T', rowId: 1, fieldId: 'f', value: 1 }] };
        case 'create_param_row': return { table: 'T', rowId: 2, rowName: 'new row' };
        case 'mutate_fmg_entries': return { entries: [{ table: 'T', textId: 1 }] };
        case 'apply_emevd_dsl': return { events: [{ eventId: 1 }] };
        case 'mutate_luabnd_script': return { childChain: ['a.lua'] };
        case 'insert_tae_events': return { file: 'c0000.tae', events: [{ address: 'c0000#A1', template: { address: 'c0000#A1.e0' } }] };
        case 'mutate_tae_event_times': return { taeEntryIndex: 0, animId: 1, eventIndex: 0 };
        case 'mutate_tae_event_fields': return { taeEntryIndex: 0, animId: 1, eventIndex: 0, fieldIndex: 0, value: 1 };
        case 'mutate_msb_part_transform': return { parts: [{ nativeObjectKey: 'k' }] };
        case 'batch_transform_map_objects': return { parts: [{ nativeObjectKey: 'k' }] };
        case 'import_map_from_blender': return {};
        case 'commit_patch': return { changes: [{ tool: 'mutate_param_fields', args: { edits: [{ table: 'T', rowId: 1, fieldId: 'f', value: 1 }] } }] };
        default: return {};
    }
}
//# sourceMappingURL=writeRequirements.js.map