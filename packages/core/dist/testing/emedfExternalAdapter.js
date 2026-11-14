/**
 * External-only adapter for DarkScript3-format EMEDF JSON files.
 *
 * This module is an external-only development/validation adapter. Production
 * never reads a user-provided EMEDF file and never uses this adapter at
 * runtime. The checked-in production registry is maintained separately as
 * SoulForge first-party semantic data; this adapter remains local-only for
 * cross-validation.
 *
 * DarkScript3 is "All Rights Reserved" by its copyright owners. This adapter
 * reads from a user-provided local file path (e.g. from the user's own
 * DarkScript3 installation) and converts it to SoulForge's internal registry
 * format for validation only.
 *
 * Type code mapping (DarkScript3 → SoulForge):
 *   0 → u8, 1 → u16, 2 → u32, 3 → s8, 4 → s16, 5 → s32, 6 → f32, 8 → u32
 */
import { readFileSync } from 'node:fs';
import { validateEmedfRegistry } from '../emevd/emedfSchema.js';
/* ------------------------------------------------------------------ */
/*  Type mapping                                                      */
/* ------------------------------------------------------------------ */
const DS3_TYPE_MAP = {
    0: 'u8',
    1: 'u16',
    2: 'u32',
    3: 's8',
    4: 's16',
    5: 's32',
    6: 'f32',
    8: 'u32', // string position, treated as u32
};
/* ------------------------------------------------------------------ */
/*  Adapter                                                           */
/* ------------------------------------------------------------------ */
/**
 * Parse a DarkScript3 EMEDF JSON string into a SoulForge EmedfRegistry.
 * Does NOT touch the filesystem — callers provide the raw text.
 * Handles JSON with // and /* *​/ comments (Newtonsoft.Json compat).
 */
export function parseDs3EmedfJson(jsonText) {
    let raw;
    try {
        raw = JSON.parse(stripJsonComments(jsonText));
    }
    catch {
        return { ok: false, code: 'EMEDF_IMPORT_PARSE_FAILED', message: 'EMEDF JSON 解析失败。' };
    }
    if (!raw || !Array.isArray(raw.main_classes)) {
        return {
            ok: false,
            code: 'EMEDF_IMPORT_SCHEMA_INVALID',
            message: 'EMEDF JSON 缺少 main_classes 数组。',
        };
    }
    const enums = {};
    if (Array.isArray(raw.enums)) {
        for (const item of raw.enums) {
            if (!item || typeof item !== 'object')
                continue;
            const enumDoc = item;
            if (typeof enumDoc.name !== 'string' || !enumDoc.name.trim())
                continue;
            const rawName = enumDoc.name.trim();
            const pascalName = sanitizeEnumName(rawName);
            const members = [];
            if (enumDoc.values && typeof enumDoc.values === 'object') {
                for (const [key, val] of Object.entries(enumDoc.values)) {
                    const num = Number(key);
                    if (!Number.isFinite(num))
                        continue;
                    const memberLabel = typeof val === 'string' ? val.trim() : String(val);
                    const memberName = sanitizeEnumMemberName(memberLabel);
                    members.push({
                        value: num,
                        name: memberName,
                        label: memberLabel,
                    });
                }
            }
            const enumDef = {
                name: pascalName,
                members,
            };
            enums[pascalName] = enumDef;
            if (rawName !== pascalName) {
                enums[rawName] = enumDef;
            }
        }
    }
    const instructions = [];
    const bankSet = new Set();
    for (const cls of raw.main_classes) {
        if (!cls || !Number.isSafeInteger(cls.index) || cls.index < 0)
            continue;
        const bank = cls.index;
        bankSet.add(bank);
        if (!Array.isArray(cls.instrs))
            continue;
        for (const instr of cls.instrs) {
            if (!instr || !Number.isSafeInteger(instr.index) || instr.index < 0)
                continue;
            if (typeof instr.name !== 'string' || !instr.name.trim())
                continue;
            const args = [];
            if (Array.isArray(instr.args)) {
                const usedNames = new Set();
                for (const arg of instr.args) {
                    if (!arg || typeof arg.name !== 'string' || !arg.name.trim())
                        continue;
                    const mappedType = DS3_TYPE_MAP[arg.type];
                    if (!mappedType)
                        continue; // unknown type code — skip arg
                    let sanitizedName = sanitizeArgName(arg.name);
                    // Deduplicate: append _2, _3, ... on collision
                    if (usedNames.has(sanitizedName)) {
                        let suffix = 2;
                        while (usedNames.has(`${sanitizedName}_${suffix}`))
                            suffix++;
                        sanitizedName = `${sanitizedName}_${suffix}`;
                    }
                    usedNames.add(sanitizedName);
                    const def = {
                        name: sanitizedName,
                        type: mappedType,
                    };
                    if (arg.enum_name) {
                        const rawEnum = arg.enum_name.trim();
                        const pascalEnum = sanitizeEnumName(rawEnum);
                        def.enumName = pascalEnum;
                        def.description = `enum:${pascalEnum}`;
                    }
                    if (arg.default !== undefined && Number.isFinite(arg.default)) {
                        def.default = arg.default;
                    }
                    if (arg.min !== undefined && Number.isFinite(arg.min)) {
                        def.min = arg.min;
                    }
                    if (arg.max !== undefined && Number.isFinite(arg.max)) {
                        def.max = arg.max;
                    }
                    if (arg.increment !== undefined && Number.isFinite(arg.increment)) {
                        def.increment = arg.increment;
                    }
                    if (arg.format_string) {
                        def.formatString = arg.format_string;
                    }
                    if (arg.vararg === true) {
                        def.vararg = true;
                    }
                    args.push(def);
                }
            }
            instructions.push({
                bank,
                id: instr.index,
                name: sanitizeInstructionName(instr.name),
                args,
            });
        }
    }
    const registry = {
        schemaVersion: 1,
        game: 'sekiro',
        origin: 'imported',
        banks: [...bankSet].sort((a, b) => a - b),
        instructions,
        enums,
    };
    const validation = validateEmedfRegistry(registry);
    if (!validation.ok) {
        return {
            ok: false,
            code: validation.code,
            message: `EMEDF 导入验证失败：${validation.message}`,
        };
    }
    return {
        ok: true,
        registry,
        instructionCount: instructions.length,
        bankCount: bankSet.size,
    };
}
/**
 * Read and parse a DarkScript3 EMEDF JSON file from a local path.
 * The caller is responsible for ensuring the path is safe and user-provided.
 */
