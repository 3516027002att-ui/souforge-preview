/**
 * Stable resource / field URI model (architecture forks #102, #104).
 *
 * Resource identity must not rely on filesystem path alone.
 * This module provides typed URIs for overlay layers, containers, symbols, versions, and hashes.
 *
 * Scaffold only — not a full native format authority parser.
 */
const OVERLAY_LAYER_IDS = new Set([
    'base',
    'overlay',
    'staging',
    'generated',
    'synthetic'
]);
const RESOURCE_KINDS = new Set([
    'event',
    'map',
    'param',
    'msg',
    'menu',
    'script',
    'action',
    'ai',
    'sfx',
    'chr',
    'obj',
    'other',
    'unknown'
]);
/**
 * Create a ResourceURI from structured parts.
 */
export function createResourceUri(input) {
    const uri = {
        scheme: 'soulforge',
        game: input.game ?? 'unknown',
        overlay: input.overlay ?? 'overlay',
        physicalPath: normalizePosixPath(input.physicalPath),
        resourceKind: input.resourceKind
    };
    if (input.containerPath !== undefined)
        uri.containerPath = normalizePosixPath(input.containerPath);
    if (input.symbolPath !== undefined)
        uri.symbolPath = normalizeSymbolPath(input.symbolPath);
    if (input.version !== undefined)
        uri.version = input.version;
    if (input.contentHash !== undefined)
        uri.contentHash = input.contentHash;
    return uri;
}
export function createFieldUri(input) {
    return {
        resource: createResourceUri(input),
        fieldPath: normalizeFieldPath(input.fieldPath)
    };
}
/**
 * Format ResourceURI to a stable string.
 *
 * soulforge://{game}/{overlay}/{kind}/{physicalPath}
 *   [?container=][&symbol=][&v=][&hash=]
 *
 * Uses an authority (game) so URL parsing is stable across runtimes.
 */
export function formatResourceUri(uri) {
    const path = [
        encodeURIComponent(uri.overlay),
        encodeURIComponent(uri.resourceKind),
        ...splitPathSegments(uri.physicalPath).map(encodeURIComponent)
    ].join('/');
    const base = `soulforge://${encodeURIComponent(uri.game)}/${path}`;
    const query = new URLSearchParams();
    if (uri.containerPath)
        query.set('container', uri.containerPath);
    if (uri.symbolPath)
        query.set('symbol', uri.symbolPath);
    if (uri.version)
        query.set('v', uri.version);
    if (uri.contentHash)
        query.set('hash', uri.contentHash);
    const qs = query.toString();
    return qs ? `${base}?${qs}` : base;
}
export function formatFieldUri(field) {
    const resource = formatResourceUri(field.resource);
    const sep = resource.includes('?') ? '&' : '?';
    return `${resource}${sep}field=${encodeURIComponent(field.fieldPath)}`;
}
/**
 * Parse a soulforge ResourceURI string.
 * Throws on unrecoverable syntax errors; use validateResourceUri for soft checks.
 */
