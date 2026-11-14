import { asNumber, asOptionalString, asRecord, asString, fail, ok, searchQueryUnusable } from '../toolRegistrySupport.js';
import { describeTableSpelling, expandFieldQuery, fieldCatalogNames, fieldCatalogStats, nearestFieldCandidates, searchParamFieldCatalog, searchParamFieldCatalogNotInGame, searchTaeFieldCatalog } from '../../param/fieldSemantics.js';
/** 本作不存在的表最多回显多少条字段：这是解释，不是候选，不需要整页。 */
const NOT_IN_GAME_LIMIT = 5;
/**
 * search_field_names：跨 PARAM / TAE 的字段名词典。
 *
 * 与 `search_param_fields` 的分工：
 *   · `search_param_fields` 要先有 table + rowIds，回答「这一行有哪些字段、真实 fieldId 是什么」；
 *   · 本工具不需要工作区、不需要行：回答「用户说的这个名字是哪个字段、属于哪张表/哪个事件」。
 *
 * 这正是「判定距离」这一类问题的入口——它既可能是 PARAM 的距离字段，也可能是 TAE 事件
 * 760 (`Set Root Motion Multiplier`) 的 `Reference Distance` / `Enable Range Maximum`。
 * 只给一个候选会让 agent 猜；这里把两个都返回，并由 `semantics` 说明基准距离与上限的区别。
 *
 * 边界：PARAM 候选只来自本作 gameparam 里真实存在的表（122 个 native 类型）。随包 paramdef
 * 是类型字典（160 个），其中 38 个类型在本作没有子文件；它们的字段只出现在 `notInGame`
 * 里解释「为什么这个名字没有可读的表」，绝不会成为 `items` 里可以照抄的答案。
 */
