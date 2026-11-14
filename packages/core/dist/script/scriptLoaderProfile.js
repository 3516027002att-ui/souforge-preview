/**
 * Script loader profiles for SoulForge script editing.
 *
 * Enforces resource category, representation, encoding, and first-party
 * compiler/decompiler provenance. Current Sekiro HKS bytecode is source-editable;
 * future dialects must not be silently treated as the current dialect.
 */
export const REGISTERED_SCRIPT_LOADER_PROFILES = Object.freeze([
    {
        id: 'sekiro-ai-luabnd',
        game: 'sekiro',
        version: '1.06',
        resourceKind: 'ai-script',
        containerPattern: /\.luabnd(\.dcx)?$/i,
        entryPattern: /\.lua$/i,
        allowedRepresentations: ['plaintext', 'bytecode'],
        defaultEncoding: 'shift_jis',
        supportsPlaintextSourceEdit: true,
        bytecodeToSourceAllowed: true,
        decompilerTool: {
            toolName: 'SoulForge HKS IR',
            version: 'soulforge-hks-ir-1'
        },
        verifiedSamples: [
            'goal_list.lua',
            '543000_battle.lua',
            '801000_battle.lua',
            'logic_list.lua'
        ]
    },
    {
        id: 'sekiro-action-nameid',
        game: 'sekiro',
        version: '1.06',
        resourceKind: 'text-nameid',
        containerPattern: /nameid\.txt$/i,
        entryPattern: /nameid\.txt$/i,
        allowedRepresentations: ['plaintext'],
        defaultEncoding: 'shift_jis',
        supportsPlaintextSourceEdit: true,
        bytecodeToSourceAllowed: false,
        verifiedSamples: [
            'eventnameid.txt',
            'statenameid.txt',
            'variablenameid.txt'
        ]
    },
    {
        id: 'sekiro-action-hks',
        game: 'sekiro',
        version: '1.06',
        resourceKind: 'action-hks',
        containerPattern: /\.hks$/i,
        entryPattern: /\.hks$/i,
        allowedRepresentations: ['bytecode'],
        defaultEncoding: 'ascii',
        supportsPlaintextSourceEdit: false,
        bytecodeToSourceAllowed: true,
        decompilerTool: {
            toolName: 'SoulForge HKS IR',
            version: 'soulforge-hks-ir-1'
        },
        verifiedSamples: [
            'c0000_transition.hks'
        ]
    }
]);
export function resolveScriptLoaderProfile(context) {
    const game = context.game ?? 'sekiro';
    const container = context.containerPath ?? '';
    const entry = context.entryName ?? '';
    for (const profile of REGISTERED_SCRIPT_LOADER_PROFILES) {
        if (profile.game !== game)
            continue;
        const matchContainer = typeof profile.containerPattern === 'string'
            ? container.toLowerCase().includes(profile.containerPattern.toLowerCase())
            : profile.containerPattern.test(container);
        if (!matchContainer)
            continue;
        if (profile.entryPattern && entry) {
            const matchEntry = typeof profile.entryPattern === 'string'
                ? entry.toLowerCase().includes(profile.entryPattern.toLowerCase())
                : profile.entryPattern.test(entry);
            if (!matchEntry)
                continue;
        }
        return profile;
    }
    return undefined;
}
export function canEditScriptAsSource(profile, isBytecode) {
    if (!profile) {
        return {
            allowed: false,
            code: 'SCRIPT_PROFILE_NOT_REGISTERED',
            message: '该脚本资源未匹配任何已登记的 ScriptLoaderProfile，禁止作为源码编辑。'
        };
    }
    if (isBytecode) {
        if (!profile.bytecodeToSourceAllowed) {
            return {
                allowed: false,
                code: 'SCRIPT_BYTECODE_SOURCE_EDIT_PROHIBITED',
                message: `Profile '${profile.id}' 未开放当前 dialect 的源码编辑写回。`
            };
        }
    }
    else {
        if (!profile.supportsPlaintextSourceEdit) {
            return {
                allowed: false,
                code: 'SCRIPT_PLAINTEXT_SOURCE_EDIT_PROHIBITED',
                message: `Profile '${profile.id}' 未开放明文源码编辑。`
            };
        }
    }
    return { allowed: true };
}
//# sourceMappingURL=scriptLoaderProfile.js.map