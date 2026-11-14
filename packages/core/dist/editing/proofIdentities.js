/** T09 证明身份：读写两侧用同一推导规则产生对象键与外层源键；编造不出键就失败关闭。 */
import { createHash } from 'node:crypto';
import { statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseActionAddress } from '@soulforge/shared';
import { canonicalFmgTableName } from './fmgTableNames.js';
/**
 * PARAM 整表对象键：param-table|外层|规范表。
 *
 * 新建行没有既有行可读，能证明的只有「整张表的行集合被观察过」。它绑定子表内容哈希
 * （version.childHash）并按已交付的物理行索引区间累积，只有页并集覆盖 [0, rowCount)
 * 才能授权新建行；行 id 是否已占用仍由 writer 对自己的新读取判定。
 */
export function paramTableObjectKey(input) {
    return [
        'param-table',
        input.outerKey,
        input.table.toLocaleLowerCase().replace(/[^a-z0-9]/gu, '')
    ].join('|');
}
export function paramTableDeliveredRead(input) {
    const outerKey = paramOuterKey(input.containerPath);
    return {
        principal: input.principal,
        workspaceId: input.workspaceId,
        objectKey: paramTableObjectKey({ outerKey, table: input.table }),
        outerSourceKey: outerKey,
        version: {
            ...(input.sourceHash === undefined ? {} : { childHash: input.sourceHash })
        },
        deliveredFields: [],
        readShape: 'fields',
        ...(input.rowRange === undefined ? {} : {
            deliveredItemRanges: [{
                    startIndex: input.rowRange.startIndex,
                    endIndex: input.rowRange.endIndex,
                    totalItems: input.rowRange.totalRows,
                    ...(input.rowRange.pageSize === undefined ? {} : { pageSize: input.rowRange.pageSize })
                }]
        })
    };
}
/**
 * 外层源键：已解析的绝对路径 → file URL。
 * 裸相对串必须先相对 overlayRoot 解析；解析不出或非文件即失败关闭，
 * 不得用未解析串作键（同容器两种拼写会分裂证明域）。
 */
export function outerFileKey(overlayRoot, raw) {
    if (typeof raw !== 'string' || raw.trim() === '')
        throw new Error('PROOF_IDENTITY_NO_FILE');
    let clean = raw.trim();
    if (clean.startsWith('file:///')) {
        try {
            clean = fileURLToPath(clean);
        }
        catch {
            clean = clean.slice(8);
        }
    }
    else if (clean.startsWith('file://')) {
        clean = clean.slice(7);
    }
    const resolved = isAbsolute(clean) ? resolve(clean) : overlayRoot ? resolve(overlayRoot, clean) : null;
    if (!resolved)
        throw new Error('PROOF_IDENTITY_NO_FILE');
    try {
        if (!statSync(resolved).isFile())
            throw new Error('PROOF_IDENTITY_NOT_FILE');
    }
    catch {
        throw new Error('PROOF_IDENTITY_NOT_FILE');
    }
    return pathToFileURL(resolved).href;
}
export function paramOuterKey(containerPath) {
    return pathToFileURL(containerPath).href;
}
/**
 * PARAM 对象键：param|外层|规范表|行|行槽|字段。
 * 行槽缺失时不编造：带 rowIndex 的写入将匹配不到，必须用 rowIndex 重读。
 * entryName 不进入键：写入侧没有该维度；物理行绑定由 writer 的
 * rowIndex + expectedDataHash 精确保证，证明只管“读过该逻辑字段”。
 */
export function paramObjectKey(input) {
    const normalizedTable = input.table.toLocaleLowerCase().replace(/[^a-z0-9]/gu, '');
    return [
        'param',
        input.outerKey,
        normalizedTable,
        String(input.rowId),
        input.rowIndex === undefined ? 'row' : `rowIndex:${String(input.rowIndex)}`,
        input.fieldId
    ].join('|');
}
/**
 * Human-readable form of a proof object key for diagnostics.
 *
 * Keys embed the physical container URI, so a raw key inside an error message gets masked by the
 * path sanitizer and the caller only sees `param|[本机路径已隐藏]` — losing the table, row and field
 * that would tell it what to re-read. Report the logical identity instead.
 */
