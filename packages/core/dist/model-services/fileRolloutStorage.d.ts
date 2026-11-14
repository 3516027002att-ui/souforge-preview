/**
 * File-backed rollout storage (append-only JSONL) plus session directory
 * helpers. Path layout mirrors Codex's sessions tree
 * (<base>/sessions/YYYY/MM/DD/rollout-<timestamp>-<sessionId>.jsonl); the
 * base directory is always injected by the caller — desktop points it at
 * Electron userData, never at the Mod workspace (hard constraint 3).
 */
import type { RolloutStorage } from './rolloutRecorder.js';
import { type ResumedRollout } from './rolloutRecorder.js';
export declare class FileRolloutStorage implements RolloutStorage {
    readonly filePath: string;
    private tail;
    private closed;
    constructor(filePath: string);
    appendLines(lines: string[]): Promise<void>;
    readLines(): Promise<string[]>;
    flush(): Promise<void>;
    close(): Promise<void>;
}
export declare function rolloutSessionDir(baseDir: string, date?: Date): string;
export declare function newRolloutFilePath(baseDir: string, sessionId: string, date?: Date): string;
export interface RolloutSessionSummary {
    path: string;
    fileName: string;
    sessionId: string | null;
    startedAt: string | null;
    messageCount: number;
    parseErrors: number;
    interrupted: boolean;
    compactedWindows: number;
    sizeBytes: number;
    modifiedAt: string;
}
/**
 * List rollout sessions under the base dir, newest first, bounded by `limit`.
 * Files are read fully for the summary; the bound keeps listing lazy.
 *
 * Every directory level and every file is resolved with realpath before use:
 * a junction or symbolic link under sessions/ must not redirect the walk (or
 * the later summary read) outside the physical sessions directory.
 */
export declare function listRolloutSessions(baseDir: string, limit?: number): Promise<RolloutSessionSummary[]>;
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
export declare function readRolloutFileWithinSessions(baseDir: string, path: string): Promise<string>;
export type LoadRolloutSessionResult = ({
    ok: true;
    path: string;
} & ResumedRollout) | {
    ok: false;
    code: 'ROLLOUT_NOT_FOUND' | 'ROLLOUT_READ_FAILED' | 'ROLLOUT_PATH_FORBIDDEN';
    message: string;
};
/**
 * With sessionsBaseDir the file is read through readRolloutFileWithinSessions: the bytes come from the handle whose real
 * path was checked to be inside the physical sessions root, so a path checked earlier and then swapped for a junction is
 * not followed (ROLLOUT_PATH_FORBIDDEN). Without it the path is read as given (CLI and tests pass their own files).
 */
export declare function loadRolloutSession(path: string, options?: {
    sessionsBaseDir?: string;
}): Promise<LoadRolloutSessionResult>;