export function createSearchFieldNamesTool() {
    return {
        name: 'search_field_names',
        description: 'Answer "which field is this?" for a Chinese or English name, across PARAM tables and TAE event fields, '
            + 'without needing a workspace row first. Returns candidates with domain (param/tae), the owning table '
            + '(PARAM native type, e.g. NPC_PARAM_ST) or TAE event (eventTypeId + eventName), fieldId/name/type, and '
            + 'matchedBy (fieldId | name | alias | description | cjk-variant). A cjk-variant hit means the query only matched after CJK '
            + 'folding or a curated Chinese label, so it is not the literal native name; an alias hit means it matched a curated '
            + 'alias (old tool name, paramdef English annotation, or common Chinese wording) rather than the native name; a '
            + 'description hit means only the '
            + 'field prose mentioned the term (weakest channel, with descriptionSnippet), not that the field is named that. TAE hits may carry a '
            + 'semantics note (for example Reference Distance is the baseline distance and Enable Range Maximum is the '
            + 'upper bound of the enable range). Curated PARAM fields also carry semantics (the self-explanatory meaning) and '
            + 'aliases; for example NpcParam.ninsatuNum is 必要忍殺回数 / Amount of healthbars / HealthbarNum, i.e. 血条数 = 必要忍杀次数, '
            + 'and 血条/血条数/忍杀/healthbar/deathblow all surface it. Query 判定距离 returns both Reference Distance and Enable Range '
            + 'Maximum; do not write a field you cannot name. '
            + 'PARAM candidates come only from tables this game actually ships in param/gameparam/gameparam.parambnd.dcx '
            + '(122 native types); the bundled paramdef dictionary declares 160, so a type with no shipped table (AI_ATTACK_PARAM_ST, '
            + 'MISSILE_PARAM_ST, YEBIS_BANK, FOG_BANK, ...) is never an item — if a query only matches such a type it is reported under '
            + 'notInGame, which says why that name cannot be read or written and must not be used as a target. '
            + 'Optional `table` is a strict filter, not a ranking hint: it accepts a native type name (SP_EFFECT_PARAM_ST) or the physical '
            + 'child name list_container_entries shows (SpEffectParam, ThrowParam), restricts results to that table and to the param domain, '
            + 'and fails with TABLE_NOT_FOUND / TABLE_NOT_IN_GAME instead of silently returning other tables. '
            + 'If nothing matches, nearestCandidates gives the closest real in-game field names instead of concluding "no such field".',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            query: 'string',
            domain: 'string?',
            table: 'string?',
            limit: 'number?'
        },
        run: async (input) => {
            const value = asRecord(input);
            const query = asString(value.query).trim();
            if (!query) {
                return fail('INVALID_INPUT', 'search_field_names 需要非空 query；可以写中文（判定距离、血条）或英文/原生名（Reference Distance、hp）。');
            }
            const unusable = searchQueryUnusable(query);
            if (unusable !== undefined)
                return fail('SEARCH_QUERY_UNUSABLE', unusable);
            const requestedDomain = asOptionalString(value.domain)?.trim().toLowerCase();
            if (requestedDomain !== undefined && requestedDomain !== 'param' && requestedDomain !== 'tae' && requestedDomain !== 'all') {
                return fail('INVALID_INPUT', 'search_field_names 的 domain 只能是 param、tae 或 all。');
            }
            const table = asOptionalString(value.table)?.trim();
            if (table !== undefined && table !== '' && requestedDomain === 'tae') {
                return fail('INVALID_INPUT', `table「${table}」是 PARAM 表，domain 不能再是 tae；要查 TAE 事件字段请去掉 table。`);
            }
            // table 过滤必须先解析成一张本作真实存在的表：解析失败时给的是「表不存在」的确定答案，
            // 而不是「这次没有字段匹配」——后者会让调用方以为表还在、只是名字不对，继续瞎找。
            const tableFilter = table === undefined || table === '' ? undefined : describeTableSpelling(table);
            if (tableFilter !== undefined && !tableFilter.inGame) {
                const hint = 'table 可写 native 类型名（如 SP_EFFECT_PARAM_ST）或容器里的物理子文件名（如 SpEffectParam）；'
                    + '本作实际子文件用 list_container_entries(param/gameparam/gameparam.parambnd.dcx) 查看。';
                return tableFilter.inParamdef
                    ? fail('TABLE_NOT_IN_GAME', `「${tableFilter.requested}」只在随包 paramdef 里定义（${String(tableFilter.paramType)}），本作 gameparam.parambnd.dcx 没有这张表：`
                        + '读它没有字节、写它没有子文件，所以不能按它找字段或改数据。', { requested: tableFilter.requested, paramType: tableFilter.paramType, inGame: false, hint })
                    : fail('TABLE_NOT_FOUND', `没有名为「${tableFilter.requested}」的 PARAM 表（随包 paramdef 里也没有这个类型）。`, {
                        requested: tableFilter.requested,
                        inGame: false,
                        hint
                    });
            }
            const domain = (tableFilter === undefined ? (requestedDomain ?? 'all') : 'param');
            const limit = value.limit === undefined ? 8 : Math.max(1, Math.min(32, Math.trunc(asNumber(value.limit, 8))));
            const resolvedTable = tableFilter?.paramType;
            const expanded = expandFieldQuery(query);
            // 两个目录各按「足够大」的窗口取，再自己合并/截断：这样 totalCount 是真实命中数，
            // 而不是「本页条数」。domain 只决定收不收某个目录，不改变域内排序。
            const taeAll = domain === 'param' ? [] : searchTaeFieldCatalog(query, { limit: 200 });
            const paramAll = domain === 'tae' ? [] : searchParamFieldCatalog(query, {
                ...(resolvedTable === undefined ? {} : { table: resolvedTable }),
                limit: 200
            });
            const all = [...taeAll, ...paramAll];
            const candidates = all.slice(0, limit);
            // 只在 param 域回显「paramdef 有、本作没有」的命中；这些不是候选，是对「为什么查不到表」的解释。
            const notInGameAll = domain === 'tae' ? [] : searchParamFieldCatalogNotInGame(query, {
                ...(resolvedTable === undefined ? {} : { table: resolvedTable }),
                limit: 200
            });
            const notInGameItems = notInGameAll.slice(0, NOT_IN_GAME_LIMIT);
            // 零命中不是「没有这个字段」：给出最接近的真实字段名，下一跳才有起点。
            // 这套兜底与 search_text_entries 的 variantHints 同源（等长单字替换），不给语义猜测。
            // 指定了 table 时近似名也只从这张表里取，否则会给一个过滤不掉的下一步。
            const nearestPool = resolvedTable === undefined
                ? fieldCatalogNames()
                : fieldCatalogNames().filter((entry) => entry.paramType === resolvedTable);
            const nearest = candidates.length === 0 ? nearestFieldCandidates(query, nearestPool, 5) : [];
            const strong = candidates.filter((candidate) => candidate.matchKind === 'curated-label' || candidate.matchKind === 'exact-name');
            // 过滤后为空的另一种解释是「这个名字在别的表里」——旧实现正是因为把 table 当排序提示，
            // 才会把这些别表字段直接端上来。这里只报数量和分布，明确它们不是本表的字段。
            const elsewhere = candidates.length === 0 && tableFilter !== undefined
                ? searchParamFieldCatalog(query, { limit: 200 })
                : [];
            const elsewhereTables = [...new Set(elsewhere.map((item) => item.table).filter((name) => name !== undefined))];
            const note = candidates.length === 0
                ? tableFilter === undefined
                    ? `没有字段名匹配「${query}」（只搜本作 gameparam 里真实存在的表）。这只是本次查询的结论，不代表不存在：可换用收录的中文名`
                        + '（如 判定距离、血条）、native 英文名（如 Reference Distance、hp），或用更短的词根（distance、enable）重试；'
                        + (nearest.length > 0
                            ? `字段目录里最接近的是 ${nearest.map((item) => item.name).slice(0, 3).join('、')}。`
                            : '当前两个目录都没有可用的近似名。')
                    : `table 过滤已生效：${String(tableFilter.paramType)} 里没有匹配「${query}」的字段。`
                        + (elsewhere.length > 0
                            ? `同一次查询在其它表里有 ${elsewhere.length} 条命中（${elsewhereTables.slice(0, 3).join('、')} 等），`
                                + '那是被 table 过滤掉的，不是这张表的字段。'
                            : '其它表也没有命中。')
                        + (nearest.length > 0
                            ? `这张表里最接近的是 ${nearest.map((item) => item.name).slice(0, 3).join('、')}。`
                            : '')
                : undefined;
            const nextActions = [];
            const paramHit = candidates.find((candidate) => candidate.domain === 'param' && candidate.fieldId !== undefined);
            if (paramHit?.table !== undefined) {
                nextActions.push({
                    tool: 'search_param_fields',
                    args: { table: paramHit.table, query: paramHit.fieldId },
                    reason: '用字段 id 在该 PARAM 表里定位真实行与可读字段；该表名（native 类型名）本身就是可接受的 table 拼写。'
                });
            }
            const taeHit = candidates.find((candidate) => candidate.domain === 'tae' && candidate.eventTypeId !== undefined);
            if (taeHit !== undefined) {
                nextActions.push({
                    tool: 'read_tae_events',
                    args: { file: 'chr/c0000.anibnd.dcx' },
                    reason: `字段 ${taeHit.name} 属于 TAE 事件类型 ${String(taeHit.eventTypeId)}（${String(taeHit.eventName)}）；先预览动作，再按动作地址读出它的实际值。`
                });
            }
            return ok({
                query,
                normalizedQuery: expanded.normalizedQuery,
                ...(expanded.conceptIds.length > 0 ? { conceptIds: expanded.conceptIds } : {}),
                // 概念回显不是装饰：`血条数` 命中 healthbar-count 时，这里的 zh 就写着
                // 「血条数（= 必要忍杀次数 / Amount of healthbars）」，调用方不必猜两个说法是否同一件事。
                ...(expanded.concepts.length > 0 ? { concepts: expanded.concepts } : {}),
                domain,
                ...(tableFilter === undefined
                    ? {}
                    : {
                        table: tableFilter.paramType,
                        tableFilter: {
                            requested: tableFilter.requested,
                            typeName: tableFilter.paramType,
                            applied: true,
                            scope: 'param',
                            note: 'table 是严格过滤：items 只含这张表的字段；TAE 域不参与。'
                        }
                    }),
                items: candidates,
                totalCount: all.length,
                returnedCount: candidates.length,
                truncated: all.length > candidates.length,
                domainCounts: { tae: taeAll.length, param: paramAll.length },
                ...(notInGameItems.length === 0
                    ? {}
                    : {
                        notInGame: {
                            policy: 'excluded-from-items',
                            note: '这些字段只在随包 paramdef 类型字典里有定义；本作 gameparam.parambnd.dcx 没有承载它们的表，'
                                + '读不到也写不了。它们是「这个名字为什么查不到表」的解释，不是可以照抄的候选。',
                            tables: [...new Set(notInGameItems.map((item) => item.table).filter((name) => name !== undefined))],
                            items: notInGameItems.map(notInGameItem),
                            totalCount: notInGameAll.length,
                            truncated: notInGameAll.length > notInGameItems.length
                        }
                    }),
                ...(note === undefined ? {} : { note }),
                ...(nearest.length > 0 ? { nearestCandidates: nearest } : {}),
                ...(strong.length > 0 ? { strongCandidates: strong.map(candidateId) } : {}),
                source: {
                    kind: 'first-party-schema',
                    ...fieldCatalogStats(),
                    cjkLabels: 'curated',
                    note: 'PARAM 定义与 TAE 事件字段来自随包发布的 first-party schema；PARAM 候选已按 '
                        + 'schema/sekiro/gameParamTables.ts 收敛到本作 gameparam 实际存在的表（paramGameTables；'
                        + 'paramDefinitions 是 paramdef 类型字典的规模，不是能读的表数）。中文标签与 PARAM 别名是收录表，'
                        + '条目都钉在 schema 上并有测试校验。param 候选的 description 仍是 paramdef 原文；自解释语义在 semantics，'
                        + '收录别名在 aliases。'
                },
                nextActions
            });
        }
    };
}
/** notInGame 回显只保留定位所需的最小列：它是解释，不是可执行候选。 */
function notInGameItem(candidate) {
    return {
        ...(candidate.table === undefined ? {} : { table: candidate.table }),
        ...(candidate.fieldId === undefined ? {} : { fieldId: candidate.fieldId }),
        name: candidate.name,
        matchedBy: candidate.matchedBy,
        matchKind: candidate.matchKind
    };
}
function candidateId(candidate) {
    return `${candidate.domain}:${String(candidate.eventTypeId ?? candidate.table)}:${candidate.fieldId ?? candidate.name}`;
}
//# sourceMappingURL=search_field_names.js.map