export function describeObjectKey(objectKey) {
    const parts = objectKey.split('|');
    if (parts[0] === 'param' && parts.length >= 6) {
        return `PARAM ${parts[2]}#${parts[3]} field ${parts[5]}`;
    }
    if (parts[0] === 'event' && parts.length >= 3)
        return `EMEVD event ${parts.slice(1).join('|')}`;
    if (parts[0] === 'emevd-file')
        return 'EMEVD 文件的完整事件 id 集合';
    if (parts[0] === 'param-table' && parts.length >= 3)
        return `PARAM 表 ${parts[2]} 的整表行集`;
    if (parts[0] === 'fmg-container' && parts.length >= 3)
        return `FMG 表 ${parts[2]} 的整表条目集`;
    // Mask whole file URIs before bare drive paths: the drive pattern also matches the "e:/" inside
    // "file:///D:/..." and used to leave a broken "fil<workspace>" fragment.
    return objectKey
        .replace(/file:\/\/[^|!]*/gu, '<workspace>')
        .replace(/(?<![A-Za-z])[A-Za-z]:[\\/][^|]*/gu, '<workspace>');
}
/** 与 paramObjectKey 相同的表名规范化：证明键里存的就是这个形态。 */
function paramProofTableToken(value) {
    return value.toLocaleLowerCase().replace(/[^a-z0-9]/gu, '');
}
/**
 * 「这些子表」的证明选择器：写 A 表只让 A 表的读证明过期。
 *
 * PARAM 容器里的每个子表（NpcParam / ItemLotParam …）各自是一份独立原生文档，写一张表只替换
 * 那个子项的字节。按外层容器整片失效，会让「读 ItemLot → 写 Npc → 写 ItemLot」在最后一步
 * 拿到 NATIVE_READ_REQUIRED：那张表其实一个字节都没变。
 */
export function paramProofTableMatcher(tables) {
    const wanted = new Set(tables.map(paramProofTableToken).filter((table) => table !== ''));
    return (objectKey) => {
        if (wanted.size === 0)
            return false;
        const parts = objectKey.split('|');
        // Row/field proofs (`param|outer|table|row|slot|field`) and the table-level proof a row
        // creation reads (`param-table|outer|table`) both name the table in segment 2.
        if (parts[0] === 'param' && parts.length >= 6)
            return wanted.has(parts[2] ?? '');
        if (parts[0] === 'param-table' && parts.length >= 3)
            return wanted.has(parts[2] ?? '');
        return false;
    };
}
/**
 * 「这些 TAE 段」的证明选择器。键的第 4 段是段身份（index:N / id:N / name:… / group:…）；
 * 一个容器里的每个 .tae 段是独立子项，写第 N 段不影响第 M 段的词条。
 *
 * 无法定位到具体段的键（单段容器的无段身份）按保守处理：一并失效。
 */
export function taeProofEntryMatcher(indexes) {
    const wanted = new Set(indexes.filter((index) => Number.isSafeInteger(index) && index >= 0));
    return (objectKey) => {
        if (wanted.size === 0)
            return false;
        const parts = objectKey.split('|');
        if (parts[0] !== 'tae' || parts.length < 6)
            return false;
        const match = /^index:(\d+)$/u.exec(parts[3] ?? '');
        if (match === null)
            return true;
        return wanted.has(Number(match[1]));
    };
}
/** 原生读取结果 → 逐字段已送达证明（调用方保证这些字段确在最终 envelope 中）。 */
export function paramDeliveredReads(input) {
    const outerKey = paramOuterKey(input.containerPath);
    return input.fields
        .filter((field) => typeof field.fieldId === 'string' && field.fieldId.trim() !== '')
        .map((field) => ({
        principal: input.principal,
        workspaceId: input.workspaceId,
        objectKey: paramObjectKey({
            outerKey,
            table: field.table,
            rowId: field.rowId,
            ...(field.rowIndex === undefined ? {} : { rowIndex: field.rowIndex }),
            fieldId: field.fieldId
        }),
        outerSourceKey: outerKey,
        version: {
            ...(field.sourceHash === undefined ? {} : { childHash: field.sourceHash }),
            ...(field.sourceRevision === undefined ? {} : { sourceRevision: field.sourceRevision })
        },
        deliveredFields: [field.fieldId],
        readShape: 'fields'
    }));
}
export function emevdObjectKey(sourceUri, eventId) {
    return `emevd|${sourceUri}|${String(eventId)}`;
}
/**
 * File-level EMEVD identity: the event id set of one source resource.
 *
 * Creating an event has no target content to read, so the per-event
 * `full-event` receipt can never exist. The guarantee that replaces it is the
 * one the caller could actually have obtained: the file's event set, delivered
 * by `read_emevd_outline`. It pins the source version (so a stale file cannot
 * be written) and it is the only read that shows which ids are already taken.
 */
