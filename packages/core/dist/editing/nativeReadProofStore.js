/** T09 宿主读取证明：内部事实，不是台账表单；不暴露给模型。 */
import { describeObjectKey } from './proofIdentities.js';
export class ProofError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.code = code;
    }
}
function isValidDeliveredPage(range) {
    if (!range)
        return false;
    const { startByte, endByte, totalUtf8Bytes, fullTextHash } = range;
    return Number.isSafeInteger(startByte) && Number.isSafeInteger(endByte) && Number.isSafeInteger(totalUtf8Bytes)
        && typeof fullTextHash === 'string' && fullTextHash.length > 0
        && startByte >= 0 && endByte >= startByte && endByte <= totalUtf8Bytes && totalUtf8Bytes >= 0;
}
/** 页并集是否恰好覆盖 [0, total)：缺一字节即不完整；重复页不增加覆盖。 */
function textPagesCoverFull(pages) {
    if (pages.length === 0)
        return false;
    const total = pages[0].totalUtf8Bytes;
    const hash = pages[0].fullTextHash;
    if (!pages.every((page) => page.totalUtf8Bytes === total && page.fullTextHash === hash))
        return false;
    const sorted = [...pages].sort((a, b) => a.startByte - b.startByte);
    let covered = 0;
    for (const page of sorted) {
        if (page.startByte > covered)
            return false;
        covered = Math.max(covered, page.endByte);
    }
    return covered === total;
}
/** [start,end) 是否被页并集完全包含。 */
function textPagesCoverRange(pages, startByte, endByte) {
    if (pages.length === 0)
        return false;
    const sorted = [...pages].sort((a, b) => a.startByte - b.startByte);
    let cursor = startByte;
    for (const page of sorted) {
        if (page.startByte > cursor)
            return false;
        if (page.endByte > cursor)
            cursor = Math.min(page.endByte, endByte);
        if (cursor >= endByte)
            return true;
    }
    return cursor >= endByte;
}
function isValidItemRange(range) {
    if (!range)
        return false;
    const { startIndex, endIndex, totalItems } = range;
    if (range.pageSize !== undefined && (!Number.isSafeInteger(range.pageSize) || range.pageSize < 1))
        return false;
    return Number.isSafeInteger(startIndex) && Number.isSafeInteger(endIndex) && Number.isSafeInteger(totalItems)
        && startIndex >= 0 && endIndex >= startIndex && totalItems >= 0 && endIndex <= totalItems;
}
/** 集合切片并集是否恰好覆盖 [0, total)：缺一条即不完整；重复页不增加覆盖。 */
function itemPagesCoverFull(pages) {
    if (pages.length === 0)
        return false;
    const total = pages[0].totalItems;
    if (!pages.every((page) => page.totalItems === total))
        return false;
    const sorted = [...pages].sort((a, b) => a.startIndex - b.startIndex);
    let covered = 0;
    for (const page of sorted) {
        if (page.startIndex > covered)
            return false;
        covered = Math.max(covered, page.endIndex);
    }
    return covered === total;
}
/** 集合切片并集没覆盖到的连续区间（用于点名「缺哪几段」）。 */
function itemPageGaps(pages) {
    if (pages.length === 0)
        return [];
    const total = pages[0].totalItems;
    const sorted = pages
        .filter((page) => page.totalItems === total)
        .sort((a, b) => a.startIndex - b.startIndex);
    const gaps = [];
    let covered = 0;
    for (const page of sorted) {
        if (page.startIndex > covered)
            gaps.push({ start: covered, end: Math.min(page.startIndex, total) });
        covered = Math.max(covered, page.endIndex);
        if (covered >= total)
            break;
    }
    if (covered < total)
        gaps.push({ start: covered, end: total });
    return gaps;
}
/** 页并集实际覆盖的条目数（重叠页只算一次），用于诊断里的「只覆盖 X/Y」。 */
function coveredItemCount(pages) {
    if (pages.length === 0)
        return 0;
    const sorted = [...pages].sort((a, b) => a.startIndex - b.startIndex);
    let covered = 0;
    let coveredCount = 0;
    for (const page of sorted) {
        const start = Math.max(page.startIndex, covered);
        if (page.endIndex > start)
            coveredCount += page.endIndex - start;
        covered = Math.max(covered, page.endIndex);
    }
    return coveredCount;
}
function describeIndexRange(start, end) {
    return end - start <= 1 ? String(start) : `${start}–${end - 1}`;
}
/** 缺口语义化：所有页使用同一页宽且对齐时，给出「第 N–M 页」。 */
function describeGapPages(gaps, pages) {
    const sizes = new Set(pages.map((page) => page.pageSize).filter((size) => size !== undefined));
    if (sizes.size !== 1)
        return '';
    const size = [...sizes][0];
    return `（按 ${size} 条/页即第 ${gaps.map((gap) => {
        const first = Math.floor(gap.start / size) + 1;
        const last = Math.max(first, Math.ceil(gap.end / size));
        return first === last ? String(first) : `${first}–${last}`;
    }).join('、')} 页）`;
}
function coverageDomainFor(objectKey) {
    if (objectKey.startsWith('param-table|')) {
        return {
            noun: '行',
            action: '新建行',
            resume: (start) => `从 rowOffset=${start} 继续 read_param_fields（allRows:true，rowLimit 自定），直到 hasMore=false`
        };
    }
    if (objectKey.startsWith('fmg-container|')) {
        return {
            noun: '条目',
            action: '新增条目',
            resume: (start) => `从 offset=${start} 继续 read_fmg_entries（allEntries:true，table/containerPath 与本次相同），直到 hasMore=false`
        };
    }
    return {
        noun: '事件',
        action: '新建事件',
        resume: (start) => `从 offset=${start} 继续 read_emevd_outline，直到 hasMore=false`
    };
}
function describeItemPageGaps(pages, domain) {
    const gaps = itemPageGaps(pages);
    if (gaps.length === 0)
        return '';
    const ranges = gaps.map((gap) => describeIndexRange(gap.start, gap.end)).join('、');
    return `缺${domain.noun}索引 ${ranges}${describeGapPages(gaps, pages)}`;
}
/**
 * 「读了一部分页」的诊断：这不是「没读过」，缺的是可以点名的那几段。
 *
 * 旧实现把整份集合证明压成一个键，任何一页都会把它写成「整份已交付」，
 * 于是只读 256 条事件 / 128 行 / 64 条目也能新建；反过来调用方也无法从报错里知道还差哪些页。
 */
