/**
 * File-backed rollout storage (append-only JSONL) plus session directory
 * helpers. Path layout mirrors Codex's sessions tree
 * (<base>/sessions/YYYY/MM/DD/rollout-<timestamp>-<sessionId>.jsonl); the
 * base directory is always injected by the caller — desktop points it at
 * Electron userData, never at the Mod workspace (hard constraint 3).
 */
import { appendFile, mkdir, open, readFile, readdir, realpath, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isPathInside } from '../workspace/pathBoundary.js';
import { parseRolloutLines } from './rolloutRecorder.js';
export class FileRolloutStorage {
    filePath;
    tail = Promise.resolve();
    closed = false;
    constructor(filePath) {
        this.filePath = filePath;
    }
    async appendLines(lines) {
        if (this.closed)
            throw new Error('ROLLOUT_STORAGE_CLOSED: 存储已关闭。');
        // Single-writer invariant: serialize appends; an individual failure does
        // not poison later writes (the recorder retains unwritten items).
        const operation = this.tail.catch(() => undefined).then(async () => {
            await mkdir(dirname(this.filePath), { recursive: true });
            await appendFile(this.filePath, lines.map((line) => `${line}\n`).join(''), 'utf8');
        });
        this.tail = operation;
        await operation;
    }
    async readLines() {
        return splitRolloutLines(await readFile(this.filePath, 'utf8'));
    }
    async flush() {
        await this.tail.catch(() => undefined);
    }
    async close() {
        await this.flush();
        this.closed = true;
    }
}
function twoDigits(value) {
    return value < 10 ? `0${value}` : String(value);
}
export function rolloutSessionDir(baseDir, date = new Date()) {
    return join(baseDir, 'sessions', String(date.getUTCFullYear()), twoDigits(date.getUTCMonth() + 1), twoDigits(date.getUTCDate()));
}
export function newRolloutFilePath(baseDir, sessionId, date = new Date()) {
    const stamp = date.toISOString().replace(/[:.]/g, '-');
    return join(rolloutSessionDir(baseDir, date), `rollout-${stamp}-${sessionId}.jsonl`);
}
/**
 * List rollout sessions under the base dir, newest first, bounded by `limit`.
 * Files are read fully for the summary; the bound keeps listing lazy.
 *
 * Every directory level and every file is resolved with realpath before use:
 * a junction or symbolic link under sessions/ must not redirect the walk (or
 * the later summary read) outside the physical sessions directory.
 */