export function emevdFileObjectKey(sourceUri) {
    return `emevd-file|${sourceUri}`;
}
/** Whole-file event-set delivery proof; minted only from a canonical outline read. */
export function emevdFileSetDeliveredRead(input) {
    return {
        principal: input.principal,
        workspaceId: input.workspaceId,
        objectKey: emevdFileObjectKey(input.canonicalSourceUri),
        outerSourceKey: input.canonicalSourceUri,
        version: { ...input.version },
        deliveredFields: ['event-set'],
        // `fields` is the shape for "these named facts were delivered"; the proof is
        // scoped by the source version, not by a whole-object text range.
        readShape: 'fields',
        ...(input.eventRange === undefined ? {} : {
            deliveredItemRanges: [{
                    startIndex: input.eventRange.startIndex,
                    endIndex: input.eventRange.endIndex,
                    totalItems: input.eventRange.totalEvents,
                    ...(input.eventRange.pageSize === undefined ? {} : { pageSize: input.eventRange.pageSize })
                }]
        }),
        ...(Number.isSafeInteger(input.eventCount) && input.eventCount >= 0
            ? { capability: `event-set:${String(input.eventCount)}` }
            : {})
    };
}
/**
 * 整事件已送达证明：对宿主确认的完整 DSL 文本哈希定界。
 * 只有桥接器验证过 complete_native_dsl + complete + 未截断才调用此处。
 */
export function emevdDeliveredRead(input) {
    const totalUtf8Bytes = Buffer.byteLength(input.dslText, 'utf8');
    return {
        principal: input.principal,
        workspaceId: input.workspaceId,
        objectKey: emevdObjectKey(input.canonicalSourceUri, input.eventId),
        outerSourceKey: input.canonicalSourceUri,
        version: { ...input.version },
        readShape: 'full-event',
        deliveredTextRange: {
            startByte: 0,
            endByte: totalUtf8Bytes,
            totalUtf8Bytes,
            fullTextHash: createHash('sha256').update(input.dslText, 'utf8').digest('hex')
        },
        ...(input.capability === undefined ? {} : { capability: input.capability })
    };
}
/** One identity for a script body: the container plus the child path inside it. */
export function scriptObjectKey(outerKey, childPath) {
    return `script|${outerKey}!/${childPath.replaceAll('\\', '/')}`;
}
/** Whole-script delivery proof; only a complete source read may produce it. */
export function scriptDeliveredRead(input) {
    const totalUtf8Bytes = Buffer.byteLength(input.sourceText, 'utf8');
    return {
        principal: input.principal,
        workspaceId: input.workspaceId,
        objectKey: scriptObjectKey(input.outerKey, input.childPath),
        outerSourceKey: input.outerKey,
        version: { ...input.version },
        readShape: 'full-script',
        deliveredTextRange: {
            startByte: 0,
            endByte: totalUtf8Bytes,
            totalUtf8Bytes,
            fullTextHash: createHash('sha256').update(input.sourceText, 'utf8').digest('hex')
        }
    };
}
export function fmgObjectKey(outerKey, table, id) {
    // The read side records the resolved native table name (アイテム名) while a write may name the same
    // table ItemName; canonicalizing both keeps one identity for one table.
    return `fmg|${outerKey}|${canonicalFmgTableName(table)}|${String(id)}`;
}
export function fmgContainerKey(outerKey, table) {
    return `fmg-container|${outerKey}|${canonicalFmgTableName(table)}`;
}
/**
 * FMG 已送达证明：读过的条目逐条记键；条目级证明只授权对这些条目的改写。
 *
 * 新增条目没有既有条目可读，它凭的是「整张表的条目集合已交付」的容器级证明（见
 * fmgContainerDeliveredRead），单个条目或单页条目不足以证明整表。
 */
