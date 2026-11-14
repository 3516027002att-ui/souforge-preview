/**
 * 动作 / 地图的参数同构编址（问题 6）。
 *
 * 所有 padStart / 正则只准写在这里。各面板、索引、RAG、Agent 工具一律经
 * 本模块解析 / 格式化，禁止各面板手写一份。
 *
 * 地址语法（写死，与 docx/动作与地图Agent编址.docx 与 锐评/grok.txt 问题 6 同口径）：
 *
 *   动作：c1050 · c1050#A0200 · c1050#A0200.e0 · c1050#A0200.e0.startFrame
 *   地图：M11 · m11_01_00_00 · m11_01_00_00#c1050_0000 · m11_01_00_00#c1050_0000.posX
 *
 * symbolUri（稳定，给 RAG / cite）：
 *   action://c1050/A0200/e0
 *   action://c1050/tae/3/A0200/e0
 *   map://m11_01_00_00/part/c1050_0000
 *   map://m11_01_00_00/region/<name>
 *
 * 约定：
 *  - `cXXXX` 从路径 `chr/c1050.anibnd.dcx` / `c1050.chrbnd.dcx` 提取，
 *    正则 `(^|[/\\])c(\d{4})([./\\]|$)`。
 *  - `A0200` = `'A' + String(animId).padStart(4, '0')`，主键恒为 A+animId；
 *    合法 hkx 茎（如 `a000_020000`）只是检索别名，不做第二套主键。
 *  - `eN` 是该动画 `events[]` 的下标（不是 eventTypeId）。
 *  - 块 ID 必须是 `m\d{2}_\d{2}_\d{2}_\d{2}`，下划线是 ID 的一部分。
 *  - 实体名用 MSB part/region 原名，不翻译。
 */
