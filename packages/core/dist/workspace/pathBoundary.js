import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
/**
 * Authoritative filesystem boundary check for write targets.
 *
 * A lexical `path.resolve()` prefix check is not enough on Windows because a
 * junction or symbolic link inside the workspace can redirect a write outside
 * the selected root. This function resolves every existing path prefix and
 * rejects the first prefix whose real target escapes the real workspace root.
 * Non-existing suffixes are safe only when their nearest existing ancestor is
 * still inside the root.
 */
export async function verifyPathInsideRoot(rootPath, candidatePath) {
    const lexicalRoot = resolve(rootPath);
    const lexicalCandidate = resolve(candidatePath);
    if (!isPathInside(lexicalRoot, lexicalCandidate)) {
        return failed('WRITE_OUTSIDE_ALLOWED_ROOT', '写入目标不在允许的根目录内。', {
            rootPath: lexicalRoot,
            candidatePath: lexicalCandidate,
            phase: 'lexical'
        });
    }
    let physicalRoot;
    try {
        physicalRoot = await realpath(lexicalRoot);
    }
    catch (error) {
        return failed('WRITE_ROOT_REALPATH_FAILED', '无法解析允许根目录的真实路径。', {
            rootPath: lexicalRoot,
            error: errorMessage(error)
        });
    }
    const relativeCandidate = relative(lexicalRoot, lexicalCandidate);
    if (relativeCandidate === '') {
        return {
            ok: true,
            rootPath: physicalRoot,
            candidatePath: physicalRoot,
            diagnostics: []
        };
    }
    const segments = relativeCandidate.split(/[\\/]+/).filter(Boolean);
    let current = lexicalRoot;
    let lastPhysical = physicalRoot;
    for (const segment of segments) {
        current = resolve(current, segment);
        try {
            // lstat forces Node to inspect a reparse point itself before realpath
            // follows it. realpath then gives the actual target for containment.
            await lstat(current);
            lastPhysical = await realpath(current);
        }
        catch (error) {
            if (isMissingPathError(error))
                break;
            return failed('WRITE_PATH_INSPECTION_FAILED', '无法检查写入目标的真实路径。', {
                rootPath: physicalRoot,
                candidatePath: lexicalCandidate,
                inspectedPath: current,
                error: errorMessage(error)
            });
        }
        if (!isPathInside(physicalRoot, lastPhysical)) {
            return failed('WRITE_REPARSE_POINT_ESCAPE', '写入路径经过了指向允许根目录之外的链接或联接点。', {
                rootPath: physicalRoot,
                candidatePath: lexicalCandidate,
                escapedAt: current,
                resolvedTarget: lastPhysical
            });
        }
    }
    return {
        ok: true,
        rootPath: physicalRoot,
        candidatePath: lexicalCandidate,
        diagnostics: []
    };
}
export function isPathInside(rootPath, candidatePath) {
    const resolvedRoot = resolve(rootPath);
    const resolvedCandidate = resolve(candidatePath);
    if (pathsEqual(resolvedRoot, resolvedCandidate))
        return true;
    const rel = relative(resolvedRoot, resolvedCandidate);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
export function pathsEqual(left, right) {
    const normalizedLeft = resolve(left);
    const normalizedRight = resolve(right);
    return process.platform === 'win32'
        ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
        : normalizedLeft === normalizedRight;
}
function failed(code, message, details) {
    const candidatePath = typeof details === 'object' && details !== null && 'candidatePath' in details
        ? String(details.candidatePath)
        : '';
    const rootPath = typeof details === 'object' && details !== null && 'rootPath' in details
        ? String(details.rootPath)
        : '';
    return {
        ok: false,
        rootPath,
        candidatePath,
        diagnostics: [{ severity: 'error', code, message, details }]
    };
}
function isMissingPathError(error) {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error.code === 'ENOENT'
            || error.code === 'ENOTDIR');
}
function errorMessage(error) {
    return error instanceof Error ? error.message : String(error);
}
//# sourceMappingURL=pathBoundary.js.map