export async function listRolloutSessions(baseDir, limit = 50) {
    const root = join(baseDir, 'sessions');
    let physicalRoot;
    try {
        const physicalBase = await realpath(baseDir);
        physicalRoot = await realpath(root);
        // sessions/ itself must not be an alias for a directory outside the base.
        if (!isPathInside(physicalBase, physicalRoot))
            return [];
    }
    catch {
        return [];
    }
    const checkedPath = async (candidate) => {
        const physicalPath = await realpath(candidate);
        if (!isPathInside(physicalRoot, physicalPath)) {
            throw Object.assign(new Error('Rollout path must stay inside the sessions directory.'), { code: 'ROLLOUT_PATH_FORBIDDEN' });
        }
        return physicalPath;
    };
    const files = [];
    let yearDirs = [];
    try {
        yearDirs = await readdir(physicalRoot);
    }
    catch {
        return [];
    }
    for (const year of yearDirs) {
        const yearPath = join(root, year);
        let monthDirs = [];
        try {
            monthDirs = await readdir(await checkedPath(yearPath));
        }
        catch {
            continue;
        }
        for (const month of monthDirs) {
            const monthPath = join(yearPath, month);
            let dayDirs = [];
            try {
                dayDirs = await readdir(await checkedPath(monthPath));
            }
            catch {
                continue;
            }
            for (const day of dayDirs) {
                const dayPath = join(monthPath, day);
                let entries = [];
                try {
                    entries = await readdir(await checkedPath(dayPath));
                }
                catch {
                    continue;
                }
                for (const entry of entries) {
                    if (!entry.endsWith('.jsonl'))
                        continue;
                    const filePath = join(dayPath, entry);
                    try {
                        const info = await stat(await checkedPath(filePath));
                        if (!info.isFile())
                            continue;
                        files.push({
                            path: filePath,
                            fileName: entry,
                            sizeBytes: info.size,
                            modifiedAt: new Date(info.mtimeMs).toISOString()
                        });
                    }
                    catch {
                        continue;
                    }
                }
            }
        }
    }
    files.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
    const summaries = [];
    for (const file of files.slice(0, limit)) {
        try {
            // Re-check at read time and read the checked target, so an alias that is
            // retargeted after listing cannot redirect the summary read. The returned
            // path stays lexical for existing consumers.
            const raw = await readRolloutFileWithinSessions(baseDir, file.path);
            const lines = raw.split('\n').filter((line) => line.trim() !== '');
            const resumed = parseRolloutLines(lines);
            summaries.push({
                path: file.path,
                fileName: file.fileName,
                sessionId: resumed.meta?.sessionId ?? null,
                startedAt: resumed.meta?.startedAt ?? null,
                messageCount: resumed.messages.length,
                parseErrors: resumed.parseErrors,
                interrupted: resumed.interrupted,
                compactedWindows: resumed.compactedWindows,
                sizeBytes: file.sizeBytes,
                modifiedAt: file.modifiedAt
            });
        }
        catch {
            continue;
        }
    }
    return summaries;
}
/**
 * Read a rollout file only if it is physically inside `<baseDir>/sessions`.
 *
 * Callers such as SessionFeedbackService receive lexical paths from
 * listRolloutSessions; a directory level can be swapped for a junction between
 * listing and reading. The file is opened first, then its realpath is checked
 * against the physical sessions root, and the open handle must be the same file
 * (dev/ino) as the checked target, so the returned bytes always come from a file
 * that resolved inside sessions/. Throws ROLLOUT_PATH_FORBIDDEN otherwise.
 */
export async function readRolloutFileWithinSessions(baseDir, path) {
    const forbidden = () => Object.assign(new Error('Rollout path must stay inside the sessions directory.'), { code: 'ROLLOUT_PATH_FORBIDDEN' });
    const physicalBase = await realpath(baseDir);
    const physicalRoot = await realpath(join(baseDir, 'sessions'));
    if (!isPathInside(physicalBase, physicalRoot))
        throw forbidden();
    const handle = await open(path, 'r');
    try {
        const opened = await handle.stat({ bigint: true });
        const physicalPath = await realpath(path);
        if (!isPathInside(physicalRoot, physicalPath))
            throw forbidden();
        const checked = await stat(physicalPath, { bigint: true });
        if (!opened.isFile() || opened.dev !== checked.dev || opened.ino !== checked.ino)
            throw forbidden();
        return await handle.readFile({ encoding: 'utf8' });
    }
    finally {
        await handle.close();
    }
}
function splitRolloutLines(raw) {
    return raw.split('\n').filter((line) => line.trim() !== '');
}
/**
 * With sessionsBaseDir the file is read through readRolloutFileWithinSessions: the bytes come from the handle whose real
 * path was checked to be inside the physical sessions root, so a path checked earlier and then swapped for a junction is
 * not followed (ROLLOUT_PATH_FORBIDDEN). Without it the path is read as given (CLI and tests pass their own files).
 */
export async function loadRolloutSession(path, options = {}) {
    let lines;
    try {
        lines = options.sessionsBaseDir === undefined
            ? await new FileRolloutStorage(path).readLines()
            : splitRolloutLines(await readRolloutFileWithinSessions(options.sessionsBaseDir, path));
    }
    catch (error) {
        const code = typeof error === 'object' && error !== null ? error.code : undefined;
        if (code === 'ENOENT') {
            return { ok: false, code: 'ROLLOUT_NOT_FOUND', message: '会话记录不存在。' };
        }
        if (code === 'ROLLOUT_PATH_FORBIDDEN') {
            return { ok: false, code: 'ROLLOUT_PATH_FORBIDDEN', message: '会话记录不在会话目录内。' };
        }
        return {
            ok: false,
            code: 'ROLLOUT_READ_FAILED',
            message: error instanceof Error ? error.message : String(error)
        };
    }
    return { ok: true, path, ...parseRolloutLines(lines) };
}
//# sourceMappingURL=fileRolloutStorage.js.map