export function parseResourceUri(value) {
    const result = tryParseResourceUri(value);
    if (!result.ok || !result.uri) {
        throw new Error(result.errors.join('; ') || `Invalid ResourceURI: ${value}`);
    }
    return result.uri;
}
export function parseFieldUri(value) {
    const result = tryParseFieldUri(value);
    if (!result.ok || !result.field) {
        throw new Error(result.errors.join('; ') || `Invalid FieldURI: ${value}`);
    }
    return result.field;
}
export function tryParseResourceUri(value) {
    const errors = [];
    if (typeof value !== 'string' || value.length === 0) {
        return { ok: false, errors: ['URI must be a non-empty string'] };
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return { ok: false, errors: [`URI is not a valid URL: ${value}`] };
    }
    if (url.protocol !== 'soulforge:') {
        errors.push(`Expected scheme soulforge:, got ${url.protocol}`);
    }
    // Preferred form: soulforge://{game}/{overlay}/{kind}/{physicalPath}
    // Fallback form: soulforge:/{game}/{overlay}/{kind}/{physicalPath}
    const pathParts = url.pathname
        .split('/')
        .filter(Boolean)
        .map((part) => {
        try {
            return decodeURIComponent(part);
        }
        catch {
            errors.push(`Invalid percent-encoding in path segment: ${part}`);
            return part;
        }
    });
    let game = '';
    let overlayRaw = '';
    let kindRaw = '';
    let physicalPath = '';
    if (url.host) {
        try {
            game = decodeURIComponent(url.hostname || url.host);
        }
        catch {
            game = url.hostname || url.host;
            errors.push(`Invalid percent-encoding in game host: ${url.host}`);
        }
        if (pathParts.length < 3) {
            errors.push('ResourceURI requires overlay/kind/physicalPath under game host');
        }
        overlayRaw = pathParts[0] ?? '';
        kindRaw = pathParts[1] ?? '';
        physicalPath = pathParts.slice(2).join('/');
    }
    else {
        if (pathParts.length < 4) {
            errors.push('ResourceURI requires game/overlay/kind/physicalPath');
        }
        game = pathParts[0] ?? '';
        overlayRaw = pathParts[1] ?? '';
        kindRaw = pathParts[2] ?? '';
        physicalPath = pathParts.slice(3).join('/');
    }
    if (!OVERLAY_LAYER_IDS.has(overlayRaw)) {
        errors.push(`Invalid overlay layer: ${overlayRaw}`);
    }
    if (!RESOURCE_KINDS.has(kindRaw)) {
        errors.push(`Invalid resource kind: ${kindRaw}`);
    }
    if (!physicalPath) {
        errors.push('physicalPath is required');
    }
    const overlay = overlayRaw;
    const resourceKind = kindRaw;
    const uri = {
        scheme: 'soulforge',
        game: game || 'unknown',
        overlay: OVERLAY_LAYER_IDS.has(overlay) ? overlay : 'overlay',
        physicalPath: normalizePosixPath(physicalPath || 'unknown'),
        resourceKind: RESOURCE_KINDS.has(resourceKind) ? resourceKind : 'unknown'
    };
    const container = url.searchParams.get('container');
    const symbol = url.searchParams.get('symbol');
    const version = url.searchParams.get('v');
    const hash = url.searchParams.get('hash');
    if (container)
        uri.containerPath = normalizePosixPath(container);
    if (symbol)
        uri.symbolPath = normalizeSymbolPath(symbol);
    if (version)
        uri.version = version;
    if (hash)
        uri.contentHash = hash;
    if (errors.length > 0)
        return { ok: false, errors };
    return { ok: true, errors: [], uri };
}
export function tryParseFieldUri(value) {
    const resourceResult = tryParseResourceUri(value);
    if (!resourceResult.ok || !resourceResult.uri) {
        return { ok: false, errors: resourceResult.errors };
    }
    let url;
    try {
        url = new URL(value);
    }
    catch {
        return { ok: false, errors: [`Invalid FieldURI URL: ${value}`] };
    }
    const fieldPath = url.searchParams.get('field');
    if (!fieldPath) {
        return { ok: false, errors: ['FieldURI requires field query parameter'] };
    }
    return {
        ok: true,
        errors: [],
        field: {
            resource: resourceResult.uri,
            fieldPath: normalizeFieldPath(fieldPath)
        }
    };
}
export function validateResourceUri(uri) {
    if (typeof uri === 'string') {
        const parsed = tryParseResourceUri(uri);
        return { ok: parsed.ok, errors: parsed.errors };
    }
    const errors = [];
    if (uri.scheme !== 'soulforge')
        errors.push('scheme must be soulforge');
    if (!uri.game)
        errors.push('game is required');
    if (!OVERLAY_LAYER_IDS.has(uri.overlay))
        errors.push(`invalid overlay: ${uri.overlay}`);
    if (!RESOURCE_KINDS.has(uri.resourceKind))
        errors.push(`invalid resourceKind: ${uri.resourceKind}`);
    if (!uri.physicalPath)
        errors.push('physicalPath is required');
    if (uri.physicalPath.includes('\\'))
        errors.push('physicalPath must use POSIX separators');
    if (uri.contentHash && !/^[a-fA-F0-9]{8,128}$/.test(uri.contentHash)) {
        errors.push('contentHash must be hex');
    }
    return { ok: errors.length === 0, errors };
}
export function validateFieldUri(field) {
    if (typeof field === 'string') {
        const parsed = tryParseFieldUri(field);
        return { ok: parsed.ok, errors: parsed.errors };
    }
    const resourceCheck = validateResourceUri(field.resource);
    const errors = [...resourceCheck.errors];
    if (!field.fieldPath)
        errors.push('fieldPath is required');
    return { ok: errors.length === 0, errors };
}
/** Compare identity ignoring version/hash (stable resource key). */
export function resourceUriIdentityKey(uri) {
    return formatResourceUri({
        scheme: 'soulforge',
        game: uri.game,
        overlay: uri.overlay,
        physicalPath: uri.physicalPath,
        resourceKind: uri.resourceKind,
        ...(uri.containerPath ? { containerPath: uri.containerPath } : {}),
        ...(uri.symbolPath ? { symbolPath: uri.symbolPath } : {})
    });
}
export function isOverlayLayerId(value) {
    return OVERLAY_LAYER_IDS.has(value);
}
function normalizePosixPath(pathValue) {
    return pathValue.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+/g, '/');
}
function normalizeSymbolPath(pathValue) {
    return pathValue.replaceAll('\\', '/').replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}
function normalizeFieldPath(pathValue) {
    return pathValue.replaceAll('\\', '/').replace(/^\.+|\.+$/g, '').replace(/\.+/g, '.');
}
function splitPathSegments(pathValue) {
    return normalizePosixPath(pathValue).split('/').filter(Boolean);
}
//# sourceMappingURL=resource-uri.js.map