function itemSetPartialMessage(objectKey, pages) {
    const domain = coverageDomainFor(objectKey);
    const total = pages[0]?.totalItems ?? 0;
    const delivered = coveredItemCount(pages);
    const gaps = itemPageGaps(pages);
    const resume = gaps.length > 0 ? domain.resume(gaps[0].start) : `重新用 ${domain.resume(0).split(' ')[1] ?? '读取工具'} 读完整集`;
    return describeObjectKey(objectKey) + '：已交付的页只覆盖 '
        + `${Math.min(delivered, total)}/${total} 条${domain.noun}，${describeItemPageGaps(pages, domain)}；`
        + `翻页本身不会「顶掉」前面的页（同版本同集合哈希的页会累积），但只读一部分不能授权${domain.action}。`
        + `请按 hasMore/nextOffset ${resume} 再写。`;
}
function versionsMatch(stored, required) {
    if (stored.generation !== undefined && required.generation !== undefined && stored.generation !== required.generation)
        return false;
    if (stored.outerFileHash !== undefined && required.outerFileHash !== undefined && stored.outerFileHash !== required.outerFileHash)
        return false;
    if (stored.childHash !== undefined && required.childHash !== undefined && stored.childHash !== required.childHash)
        return false;
    if (stored.sourceRevision !== undefined && required.sourceRevision !== undefined && stored.sourceRevision !== required.sourceRevision)
        return false;
    return true;
}
/** 写入要求是否携带了可用于「证明仍未过期」的版本锚点。 */
function hasVersionAnchor(version) {
    return version.childHash !== undefined || version.outerFileHash !== undefined
        || version.sourceRevision !== undefined || version.generation !== undefined;
}
export function createNativeReadProofStore() {
    const proofs = new Map();
    let disposed = false;
    function keyFor(principal, workspaceId, objectKey) {
        return `${principal}|${workspaceId}|${objectKey}`;
    }
    // "no delivered read" was also what a stale rowIndex produced, so a caller that HAD read the row was told
    // it never had, and lost a write to a wrong conclusion. A row slot is part of the object key: when the
    // exact key is missing but the same table/row/field was read under another slot, say so and say which.
    // Reading with a table alias (NPC_PARAM_ST) and writing with another spelling of the same table
    // (NpcParam) produced a key that missed, and the write was refused as "no delivered read" even
    // though the row had just been read. The physical row slot, field and outer source still identify
    // the same row, so a table spelling difference must not invalidate the proof.
    //
    // A native type can also back several physical children (ATK_PARAM_ST ->
    // AtkParam_Npc + AtkParam_Pc).  A logical write spelling may therefore match
    // a physical read proof, but only when this exact row/field was read from
    // exactly one physical child: reading AtkParam_Npc must never authorize its
    // sibling AtkParam_Pc.
    const PARAM_TABLE_ALIASES = Object.freeze({
        attackparam: 'atkparam'
    });
    function paramTableProofKey(value) {
        const compact = value.replace(/[^a-z0-9]/giu, '').toLowerCase();
        const withoutTypeSuffix = compact.endsWith('st') && compact.length > 2 ? compact.slice(0, -2) : compact;
        return PARAM_TABLE_ALIASES[withoutTypeSuffix] ?? withoutTypeSuffix;
    }
    function tableAliasMatches(stored, target) {
        const storedKey = paramTableProofKey(stored);
        const targetKey = paramTableProofKey(target);
        if (storedKey === targetKey)
            return true;
        // A logical family name (atkparam) names a physical child (atkparamnpc);
        // an explicit child never matches its sibling.
        return targetKey.length >= 4 && storedKey.startsWith(targetKey);
    }
    function findAliasProof(principal, workspaceId, objectKey) {
        const target = objectKey.split('|');
        if (target[0] !== 'param' || target.length < 6)
            return undefined;
        const base = principal + '|' + workspaceId + '|';
        const matches = [];
        for (const [key, proof] of proofs) {
            if (!key.startsWith(base))
                continue;
            const parts = key.slice(base.length).split('|');
            if (parts.length < 6 || parts[0] !== 'param')
                continue;
            if (parts[1] !== target[1])
                continue;
            if (parts[3] !== target[3] || parts[4] !== target[4] || parts[5] !== target[5])
                continue;
            if (!tableAliasMatches(parts[2] ?? '', target[2] ?? ''))
                continue;
            matches.push({ proof, table: parts[2] ?? '' });
        }
        if (matches.length === 0)
            return undefined;
        if (new Set(matches.map((match) => paramTableProofKey(match.table))).size !== 1)
            return undefined;
        return matches[0].proof;
    }
    function missingReadMessage(principal, workspaceId, objectKey) {
        const target = objectKey.split('|');
        const base = principal + '|' + workspaceId + '|';
        // The set-shaped proofs (EMEVD event ids / PARAM table rows / FMG table entries) are the ones
        // minted page by page: say both things a caller needs — that the receipt lives only in this
        // session instance (not in a session file, not in another process) and that a write needs ALL
        // pages, not the last one.
        if (target[0] === 'emevd-file' || target[0] === 'param-table' || target[0] === 'fmg-container') {
            const domain = coverageDomainFor(objectKey);
            return 'no delivered read for ' + describeObjectKey(objectKey)
                + '：本 session 进程内没有它的整集读证明。'
                + '读证明只活在产生它的那次 session（同一个 CLI `session` 进程 / 同一次 Agent run / 同一个桌面会话）；'
                + '另一个进程、另一个 `session` 调用或另一份 session 文件里读的都不算，必须在这个 session 里重新读。'
                + `授权${domain.action}前请先把整集翻完：${domain.resume(0)}（页会累积，不会互相顶掉），再写入。`;
        }
        const readSlots = target[0] === 'param' && target.length >= 6
            ? [...proofs.keys()]
                .filter((key) => key.startsWith(base))
                .map((key) => key.slice(base.length).split('|'))
                .filter((parts) => parts.length >= 6 && parts[0] === 'param'
                && parts[2] === target[2] && parts[3] === target[3] && parts[5] === target[5])
                .map((parts) => String(parts[4]))
            : [];
        // Two different situations produced this exact sentence: the target was never read, and the target was
        // read in a batch that also asked for a field the table does not define — that read is incomplete, so no
        // proof is accepted, yet the field the caller wants WAS delivered. Rounds 30 and 31 both hit it and the
        // message sent them back to re-read the same batch. Name the second cause.
        if (readSlots.length === 0)
            return 'no delivered read for ' + describeObjectKey(objectKey)
                + '（如果你刚读过这个目标：一次读里请求了表里不存在的字段会让整次交付作废，即使该字段本身已交付；'
                + '先用 compare_param_rows 或 search_param_fields 确认字段名，只读真实存在的字段后重试）';
        return '本 session 读过 ' + describeObjectKey(objectKey) + '，但行槽不同：读过 ' + readSlots.join(', ')
            + '，这次写入指向 ' + String(target[4]) + '。同一行的不同 rowIndex 必须按目标 rowIndex 重新 read_param_fields 后再写。';
    }
    function describeVersionDelta(storedVersion, requiredVersion) {
        const names = ['outerFileHash', 'childHash', 'sourceRevision', 'generation'];
        // 只比较两侧都给出的维度：写入侧通常只带内容哈希，把 undefined 也写成 now=undefined 只会淹没有效信息。
        const deltas = names
            .filter((name) => storedVersion[name] !== undefined && requiredVersion[name] !== undefined
            && storedVersion[name] !== requiredVersion[name])
            .map((name) => name + ' stored=' + String(storedVersion[name]) + ' now=' + String(requiredVersion[name]));
        return deltas.length === 0 ? 'version fields differ' : deltas.join('；');
    }
    /**
     * 「对象在你读取之后变了」的唯一诊断出口。
     *
     * 这条消息必须回答两件事：这不是「没读过」，以及下一步该做什么。写同一容器的另一张表
     * 不再删掉本表的证明（见 invalidateSourceWhere），所以真正的失效只有两种情况：带着内容
     * 哈希的写入发现子表字节变了，或者该域没有内容锚点、外层源被改过。
     */
    function staleMessage(objectKey, storedVersion, requiredVersion) {
        if (!hasVersionAnchor(requiredVersion)) {
            return describeObjectKey(objectKey) + ' 的读证明在读取之后该资源被写过或外部改动过（不是没读过）：'
                + '重新读取这个目标后立即写入即可。';
        }
        return describeObjectKey(objectKey) + ' 的内容在你读取之后变了（' + describeVersionDelta(storedVersion, requiredVersion)
            + '）：重新读取这个目标后立即写入即可。';
    }
    function markSuspect(sourceKey, generation, matches) {
        let marked = 0;
        for (const [, proof] of proofs) {
            if (proof.outerSourceKey !== sourceKey)
                continue;
            if (matches !== undefined && !matches(proof.objectKey))
                continue;
            proof.suspect = { generation };
            marked += 1;
        }
        if (process.env.SOULFORGE_DEBUG_PROOF === '1') {
            process.stderr.write(`[proof:invalidate] source=${sourceKey} scope=${matches === undefined ? 'all' : 'scoped'} marked=${String(marked)}\n`);
        }
    }
    return {
        acceptDeliveredRead(input) {
            if (disposed)
                throw new ProofError('NATIVE_READ_REQUIRED', 'proof store disposed');
            // 存入防御性拷贝：调用方事后修改传入数组/范围不得污染存储。
            const coveredFields = [...(input.deliveredFields ?? [])];
            const page = input.deliveredTextRange === undefined ? undefined : { ...input.deliveredTextRange };
            if (page !== undefined && !isValidDeliveredPage(page)) {
                throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'invalid delivered text page range');
            }
            const itemRanges = input.deliveredItemRanges === undefined
                ? undefined
                : input.deliveredItemRanges.map((range) => ({ ...range }));
            if (itemRanges !== undefined) {
                if (itemRanges.length === 0 || !itemRanges.every((range) => isValidItemRange(range))
                    || new Set(itemRanges.map((range) => range.totalItems)).size !== 1) {
                    throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'invalid delivered item page range');
                }
            }
            const key = keyFor(input.principal, input.workspaceId, input.objectKey);
            const fullShape = input.readShape === 'full-event' || input.readShape === 'full-script';
            const existing = proofs.get(key);
            // 全文分页合并：同形状、同版本、同总长度、同全文哈希的页记入同一账本；
            // 跨版本/跨哈希/跨形状另起账本，旧页不得参与新全文证明（P14）。
            if (fullShape && page !== undefined && existing !== undefined
                && existing.readShape === input.readShape
                && versionsMatch(existing.version, input.version)
                && existing.deliveredPages.length > 0
                && existing.deliveredPages[0].totalUtf8Bytes === page.totalUtf8Bytes
                && existing.deliveredPages[0].fullTextHash === page.fullTextHash) {
                const duplicate = existing.deliveredPages.some((known) => known.startByte === page.startByte && known.endByte === page.endByte);
                if (!duplicate)
                    existing.deliveredPages.push(page);
                existing.deliveredTextRange = { ...page };
                // 新送达的页属于同一版本，这份证明重新成立。
                delete existing.suspect;
                return;
            }
            // 集合型分页合并：同形状、同版本（内容哈希）、同集合总数的切片记入同一账本。
            // 这正是「翻完全部页 = 一次读完」的机制：页只累积，后一页不会顶掉前一页的覆盖。
            if (itemRanges !== undefined && existing !== undefined
                && existing.readShape === input.readShape
                && versionsMatch(existing.version, input.version)
                && existing.deliveredItemPages.length > 0
                && existing.deliveredItemPages[0].totalItems === itemRanges[0].totalItems
                && existing.version.childHash !== undefined
                && existing.version.childHash === input.version.childHash) {
                for (const range of itemRanges) {
                    const duplicate = existing.deliveredItemPages.some((known) => known.startIndex === range.startIndex && known.endIndex === range.endIndex);
                    if (!duplicate)
                        existing.deliveredItemPages.push(range);
                }
                // 新送达的页属于同一版本，这份证明重新成立。
                delete existing.suspect;
                return;
            }
            const stored = {
                principal: input.principal,
                workspaceId: input.workspaceId,
                objectKey: input.objectKey,
                outerSourceKey: input.outerSourceKey,
                version: { ...input.version },
                coveredFields,
                readShape: input.readShape,
                deliveredPages: page === undefined ? [] : [page],
                deliveredItemPages: itemRanges ?? []
            };
            if (page !== undefined)
                stored.deliveredTextRange = { ...page };
            if (input.capability !== undefined)
                stored.capability = input.capability;
            proofs.set(key, stored);
        },
        requireCoverage(input) {
            if (disposed)
                throw new ProofError('NATIVE_READ_REQUIRED', 'proof store unavailable; fail closed');
            let stored = proofs.get(keyFor(input.principal, input.workspaceId, input.objectKey));
            if (!stored)
                stored = findAliasProof(input.principal, input.workspaceId, input.objectKey);
            if (!stored)
                throw new ProofError('NATIVE_READ_REQUIRED', missingReadMessage(input.principal, input.workspaceId, input.objectKey));
            if (stored.outerSourceKey !== input.outerSourceKey) {
                throw new ProofError('NATIVE_READ_REQUIRED', 'outer source mismatch');
            }
            // 外层源在读取之后变过。带内容锚点的写入（PARAM 子表哈希）可以自证「我读的那份内容没变」，
            // 于是同一容器里另一张表被写过也不影响本表；没有锚点的域保持失败关闭。
            if (stored.suspect !== undefined
                && !(hasVersionAnchor(input.version) && versionsMatch(stored.version, input.version))) {
                throw new ProofError('NATIVE_READ_STALE', staleMessage(stored.objectKey, stored.version, input.version));
            }
            if (!versionsMatch(stored.version, input.version)) {
                throw new ProofError('NATIVE_READ_STALE', staleMessage(stored.objectKey, stored.version, input.version));
            }
            if (input.requiredItemSet === true) {
                // 集合型对象是「按页交付、按并集成立」的证明：单页只证明那一页，不证明整个集合。
                const itemPages = stored.deliveredItemPages;
                if (stored.version.childHash === undefined || itemPages.length === 0) {
                    const domain = coverageDomainFor(stored.objectKey);
                    throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', describeObjectKey(stored.objectKey) + '：这次读取没有交付可校验的整集页（没有集合内容哈希或页区间），'
                        + `不能授权${domain.action}；请用 ${domain.resume(0)}。`);
                }
                if (!itemPagesCoverFull(itemPages)) {
                    throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', itemSetPartialMessage(stored.objectKey, itemPages));
                }
            }
            if (input.requiredShape === 'full-event' || input.requiredShape === 'full-script') {
                if (stored.readShape !== input.requiredShape) {
                    throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'fragment/outline cannot authorize whole-object replacement');
                }
                // 账本优先：多页并集判定；无账本时回退单范围判定（兼容旧调用）。
                const pages = stored.deliveredPages.length > 0
                    ? stored.deliveredPages
                    : (stored.deliveredTextRange && isValidDeliveredPage(stored.deliveredTextRange) ? [stored.deliveredTextRange] : []);
                if (input.requiredTextRange) {
                    const { startByte, endByte } = input.requiredTextRange;
                    if (!Number.isSafeInteger(startByte) || !Number.isSafeInteger(endByte) || startByte < 0 || endByte < startByte
                        || !textPagesCoverRange(pages, startByte, endByte)) {
                        throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'required range exceeds delivered range');
                    }
                }
                else if (!textPagesCoverFull(pages)) {
                    throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', 'whole-object proof requires full delivered range');
                }
            }
            if (input.requiredFields) {
                const missing = input.requiredFields.filter((field) => !stored.coveredFields.includes(field));
                if (missing.length > 0) {
                    throw new ProofError('NATIVE_READ_COVERAGE_INCOMPLETE', `payload fields not delivered: ${missing.join(',')}`);
                }
            }
            return { objectKey: stored.objectKey, outerSourceKey: stored.outerSourceKey, version: { ...stored.version }, coveredFields: [...stored.coveredFields] };
        },
        invalidateSource(sourceKey, generation) {
            markSuspect(sourceKey, generation);
        },
        invalidateSourceWhere(sourceKey, generation, matches) {
            markSuspect(sourceKey, generation, matches);
        },
        invalidateAll(_reason) {
            proofs.clear();
        },
        dispose() {
            disposed = true;
            proofs.clear();
        }
    };
}
//# sourceMappingURL=nativeReadProofStore.js.map