import { asEntityRelations, asOptionalString, asRecord, fail, ok } from '../toolRegistrySupport.js';
import { resolveEntity } from '.././entityResolution.js';
import { resolveChrLinkage } from '../../references/chrLinkageResolver.js';
/** resolve_entity: one domain tool declaration, schema and handler. */
export function createResolveEntityTool() {
    return {
        name: 'resolve_entity',
        description: 'Resolve a fuzzy object name or an exact native handle into bounded candidates, identity chains, '
            + 'declared/verified relationship edges, coverage and a next-read plan. Exact handles are checked '
            + 'against current source versions. Fuzzy zero-hit is never proof that an entity does not exist; '
            + 'unregistered numeric joins remain hypotheses and never enter mutation targets.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: {
            query: 'string?',
            handle: 'string?',
            nativeHandle: 'string?',
            domain: 'string?',
            relations: 'array?',
            maxCandidates: 'safe-integer?',
            maxEdges: 'safe-integer?',
            maxSteps: 'safe-integer?'
        },
        run: async (input, context) => {
            const ws = context.workspaceIndex;
            if (ws === null)
                return fail('WORKSPACE_REQUIRED', '这次工具需要先打开 Mod 工作区。');
            const value = asRecord(input);
            const rawQuery = asOptionalString(value.query)?.trim();
            // A caller who pastes a uri or a native handle into query means to address one object,
            // not to fuzzy-match text: route it through the exact-handle path instead of returning
            // "not found" for a perfectly good identifier.
            const looksLikeHandle = rawQuery !== undefined
                && (/^[a-z][a-z0-9+.-]*:\/\//iu.test(rawQuery) || /#[0-9]+$/u.test(rawQuery));
            const query = looksLikeHandle ? undefined : rawQuery;
            const handle = asOptionalString(value.handle)?.trim() ?? asOptionalString(value.nativeHandle)?.trim()
                ?? (looksLikeHandle ? rawQuery : undefined);
            if (!query && !handle)
                return fail('INVALID_INPUT', 'resolve_entity 需要 query 或 handle/nativeHandle。');
            const relations = asEntityRelations(value.relations);
            const linkageRoot = context.session?.layers.overlayRoot;
            const domain = asOptionalString(value.domain);
            const result = await resolveEntity({
                index: ws,
                ...(query ? { query } : {}),
                ...(handle ? { nativeHandle: handle } : {}),
                ...(domain ? { domain } : {}),
                ...(relations.length > 0 ? { requiredRelations: relations } : {}),
                ...(typeof value.maxCandidates === 'number' ? { maxCandidates: value.maxCandidates } : {}),
                ...(typeof value.maxEdges === 'number' ? { maxEdges: value.maxEdges } : {}),
                ...(typeof value.maxSteps === 'number' ? { maxSteps: value.maxSteps } : {}),
                ...(linkageRoot ? {
                    linkageResolver: async (rowId) => resolveChrLinkage(rowId, {
                        workspaceRoot: linkageRoot,
                        ...(context.session?.layers.baseRoot ? { oodleRuntimeRoot: context.session.layers.baseRoot } : {})
                    })
                } : {})
            });
            // A blocked map/character edge is a routing fact, not a dead end. The tool envelope keeps
            // nextReadPlan and drops ad-hoc keys, so the fallback route belongs in that plan.
            const blocked = Array.isArray(result.blockedReasons)
                ? result.blockedReasons.map((item) => String(item))
                : [];
            const existingPlan = Array.isArray(result.nextReadPlan)
                ? result.nextReadPlan
                : [];
            const extraPlan = [];
            if (blocked.some((item) => item.startsWith('RELATION_UNVERIFIED:map')) && !existingPlan.some((step) => step.stepId === 'map-entity-fallback')) {
                extraPlan.push({
                    stepId: 'map-entity-fallback',
                    route: 'search_map_entities',
                    target: 'map',
                    reason: 'NpcParam→MSB 实体没有原生外键确认；先按名称/模型定位地图实例，再用其 entityId 在事件文件里按数值检索。',
                    priority: 95,
                    requiredForMutation: false
                });
            }
            if (blocked.some((item) => item.startsWith('RELATION_UNVERIFIED:character')) && !existingPlan.some((step) => step.stepId === 'character-model-fallback')) {
                extraPlan.push({
                    stepId: 'character-model-fallback',
                    route: 'search_param_rows',
                    target: 'param',
                    reason: '角色模型链未确认；先确认 NpcParam 行本身，再从 map/script 侧补实例身份。',
                    priority: 96,
                    requiredForMutation: false
                });
            }
            if (blocked.includes('EDGE_BUDGET_EXHAUSTED') && !existingPlan.some((step) => step.stepId === 'edge-budget-retry')) {
                extraPlan.push({
                    stepId: 'edge-budget-retry',
                    route: 'resolve_entity',
                    target: 'relations',
                    reason: `边预算用尽；提高 maxEdges（当前建议 ${Math.max(32, relations.length * 8)}）或用 relations 收窄后重取。`,
                    priority: 97,
                    requiredForMutation: false
                });
            }
            return ok(extraPlan.length > 0 ? { ...result, nextReadPlan: [...existingPlan, ...extraPlan] } : result);
        }
    };
}
//# sourceMappingURL=resolve_entity.js.map