/**
 * Supported initialization/call instructions and their exact eventId
 * positions. `InitializeCommonEvent` is intentionally different from
 * `InitializeEvent`: its first argument is eventId and the rest is vararg.
 */
const EVENT_CALL_INSTRUCTION_NAMES = ['InitializeEvent', 'InitializeCommonEvent', 'GotoEvent', 'RunEvent'];
const EVENT_CALL_ARG_POSITIONS = {
    InitializeEvent: 1,
    InitializeCommonEvent: 0,
    GotoEvent: 1,
    RunEvent: 1
};
function eventCallRules() {
    return EVENT_CALL_INSTRUCTION_NAMES.map((instructionName) => ({
        ruleId: `event-call:${instructionName}`,
        game: 'sekiro',
        // The bundled production registry is the current source of truth; keep
        // imported/user-derived/fixture origins for the existing synthetic and
        // external-schema compatibility tests.
        registryOrigins: ['first-party', 'imported', 'user-derived', 'fixture'],
        instructionName,
        argPosition: EVENT_CALL_ARG_POSITIONS[instructionName],
        // The registry arg definition name for the target id. Imported Sekiro
        // EMEDF names this "eventId" (DarkScript3 convention, see emedfSchema
        // extractEventIdReferences); the rule only fires when the def matches.
        argName: 'eventId',
        namespace: 'event',
        source: 'eventSymbolIndexer supported call set + runDarkScriptCompilerSmoke signature (slotNumber, eventId, arg)'
    }));
}
export const EMEVD_ROLE_RULES = Object.freeze([
    ...eventCallRules(),
    {
        ruleId: 'param-ref:AwardItemLot.itemLotId',
        game: 'sekiro',
        registryOrigins: ['first-party', 'imported', 'user-derived', 'fixture'],
        instructionName: 'AwardItemLot',
        argPosition: 0,
        argName: 'itemLotId',
        namespace: 'param',
        targetParamName: 'ItemLotParam',
        source: 'first-party Sekiro EMEDF: AwardItemLot(itemLotId)'
    }
]);
/**
 * Match a registry instruction definition against the explicit rule table.
 * Requires the exact instruction name AND the exact arg name at the exact
 * position — never a substring. Returns undefined when the registry has no
 * def or no rule applies.
 */
export function matchEmevdRoleRule(registry, bank, id, argPosition) {
    const def = registry.instructions.find((instruction) => instruction.bank === bank && instruction.id === id);
    if (!def)
        return undefined;
    return EMEVD_ROLE_RULES.find((rule) => rule.game === registry.game
        && rule.registryOrigins.includes(registry.origin)
        && rule.instructionName === def.name
        && rule.argPosition === argPosition
        && def.args[argPosition]?.name === rule.argName);
}
/** True when the source URI names the global common/commonfunc EMEVD namespace. */
export function isCommonEmevdNamespace(sourceUri) {
    const lower = sourceUri.toLowerCase();
    return /(?:^|[\\/])common(?:func)?\.emevd(?:\.dcx)?(?:$|#)/u.test(lower);
}
//# sourceMappingURL=emevdRoleRules.js.map