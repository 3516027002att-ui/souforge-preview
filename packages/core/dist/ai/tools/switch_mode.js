import { asRecord, asString, fail, ok } from '../toolRegistrySupport.js';
/** switch_mode: one domain tool declaration, schema and handler. */
export function createSwitchModeTool() {
    return {
        name: 'switch_mode',
        description: 'Lower the active agent operation mode within the immutable host grant. Raising permission requires the user to choose Edit or Bypass in the host and start/resume a run.',
        permission: 'read',
        permissionLevel: 'read',
        inputSchema: { mode: 'string', reason: 'string?' },
        run: (input, context) => {
            const value = asRecord(input);
            const rawMode = asString(value.mode).trim();
            const targetMode = rawMode === 'edit' ? 'normal' : rawMode;
            if (targetMode === 'plan' || targetMode === 'normal' || targetMode === 'fullPermission') {
                const rank = { plan: 0, normal: 1, fullPermission: 2 };
                const ceiling = context.modeCeiling ?? context.mode;
                if (rank[targetMode] > rank[ceiling]) {
                    return fail('MODE_ESCALATION_REQUIRES_HOST_GRANT', `不能由模型把模式从 ${context.mode} 提升到 ${targetMode}；请由用户在宿主中选择 Edit 或 Bypass 后开始或承接新一轮。`, { currentMode: context.mode, modeCeiling: ceiling, requestedMode: targetMode });
                }
                context.mode = targetMode;
                // `reason` was declared but never read, so a rationale the model supplied vanished
                // without a trace. Echo it back in a bounded field instead of dropping it.
                const reason = asString(value.reason).trim();
                return ok({
                    switched: true,
                    currentMode: targetMode,
                    ...(reason ? { reason: reason.slice(0, 200) } : {}),
                    note: `操作模式已在宿主授权上限内切换为「${targetMode}」。`
                });
            }
            return fail('INVALID_MODE', `不支持的目标模式: "${rawMode}"，可选值为: "plan" | "edit" | "normal" | "fullPermission"。`);
        }
    };
}
//# sourceMappingURL=switch_mode.js.map