const CHR_RE = /\bc(\d{4})(?![\w])/gi;
const ANIM_CODE_RE = /\bA(\d+)(?![\w])/gi;
const HKX_STEM_RE = /\ba(\d{3})_(\d+)(?![\w])/gi;
const MAP_AREA_RE = /\b[Mm](\d{2})(?![\w])/g;
const MAP_BLOCK_RE = /\bm(\d{2})_(\d{2})_(\d{2})_(\d{2})(?![\w])/g;
const ACTION_ADDR_RE = /\bc\d{4}#(?:A\d+|a\d{3}_\d+)(?![\w])(?:\.e\d+)?(?:\.\w+)?/gi;
const ACTION_URI_ADDR_RE = /\baction:\/\/c\d{4}\/(?:A\d+(?![\w])(?:\/e\d+(?:\.[A-Za-z0-9_]+)?)?|tae\/(?:(?:0|[1-9]\d*)|index\/(?:0|[1-9]\d*)|id\/-?\d+|(?:name|group)\/[^\s/?#]+)\/A\d+(?![\w])(?:\/e\d+(?:\.[A-Za-z0-9_]+)?)?)/gi;
const MAP_ADDR_RE = /\bm\d{2}_\d{2}_\d{2}_\d{2}#[^\s.]*(?:\.[\w]+)?/gi;
function parseSafeIntegerSegment(value, allowNegative, canonical = true) {
    const pattern = canonical
        ? allowNegative ? /^-?(?:0|[1-9]\d*)$/ : /^(?:0|[1-9]\d*)$/
        : allowNegative ? /^-?\d+$/ : /^\d+$/;
    if (!pattern.test(value))
        return null;
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
}
function decodeSectionText(value) {
    let decoded;
    try {
        decoded = decodeURIComponent(value);
    }
    catch {
        return null;
    }
    if (decoded.length === 0 || /[\u0000-\u001f\u007f]/.test(decoded) || /[\\/?#]/.test(decoded))
        return null;
    return decoded;
}
function parseActionSectionSelector(kind, value) {
    const normalizedKind = kind.toLowerCase();
    if (normalizedKind === 'index') {
        if (value === undefined)
            return null;
        const taeEntryIndex = parseSafeIntegerSegment(value, false);
        return taeEntryIndex === null ? null : { taeEntryIndex };
    }
    if (normalizedKind === 'id') {
        if (value === undefined)
            return null;
        const taeEntryId = parseSafeIntegerSegment(value, true);
        return taeEntryId === null ? null : { taeEntryId };
    }
    if (normalizedKind === 'name') {
        const taeEntryName = value === undefined ? null : decodeSectionText(value);
        return taeEntryName === null ? null : { taeEntryName };
    }
    if (normalizedKind === 'group') {
        const taeGroup = value === undefined ? null : decodeSectionText(value);
        return taeGroup === null ? null : { taeGroup };
    }
    return null;
}
function parseActionTail(parts, codeIndex, section) {
    const code = parts[codeIndex];
    if (code === undefined || !/^A\d+$/i.test(code))
        return null;
    const animId = parseAnimCode(code);
    if (animId === null)
        return null;
    if (parts.length > codeIndex + 2)
        return null;
    const result = { chr: '', animId, ...section };
    if (parts.length === codeIndex + 2) {
        const eventMatch = /^e(\d+)(?:\.([A-Za-z0-9_]+))?$/i.exec(parts[codeIndex + 1] ?? '');
        if (!eventMatch)
            return null;
        const eventIndex = parseSafeIntegerSegment(eventMatch[1], false, false);
        if (eventIndex === null)
            return null;
        result.eventIndex = eventIndex;
        if (eventMatch[2] !== undefined)
            result.field = eventMatch[2];
    }
    return result;
}
function parseActionUri(value) {
    const match = /^action:\/\/(c\d{4})\/(.+)$/i.exec(value);
    if (!match)
        return null;
    const parts = match[2].split('/');
    if (parts.some((part) => part.length === 0))
        return null;
    if (parts[0].toLowerCase() !== 'tae') {
        const result = parseActionTail(parts, 0);
        return result === null ? null : { ...result, chr: match[1].toLowerCase() };
    }
    if (parts.length < 3)
        return null;
    let selector = null;
    let codeIndex = 2;
    const selectorHead = parts[1];
    if (/^(?:0|[1-9]\d*)$/.test(selectorHead)) {
        selector = parseActionSectionSelector('index', selectorHead);
    }
    else if (/^(?:index|id|name|group)$/i.test(selectorHead)) {
        selector = parseActionSectionSelector(selectorHead, parts[2]);
        codeIndex = 3;
    }
    if (selector === null)
        return null;
    const result = parseActionTail(parts, codeIndex, selector);
    return result === null ? null : { ...result, chr: match[1].toLowerCase() };
}
function formatActionSectionSelector(address) {
    const selectors = [];
    if (address.taeEntryIndex !== undefined)
        selectors.push({ key: 'index', value: address.taeEntryIndex });
    if (address.taeEntryId !== undefined)
        selectors.push({ key: 'id', value: address.taeEntryId });
    if (address.taeEntryName !== undefined)
        selectors.push({ key: 'name', value: address.taeEntryName });
    if (address.taeGroup !== undefined)
        selectors.push({ key: 'group', value: address.taeGroup });
    if (selectors.length === 0)
        return null;
    if (selectors.length > 1) {
        throw new TypeError('ActionAddress 只能包含一个 TAE section selector。');
    }
    const selector = selectors[0];
    if (selector.key === 'index') {
        if (typeof selector.value !== 'number' || !Number.isSafeInteger(selector.value) || selector.value < 0) {
            throw new TypeError('ActionAddress.taeEntryIndex 必须是非负 safe integer。');
        }
        return `tae/${String(selector.value)}`;
    }
    if (selector.key === 'id') {
        if (typeof selector.value !== 'number' || !Number.isSafeInteger(selector.value)) {
            throw new TypeError('ActionAddress.taeEntryId 必须是 safe integer。');
        }
        return `tae/id/${String(selector.value)}`;
    }
    if (typeof selector.value !== 'string' || decodeSectionText(encodeURIComponent(selector.value)) === null) {
        throw new TypeError(`ActionAddress.${selector.key} 必须是非空且不含路径分隔符的字符串。`);
    }
    return `tae/${selector.key}/${encodeURIComponent(selector.value)}`;
}
/** animId → `A0200` (无任意五位上限，但必须是非负 safe integer)。 */
export function formatAnimCode(animId) {
    if (!Number.isSafeInteger(animId) || animId < 0) {
        throw new TypeError('animId 必须是非负 safe integer。');
    }
    return `A${String(animId).padStart(4, '0')}`;
}
/** `A0200` / `A200` / `A100000` → animId；解析不出或超出 safe integer 返回 null。 */
export function parseAnimCode(value) {
    const match = /^A(\d+)$/i.exec(value.trim());
    return match ? parseSafeIntegerSegment(match[1], false, false) : null;
}
/** 从路径 / 茎提取角色 id：`chr/c1050.anibnd.dcx` / `c1050.chrbnd.dcx` → `c1050`。 */
export function formatChrId(pathOrStem) {
    const match = /(?:^|[/\\])c(\d{4})(?:[./\\]|$)/i.exec(pathOrStem.trim());
    return match ? `c${match[1]}`.toLowerCase() : null;
}
/** 提取完整四段块 ID：`map/m11_01_00_00/m11_01_00_00.msb.dcx` → `m11_01_00_00`。 */
export function formatMapBlock(pathOrId) {
    const match = /\bm(\d{2})_(\d{2})_(\d{2})_(\d{2})(?![\w])/i.exec(pathOrId.trim());
    return match ? `m${match[1]}_${match[2]}_${match[3]}_${match[4]}`.toLowerCase() : null;
}
/** 块 → 区域号：`m11_01_00_00` → `M11`。解析不出返回空串。 */
export function formatMapArea(block) {
    const bare = formatMapBlock(block) ?? block.trim().toLowerCase();
    const match = /m(\d{2})/.exec(bare);
    return match ? `M${match[1]}` : '';
}
/**
 * 动作地址 → 字符串。无 section selector 时保留旧语法
 * `c1050#A0200.e0.startFrame`；有 selector 时输出 canonical action URI，
 * 例如 `{ chr:'c1050', taeEntryIndex:3, animId:200, eventIndex:0 }` →
 * `action://c1050/tae/3/A0200/e0`。
 */
export function formatActionAddress(address) {
    let result = address.chr.toLowerCase();
    if (address.animId !== undefined) {
        if (!Number.isSafeInteger(address.animId) || address.animId < 0) {
            throw new TypeError('ActionAddress.animId 必须是非负 safe integer。');
        }
        if (address.eventIndex !== undefined
            && (!Number.isSafeInteger(address.eventIndex) || address.eventIndex < 0)) {
            throw new TypeError('ActionAddress.eventIndex 必须是非负 safe integer。');
        }
        if (address.field && address.field.length > 0 && !/^[A-Za-z0-9_]+$/.test(address.field)) {
            throw new TypeError('ActionAddress.field 只能包含字母、数字和下划线。');
        }
        const section = formatActionSectionSelector(address);
        result = section === null
            ? `${result}#${formatAnimCode(address.animId)}`
            : `action://${result}/${section}/${formatAnimCode(address.animId)}`;
        if (address.eventIndex !== undefined) {
            result = section === null
                ? `${result}.e${address.eventIndex}`
                : `${result}/e${address.eventIndex}`;
            if (address.field && address.field.length > 0)
                result = `${result}.${address.field}`;
        }
    }
    else if (address.taeEntryIndex !== undefined
        || address.taeEntryId !== undefined
        || address.taeEntryName !== undefined
        || address.taeGroup !== undefined) {
        throw new TypeError('带 TAE section selector 的 ActionAddress 必须包含 animId。');
    }
    return result;
}
/**
 * 解析动作地址字符串（A 主键形式：`c1050#A0200.e0.startFrame`）。
 *
 * hkx 茎别名（`c1050#a000_020000`）能被 extractAtomicAddressTokens 整体保留供
 * 检索，但别名不能单凭文件名还原目标 TAE 段和 animId：标准 own-HKX 动作
 * 可以与 stem 编号相同，import/alias 和跨段重号仍需原生映射确认。writer 需要
 * 完整目标身份，故解析器对别名形式
 * fail-closed 返回 null，不编造主键 —— 未知映射不能开放读写目标。
 */
export function parseActionAddress(value) {
    if (typeof value !== 'string')
        return null;
    const text = value.trim();
    const uriResult = parseActionUri(text);
    if (uriResult !== null)
        return uriResult;
    const match = /^c(\d{4})(?:#A(\d+)(?:\.e(\d+))?(?:\.([A-Za-z0-9_]+))?)?$/i.exec(text);
    if (!match)
        return null;
    const result = { chr: `c${match[1]}`.toLowerCase() };
    if (match[2] === undefined)
        return result;
    const animId = parseSafeIntegerSegment(match[2], false, false);
    if (animId === null)
        return null;
    result.animId = animId;
    if (match[3] !== undefined) {
        const eventIndex = parseSafeIntegerSegment(match[3], false, false);
        if (eventIndex === null)
            return null;
        result.eventIndex = eventIndex;
    }
    if (match[4])
        result.field = match[4];
    return result;
}
/** 偏移消歧符：小写十六进制，与 `part:<map>:offset-<hex>` 的 stableKey 同口径。 */
function mapOffsetSuffix(nativeOffset) {
    return `0x${nativeOffset.toString(16)}`;
}
/**
 * 地图地址 → 字符串：
 * `{ block:'m11_01_00_00', name:'c1050_0000', field:'posX' }` → `m11_01_00_00#c1050_0000.posX`；
 * 带 `nativeOffset` 时 → `m11_01_00_00#c1050_0000@0x1234.posX`（只在重名时由调用方给出）。
 */
export function formatMapAddress(address) {
    const block = formatMapBlock(address.block) ?? address.block.toLowerCase();
    let result = block;
    if (address.name && address.name.length > 0) {
        result = `${result}#${address.name}`;
        if (address.nativeOffset !== undefined && Number.isSafeInteger(address.nativeOffset) && address.nativeOffset >= 0) {
            result = `${result}@${mapOffsetSuffix(address.nativeOffset)}`;
        }
        if (address.field && address.field.length > 0)
            result = `${result}.${address.field}`;
    }
    return result;
}
/**
 * 解析地图地址字符串：`m11_01_00_00#c1050_0000.posX`，以及重名消歧形式
 * `m11_01_00_00#c1010_0071@0x4f50c0`。
 *
 * `@0x<hex>` 只在紧贴名字（或名字与 `.field` 之间）时按偏移解析；名字里其它位置的 `@`
 * 仍属于名字，所以既有的 `<mapId>#<name>` 地址含义不变。
 */
export function parseMapAddress(value) {
    const text = value.trim();
    const match = /^(m\d{2}_\d{2}_\d{2}_\d{2})(?:#([^\s.#]+?)(?:@0x([0-9a-f]+))?(?:\.([A-Za-z0-9_]+))?)?$/i.exec(text);
    if (!match)
        return null;
    const result = { block: (match[1] ?? '').toLowerCase() };
    if (match[2] !== undefined) {
        // `name@0xdead` 也可能是真的名字；用懒匹配让 `@0x<hex>` 优先当消歧符，
        // 只有解析不出合法 safe integer 时整体回落为名字。
        const offsetText = match[3];
        if (offsetText !== undefined) {
            const nativeOffset = Number(`0x${offsetText}`);
            if (Number.isSafeInteger(nativeOffset) && nativeOffset >= 0) {
                result.name = match[2];
                result.nativeOffset = nativeOffset;
            }
            else {
                result.name = `${match[2]}@0x${offsetText}`;
            }
        }
        else {
            result.name = match[2];
        }
        if (match[4])
            result.field = match[4];
    }
    return result;
}
/**
 * 同一地图内出现多次的名字集合。地址 `<block>#<name>` 只对唯一名字是稳定标识；
 * 重名时必须追加 `@0x<offset>`，否则两个不同实体会共享同一个地址。
 */
export function duplicatedMapNames(items) {
    const counts = new Map();
    for (const item of items)
        counts.set(item.name, (counts.get(item.name) ?? 0) + 1);
    return new Set([...counts].filter(([, count]) => count > 1).map(([name]) => name));
}
/**
 * 一组地图实体 → 与 `read_msb_parts` 完全同口径的地址数组（下标与输入对齐）。
 *
 * 唯一名字保持 `<mapId>#<name>`；重名实体追加 `@0x<offset>`。索引、RAG、Agent 工具
 * 一律经这里生成地址，禁止各处手写一份偏移格式化。
 */
export function formatMapEntityAddresses(block, items) {
    const duplicated = duplicatedMapNames(items);
    return items.map((item) => formatMapAddress({
        block,
        name: item.name,
        ...(duplicated.has(item.name) && item.nativeOffset !== undefined ? { nativeOffset: item.nativeOffset } : {})
    }));
}
/**
 * 地图实体 → symbolUri，与 {@link formatMapEntityAddresses} 一一对应：
 * 唯一名字 `map://<mapId>/part/<name>`；重名实体 `map://<mapId>/part/<name>@0x<offset>`。
 *
 * 旧 Bridge 语义导出的 `~1`（第 n 次出现）只是出现序号，无法从地址反推，也不能跨
 * ingest 路径保证唯一；这里统一改成原生偏移，地址与 uri 因此能互相定位。
 */
export function formatMapEntityUri(input) {
    const block = formatMapBlock(input.block) ?? input.block.toLowerCase();
    const disambiguated = input.duplicated === true
        && input.nativeOffset !== undefined
        && Number.isSafeInteger(input.nativeOffset)
        && input.nativeOffset >= 0;
    const suffix = disambiguated ? `@${mapOffsetSuffix(input.nativeOffset)}` : '';
    return `map://${block}/${input.family}/${encodeURIComponent(input.name)}${suffix}`;
}
/**
 * uri / 地址里的 `@0x<offset>` 偏移，以及去掉偏移后的名字。
 * 支持 `map://<mapId>/part/<name>@0x4f50c0`、`<mapId>#<name>@0x4f50c0`、`<name>@0x4f50c0`。
 */
export function parseMapOffsetSuffix(value) {
    const text = value.trim();
    const uriMatch = /^map:\/\/[^/]+\/(?:part|region)\/([^/?#]+)$/iu.exec(text);
    const candidate = uriMatch?.[1] ?? (/^[^#\s]+#([^\s.]+)$/u.exec(text)?.[1] ?? text);
    const offsetMatch = /^(.+?)@0x([0-9a-f]+)$/iu.exec(candidate);
    if (offsetMatch === null)
        return null;
    const nativeOffset = Number(`0x${offsetMatch[2]}`);
    if (!Number.isSafeInteger(nativeOffset) || nativeOffset < 0)
        return null;
    let name;
    try {
        name = decodeURIComponent(offsetMatch[1]);
    }
    catch {
        name = offsetMatch[1];
    }
    return name.length === 0 ? null : { name, nativeOffset };
}
/**
 * 从文本里抽出原子地址 token（大小写不敏感，一律小写；下划线是 ID 一部分，
 * 保留不拆）。至少覆盖：`c\d{4}`、`A\d+`、`a\d{3}_\d+`（hkx 茎）、`M\d{2}`、
 * `m\d{2}_\d{2}_\d{2}_\d{2}`、以及带 `#` 的完整地址（含 .eN / .field）。
 * 供 queryParse tokenize 与 lookupIndex 在切词前先抽地址，避免被 replaceAll 拆碎。
 */
export function extractAtomicAddressTokens(text) {
    const tokens = [];
    const add = (value) => {
        if (!value || value.length === 0)
            return;
        const normalized = value.toLowerCase();
        if (!tokens.includes(normalized))
            tokens.push(normalized);
    };
    const keepActionToken = (value) => {
        // Numeric action identities must be parser-valid before entering the
        // query token set.  Preserve HKX stems separately as lookup aliases:
        // they intentionally do not parse back to an animId.
        if (parseActionAddress(value) !== null
            || /^c\d{4}#a\d{3}_\d+(?![\w])(?:\.e\d+)?(?:\.\w+)?$/i.test(value)) {
            add(value);
        }
    };
    // 完整地址优先整体提取，保证带 # 的旧地址及 action:// section URI 不被拆。
    for (const match of text.matchAll(ACTION_ADDR_RE))
        keepActionToken(match[0]);
    for (const match of text.matchAll(ACTION_URI_ADDR_RE))
        keepActionToken(match[0]);
    for (const match of text.matchAll(MAP_ADDR_RE))
        add(match[0]);
    // 再抽独立分量（c1050 / a0200 / m11 / m11_01_00_00 等）。
    for (const match of text.matchAll(CHR_RE))
        add(`c${match[1]}`);
    for (const match of text.matchAll(ANIM_CODE_RE)) {
        if (parseAnimCode(`A${match[1]}`) !== null)
            add(`a${match[1]}`);
    }
    for (const match of text.matchAll(HKX_STEM_RE))
        add(`a${match[1]}_${match[2]}`);
    for (const match of text.matchAll(MAP_AREA_RE))
        add(`m${match[1]}`);
    for (const match of text.matchAll(MAP_BLOCK_RE))
        add(`m${match[1]}_${match[2]}_${match[3]}_${match[4]}`);
    return tokens;
}
//# sourceMappingURL=soulAddress.js.map