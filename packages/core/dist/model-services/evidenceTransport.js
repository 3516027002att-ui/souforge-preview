import { evidenceKey, evidenceResourceKey } from './evidenceIdentity.js';
export function encodeEvidenceClaims(claims) {
    if (!claims.length)
        return {};
    const rows = claims.map(({ key: _key, resourceKey: _resourceKey, handle, ...claim }) => ({
        ...claim,
        identity: { ...claim.identity },
        ...(handle === `${claim.identity.canonicalOuterId}#${claim.identity.objectHandle}` ? {} : { handle })
    }));
    const defaults = {};
    const identityDefaults = {};
    if (rows.length > 1) {
        for (const key of Object.keys(rows[0].identity)) {
            const first = rows[0].identity[key];
            if (rows.every(row => JSON.stringify(row.identity[key]) === JSON.stringify(first))) {
                identityDefaults[key] = first;
                for (const row of rows)
                    delete row.identity[key];
            }
        }
        for (const key of Object.keys(rows[0])) {
            if (key === 'identity')
                continue;
            const first = rows[0][key];
            if (rows.every(row => JSON.stringify(row[key]) === JSON.stringify(first))) {
                defaults[key] = first;
                for (const row of rows)
                    delete row[key];
            }
        }
    }
    if (Object.keys(identityDefaults).length)
        defaults.identity = identityDefaults;
    return { claims: rows, ...(Object.keys(defaults).length ? { claimDefaults: defaults } : {}) };
}
function record(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
/** Also accepts historical full claims. Validation/requiredness stays with the host. */
export function expandEvidenceClaims(evidence) {
    const envelope = record(evidence);
    if (!Array.isArray(envelope.claims))
        return [];
    const defaults = record(envelope.claimDefaults);
    return envelope.claims.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            return value;
        const row = record(value);
        const identity = { ...record(defaults.identity), ...record(row.identity) };
        const expanded = { ...defaults, ...row, identity };
        try {
            return {
                ...expanded,
                key: evidenceKey(identity),
                resourceKey: evidenceResourceKey(identity),
                handle: expanded.handle ?? `${identity.canonicalOuterId}#${identity.objectHandle}`
            };
        }
        catch {
            return null;
        }
    });
}
//# sourceMappingURL=evidenceTransport.js.map