export function importDs3EmedfFile(filePath) {
    let text;
    try {
        text = readFileSync(filePath, 'utf-8');
    }
    catch {
        return {
            ok: false,
            code: 'EMEDF_IMPORT_READ_FAILED',
            message: `无法读取 EMEDF 文件：${filePath}`,
        };
    }
    return parseDs3EmedfJson(text);
}
/* ------------------------------------------------------------------ */
/*  Name sanitization                                                 */
/* ------------------------------------------------------------------ */
/** DarkScript3 uses "IF Condition Group" style; SoulForge uses camelCase identifiers. */
function sanitizeInstructionName(raw) {
    return raw
        .replace(/[^A-Za-z0-9_ ]/g, '')
        .split(/\s+/)
        .map((word, i) => i === 0
        ? word.charAt(0).toUpperCase() + word.slice(1)
        : word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
}
/** DarkScript3 arg names like "Result Condition Group" → "resultConditionGroup". */
function sanitizeArgName(raw) {
    const words = raw
        .replace(/[^A-Za-z0-9_ ]/g, '')
        .split(/\s+/)
        .filter(Boolean);
    if (words.length === 0)
        return 'unknown';
    return words
        .map((word, i) => {
        // All-caps acronyms (e.g. "ID") become title-case ("Id") so the camelCase
        // result is conventional ("eventId", "eventSlotId") and stable for DSL.
        if (word === word.toUpperCase() && /[A-Z]/.test(word)) {
            return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
        }
        return i === 0
            ? word.charAt(0).toLowerCase() + word.slice(1)
            : word.charAt(0).toUpperCase() + word.slice(1);
    })
        .join('');
}
export function sanitizeEnumName(raw) {
    return raw
        .replace(/[^A-Za-z0-9_ ]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
}
export function sanitizeEnumMemberName(raw) {
    const sanitized = raw
        .replace(/[^A-Za-z0-9_ ]/g, '')
        .split(/\s+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
    if (/^[0-9]/.test(sanitized)) {
        return `_${sanitized}`;
    }
    return sanitized || 'Unknown';
}
/* ------------------------------------------------------------------ */
/*  JSON comment stripping (Newtonsoft.Json compat)                   */
/* ------------------------------------------------------------------ */
/**
 * Strip // line comments and /* block comments *​/ from JSON text,
 * respecting string literals. Also removes trailing commas before ] or }
 * (Newtonsoft.Json compat). DarkScript3 EMEDF JSON uses both features.
 */
function stripJsonComments(text) {
    let result = '';
    let i = 0;
    let inString = false;
    let stringChar = '';
    while (i < text.length) {
        const ch = text[i];
        if (inString) {
            result += ch;
            if (ch === '\\') {
                // skip escaped char
                i++;
                if (i < text.length)
                    result += text[i];
            }
            else if (ch === stringChar) {
                inString = false;
            }
            i++;
            continue;
        }
        if (ch === '"' || ch === "'") {
            inString = true;
            stringChar = ch;
            result += ch;
            i++;
            continue;
        }
        if (ch === '/' && i + 1 < text.length) {
            const next = text[i + 1];
            if (next === '/') {
                // line comment — skip to end of line
                i += 2;
                while (i < text.length && text[i] !== '\n')
                    i++;
                continue;
            }
            if (next === '*') {
                // block comment — skip to *​/
                i += 2;
                while (i + 1 < text.length && !(text[i] === '*' && text[i + 1] === '/'))
                    i++;
                i += 2;
                continue;
            }
        }
        result += ch;
        i++;
    }
    // Remove trailing commas before ] or } (Newtonsoft.Json compat)
    return result.replace(/,\s*([\]}])/g, '$1');
}
//# sourceMappingURL=emedfExternalAdapter.js.map