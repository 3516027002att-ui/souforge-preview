/**
 * Files Mode capability matrix for any overlay path.
 * Does not claim native structured edit for packed formats.
 */
import { basename, extname } from 'node:path';
const TEXT_EXTENSIONS = new Set([
    '.txt', '.md', '.json', '.xml', '.yml', '.yaml', '.lua', '.hks',
    '.js', '.ts', '.csv', '.ini', '.cfg', '.toml', '.log', '.css', '.html'
]);
export function compoundExtensionOf(relativePath) {
    const name = basename(relativePath).toLowerCase();
    const parts = name.split('.');
    if (parts.length <= 1)
        return '';
    return `.${parts.slice(1).join('.')}`;
}
export function formatKindFromPath(relativePath) {
    const compound = compoundExtensionOf(relativePath);
    const extension = extname(relativePath).toLowerCase();
    if (compound.endsWith('.emevd.dcx') || compound.endsWith('.emevd'))
        return 'emevd';
    if (compound.endsWith('.msb.dcx') || compound.endsWith('.msb'))
        return 'msb';
    if (compound.includes('.param'))
        return 'param';
    if (compound.includes('.fmg'))
        return 'fmg';
    if (compound.includes('.bnd'))
        return 'bnd';
    if (compound.endsWith('.dcx'))
        return 'dcx';
    if (extension === '.lua')
        return 'lua';
    if (extension === '.hks')
        return 'hks';
    if (TEXT_EXTENSIONS.has(extension))
        return 'text';
    return 'unknown';
}
export function resourceKindFromPath(relativePath) {
    const first = relativePath.replaceAll('\\', '/').split('/')[0]?.toLowerCase() ?? '';
    const map = {
        event: 'event',
        map: 'map',
        param: 'param',
        msg: 'msg',
        menu: 'menu',
        script: 'script',
        action: 'action',
        ai: 'ai',
        sfx: 'sfx',
        chr: 'chr',
        obj: 'obj',
        other: 'other'
    };
    return map[first] ?? 'unknown';
}
export function isPackedOrNativeFormat(formatKind, relativePath) {
    if (['dcx', 'bnd', 'emevd', 'msb', 'param', 'fmg', 'tpf', 'gfx'].includes(formatKind))
        return true;
    const compound = compoundExtensionOf(relativePath);
    return compound.includes('.dcx') || compound.includes('.bnd');
}
export function isTextLikePath(relativePath) {
    const extension = extname(relativePath).toLowerCase();
    const compound = compoundExtensionOf(relativePath);
    return TEXT_EXTENSIONS.has(extension) || TEXT_EXTENSIONS.has(compound);
}
export function getFileCapabilities(input) {
    const relativePath = input.relativePath.replaceAll('\\', '/');
    const formatKind = formatKindFromPath(relativePath);
    const resourceKind = resourceKindFromPath(relativePath);
    const packed = isPackedOrNativeFormat(formatKind, relativePath);
    const textLike = isTextLikePath(relativePath) && !packed;
    const binaryLike = packed || input.looksBinary === true || !textLike;
    const notes = [];
    const capabilities = ['read', 'bounded_preview'];
    let writeRiskDefault = 'safe';
    let structuredEditAllowed = false;
    if (textLike) {
        capabilities.push('text_edit', 'raw_edit', 'whole_file_replace');
        writeRiskDefault = 'safe';
        notes.push('Text-like file supports Files Mode text_edit.');
    }
    else if (packed) {
        capabilities.push('raw_edit', 'whole_file_replace');
        writeRiskDefault = 'high';
        notes.push('Packed/native-like file: only high-risk raw_edit / whole-file replace via Files Mode.');
        notes.push('Structured native edit is blocked (no native writer).');
    }
    else if (binaryLike) {
        capabilities.push('raw_edit', 'whole_file_replace');
        writeRiskDefault = 'caution';
        notes.push('Binary-like file: raw_edit / whole-file replace only.');
    }
    else {
        capabilities.push('none');
        writeRiskDefault = 'blocked';
    }
    return {
        relativePath,
        absolutePath: input.absolutePath,
        resourceKind,
        formatKind,
        capabilities,
        isTextLike: textLike,
        isPackedOrNative: packed,
        isBinaryLike: binaryLike,
        structuredEditAllowed,
        writeRiskDefault,
        nativeFormatAuthority: false,
        notes
    };
}
//# sourceMappingURL=fileCapabilities.js.map