export function fmgDeliveredReads(input) {
    return input.entries
        .filter((entry) => Number.isSafeInteger(entry.id))
        .map((entry) => ({
        principal: input.principal,
        workspaceId: input.workspaceId,
        objectKey: fmgObjectKey(input.outerKey, entry.table ?? input.table, entry.id),
        outerSourceKey: input.outerKey,
        version: {
            ...(typeof entry.sourceHash === 'string' ? { childHash: entry.sourceHash } : {}),
            ...(typeof entry.sourceRevision === 'number' ? { sourceRevision: entry.sourceRevision } : {})
        },
        deliveredFields: ['text'],
        readShape: 'fields'
    }));
}
/**
 * FMG 容器级读取证明：只由能自述「这一页覆盖整表哪些条目序号」的读取铸造。
 *
 * 它绑定容器内容哈希（version.childHash），所以容器被写过后页账本另起；条目集合的
 * 页并集覆盖 [0, entryCount) 才能授权新增条目。
 */
export function fmgContainerDeliveredRead(input) {
    return {
        principal: input.principal,
        workspaceId: input.workspaceId,
        objectKey: fmgContainerKey(input.outerKey, input.table),
        outerSourceKey: input.outerKey,
        version: {
            ...(input.sourceHash === undefined ? {} : { childHash: input.sourceHash })
        },
        deliveredFields: [],
        readShape: 'fields',
        ...(input.entryRange === undefined ? {} : {
            deliveredItemRanges: [{
                    startIndex: input.entryRange.startIndex,
                    endIndex: input.entryRange.endIndex,
                    totalItems: input.entryRange.totalEntries,
                    ...(input.entryRange.pageSize === undefined ? {} : { pageSize: input.entryRange.pageSize })
                }]
        })
    };
}
export function taeObjectKey(outerKey, chrId, animId, eventIndex, section) {
    const sectionKey = section?.taeEntryIndex !== undefined
        ? `index:${section.taeEntryIndex}`
        : section?.taeEntryId !== undefined
            ? `id:${section.taeEntryId}`
            : section?.taeEntryName !== undefined
                ? `name:${section.taeEntryName.toLowerCase()}`
                : section?.taeGroup !== undefined
                    ? `group:${section.taeGroup.toLowerCase()}`
                    : 'tae';
    return `tae|${outerKey}|${chrId}|${sectionKey}|${String(animId)}|${String(eventIndex)}`;
}
export function taeActionKey(outerKey, chrId, animId, section) {
    return `${taeObjectKey(outerKey, chrId, animId, 0, section).slice(0, -2)}|action`;
}
/** 从动作地址 `c1050#A0200.e0` 解析身份；拼写非法返回 null。 */
export function parseTaeAddress(address) {
    const parsed = parseActionAddress(address);
    if (!parsed || parsed.animId === undefined || parsed.eventIndex === undefined)
        return null;
    return {
        chrId: parsed.chr,
        animId: parsed.animId,
        eventIndex: parsed.eventIndex,
        ...(parsed.taeEntryIndex === undefined ? {} : { taeEntryIndex: parsed.taeEntryIndex }),
        ...(parsed.taeEntryId === undefined ? {} : { taeEntryId: parsed.taeEntryId }),
        ...(parsed.taeEntryName === undefined ? {} : { taeEntryName: parsed.taeEntryName }),
        ...(parsed.taeGroup === undefined ? {} : { taeGroup: parsed.taeGroup })
    };
}
export function taeDeliveredReads(input) {
    return input.events
        .filter((event) => Number.isSafeInteger(event.animId) && Number.isSafeInteger(event.eventIndex))
        .flatMap((event) => {
        const chrId = event.chrId ?? input.chrId;
        const deliveredFields = [
            ...(typeof event.eventTypeId === 'number' ? ['eventTypeId'] : []),
            ...(typeof event.startFrame === 'number' ? ['startFrame'] : []),
            ...(typeof event.endFrame === 'number' ? ['endFrame'] : []),
            ...(event.fieldNames ?? []),
            ...(event.fieldIndices ?? []).map((index) => `fieldIndex:${index}`)
        ];
        const sectioned = [{
                principal: input.principal,
                workspaceId: input.workspaceId,
                objectKey: taeObjectKey(input.outerKey, chrId, event.animId, event.eventIndex, event),
                outerSourceKey: input.outerKey,
                version: {},
                deliveredFields,
                readShape: 'fields'
            }, {
                principal: input.principal,
                workspaceId: input.workspaceId,
                objectKey: taeActionKey(input.outerKey, chrId, event.animId, event),
                outerSourceKey: input.outerKey,
                version: {},
                deliveredFields: ['actionIdentity'],
                readShape: 'fields'
            }];
        if (input.singleSection !== true)
            return sectioned;
        const sectionless = [{
                principal: input.principal,
                workspaceId: input.workspaceId,
                objectKey: taeObjectKey(input.outerKey, chrId, event.animId, event.eventIndex),
                outerSourceKey: input.outerKey,
                version: {},
                deliveredFields,
                readShape: 'fields'
            }, {
                principal: input.principal,
                workspaceId: input.workspaceId,
                objectKey: taeActionKey(input.outerKey, chrId, event.animId),
                outerSourceKey: input.outerKey,
                version: {},
                deliveredFields: ['actionIdentity'],
                readShape: 'fields'
            }];
        return [...sectioned, ...sectionless];
    });
}
export function msbObjectKey(outerKey, nativeOffset) {
    return `msb|${outerKey}|${String(nativeOffset)}`;
}
export function msbAddressKey(outerKey, address) {
    // read_msb_parts returns "m11_02_00_00#c5400_0000" while a write target is "c5400_0000"; both name
    // the same part inside this file, so the identity drops the map prefix instead of splitting the key.
    const trimmed = address.trim().toLowerCase();
    const hash = trimmed.indexOf('#');
    return `msb|${outerKey}|address:${hash >= 0 ? trimmed.slice(hash + 1) : trimmed}`;
}
const MSB_TRANSFORM_FIELDS = [
    'posX', 'posY', 'posZ',
    'rotX', 'rotY', 'rotZ',
    'scaleX', 'scaleY', 'scaleZ'
];
export function msbDeliveredReads(input) {
    const proofs = [];
    for (const part of input.parts) {
        const delivered = MSB_TRANSFORM_FIELDS.filter((field) => typeof part[field] === 'number');
        if (typeof part.nativeOffset === 'number' && Number.isSafeInteger(part.nativeOffset)) {
            proofs.push({
                principal: input.principal,
                workspaceId: input.workspaceId,
                objectKey: msbObjectKey(input.outerKey, part.nativeOffset),
                outerSourceKey: input.outerKey,
                version: {},
                deliveredFields: [...delivered],
                readShape: 'fields'
            });
        }
        // 地址键与原生键并存：读侧不知道写侧用哪种引用，两键同义。
        if (typeof part.address === 'string' && part.address.trim() !== '') {
            proofs.push({
                principal: input.principal,
                workspaceId: input.workspaceId,
                objectKey: msbAddressKey(input.outerKey, part.address),
                outerSourceKey: input.outerKey,
                version: {},
                deliveredFields: [...delivered],
                readShape: 'fields'
            });
        }
    }
    return proofs;
}
export function msbModifiedFields(edit) {
    return MSB_TRANSFORM_FIELDS.filter((field) => typeof edit[field] === 'number');
}
//# sourceMappingURL=proofIdentities.js.map