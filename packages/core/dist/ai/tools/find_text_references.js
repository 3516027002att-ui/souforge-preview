import { asNumber, asOptionalString, asRecord, fail, ok, requireEditSession, summarizeReferences } from '../toolRegistrySupport.js';
import { loadWorkspaceEventInstructionIndex } from '../eventArgumentIndexService.js';
import { assessParameterizedEntityCoverage } from '../../references/parameterizedEntityCoverage.js';
import { buildQueryScopedNegativeConclusion } from '../../references/queryScopedNegativeConclusion.js';
/** find_text_references: one domain tool declaration, schema and handler. */
export function createFindTextReferencesTool() {
    return {
        name: 'find_text_references',
        description: 'Find events or other symbols that reference a parsed textId. '
            + 'negativeConclusionAllowed is query-scoped: it is false unless every source domain that can reference a text '
            + '(event/param/msg) was read completely for this query and the workspace event index has no text-id argument '
            + '(messageId/nameId …) taken from a common event parameter (X<offset>_<width>); such calls cannot be attributed '
            + 'to a concrete text entry and may target this one, so a zero result is then insufficient_evidence with verdict '
            + 'and blockedReasons, never proof that nothing references the text.',
        permission: 'analyze',
        permissionLevel: 'analyze',
        inputSchema: { textId: 'number', category: 'string?' },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const textId = asNumber(value.textId, Number.NaN);
            if (!Number.isFinite(textId))
                return fail('INVALID_INPUT', 'find_text_references 需要数字 textId（先用 search_text_entries 查到条目）。');
            const category = asOptionalString(value.category);
            const matches = ws.lookupTextEntries(textId, category);
            if (matches.length === 0)
                return fail('TEXT_ENTRY_NOT_FOUND', `没有 id 为 ${textId} 的文本条目${category ? `（类别 ${category}）` : ''}。先用 search_text_entries 按内容搜索。`, { category });
            // Native/event projections can be published after MSG entries. Rebuild
            // the shared graph here so this reverse query cannot return only the
            // stale container-member edge from the previous index generation.
            ws.rebuildReferences();
            const domainCoverage = ws.getCoverageSnapshot().map((item) => ({
                ...(item.domain ? { domain: item.domain } : {}),
                status: item.status,
                coveredResources: item.coveredResources,
                expectedResources: item.expectedResources,
                staleSourceCount: item.staleSources.length,
                diagnosticCount: item.diagnostics.length
            }));
            const items = matches.map((entry) => {
                const references = ws.findReferences(entry.uri, 'to');
                const semanticReferences = references.filter((reference) => (reference.kind !== 'contains' && reference.kind !== 'member_of'));
                return {
                    entry,
                    references,
                    semanticReferences,
                    referenceStats: summarizeReferences(references),
                    semanticReferenceStats: summarizeReferences(semanticReferences)
                };
            });
            const totalReferences = items.reduce((sum, item) => sum + item.references.length, 0);
            const totalSemanticReferences = items.reduce((sum, item) => sum + item.semanticReferences.length, 0);
            // 文本引用的来源域：事件指令的文本实参、PARAM 的文本字段、MSG 自身。
            // 只有这些域读全、且事件索引里没有无法归属的文本实参时，才能说“没有引用”。
            const domains = ['event', 'param', 'msg'];
            const snapshot = ws.getCoverageSnapshot();
            const scopeCoverage = domains.map((domain) => {
                const state = snapshot.find((item) => item.domain === domain);
                return {
                    domain,
                    covered: state?.coveredResourceIds?.length ?? state?.coveredResources ?? 0,
                    expected: state?.expectedResourceIds?.length ?? state?.expectedResources ?? 0,
                    stale: state?.staleSources.length ?? 0
                };
            });
            const queryScopeComplete = scopeCoverage.every((entry) => entry.stale === 0 && entry.expected > 0 && entry.covered >= entry.expected);
            const edit = requireEditSession(context, 'read');
            let assessment;
            let unavailableReason;
            if (!('session' in edit)) {
                unavailableReason = edit.error?.message ?? '本次查询无法打开原生读取会话';
            }
            else {
                const loaded = await loadWorkspaceEventInstructionIndex({
                    workspaceId: ws.workspaceId,
                    ws,
                    edit: edit.session,
                    ...(context.signal ? { signal: context.signal } : {})
                });
                if (!loaded.ok) {
                    unavailableReason = loaded.message;
                }
                else {
                    assessment = assessParameterizedEntityCoverage({
                        files: loaded.index.files,
                        role: 'text'
                    });
                }
            }
            const conclusion = buildQueryScopedNegativeConclusion({
                domains,
                coverage: scopeCoverage,
                ...(assessment ? { assessment } : {}),
                ...(unavailableReason === undefined ? {} : { unavailableReason }),
                scopeLabel: `textId=${textId} 的文本引用范围`
            });
            return ok({
                textId,
                category,
                matches: items,
                totalReferences,
                totalSemanticReferences,
                status: totalSemanticReferences > 0 ? 'found' : conclusion.negativeConclusionAllowed ? 'not_found' : 'insufficient_evidence',
                coverage: domainCoverage,
                queryScope: { domains, complete: queryScopeComplete },
                negativeConclusionAllowed: conclusion.negativeConclusionAllowed,
                verdict: conclusion.verdict,
                blockedReasons: conclusion.blockedReasons,
                caveats: conclusion.caveats,
                ...(assessment === undefined ? {} : {
                    parameterizedEntityArgs: {
                        role: assessment.role,
                        scope: assessment.scope,
                        relevant: assessment.relevantCount,
                        total: assessment.totalCount,
                        instructions: assessment.relevantInstructions,
                        ...(assessment.unrelatedInstructions.length === 0 ? {} : { unrelatedInstructions: assessment.unrelatedInstructions }),
                        otherRoleCount: assessment.otherRoleCount,
                        filesInScope: assessment.filesInScope,
                        filesUnread: assessment.filesUnread
                    }
                })
            });
        }
    };
}
//# sourceMappingURL=find_text_references.js.map