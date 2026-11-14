/** T11-B/C 本地 IPC 守护宿主：同用户同工作区跨进程复用会话；禁止 TCP。 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { CoreToolSession } from '../runtime/coreToolSession.js';
import { LocalSessionHost, MAX_FRAME_BYTES, sessionError } from './localSessionHost.js';
export const DAEMON_PROTOCOL = 1;
const MAX_HANDSHAKE_BYTES = 16 * 1024;
const HANDSHAKE_TIMEOUT_MS = 10_000;
export function daemonPaths(workspaceKey, sessionName) {
    const safe = createHash('sha256').update(`${workspaceKey}|${sessionName}`).digest('hex').slice(0, 24);
    const dir = join(tmpdir(), 'soulforge-sessions', safe);
    const pipePath = process.platform === 'win32' ? `\\\\.\\pipe\\soulforge-${safe}` : join(dir, 'session.sock');
    return { dir, pipePath, lockPath: join(dir, 'lock'), authTokenPath: join(dir, 'auth') };
}
function readPidLock(lockPath) {
    try {
        const raw = readFileSync(lockPath, 'utf8').trim();
        const pid = Number(raw);
        return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
    }
    catch {
        return null;
    }
}
function pidAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
/** 同一 key 只产生一个有效 host：独占锁 + 拥有者存活检查。 */
export function tryAcquireStartLock(lockPath) {
    try {
        mkdirSync(join(lockPath, '..'), { recursive: true });
    }
    catch { /* 已存在则继续 */ }
    try {
        writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
        return true;
    }
    catch {
        const owner = readPidLock(lockPath);
        if (owner !== null && !pidAlive(owner)) {
            try {
                rmSync(lockPath, { force: true });
                writeFileSync(lockPath, String(process.pid), { flag: 'wx' });
                return true;
            }
            catch {
                return false;
            }
        }
        return false;
    }
}
export async function startSessionDaemon(input) {
    const paths = daemonPaths(input.workspaceKey, input.sessionName);
    mkdirSync(paths.dir, { recursive: true });
    if (!tryAcquireStartLock(paths.lockPath)) {
        throw new Error('CLI_SESSION_ALREADY_RUNNING');
    }
    const authToken = randomBytes(32).toString('hex');
    writeFileSync(paths.authTokenPath, authToken, { mode: 0o600 });
    const coreSession = input.coreSession ?? new CoreToolSession({ principal: input.principal, workspaceId: input.workspaceId });
    const config = {
        workspaceId: input.workspaceId,
        workspaceKey: input.workspaceKey,
        sessionName: input.sessionName,
        principal: input.principal,
        pipePath: paths.pipePath,
        lockPath: paths.lockPath,
        authTokenPath: paths.authTokenPath
    };
    const requestHost = new LocalSessionHost(input.sessionName, input.workspaceId, input.principal, coreSession);
    const server = createServer((socket) => handleDaemonSocket(socket, config, authToken, requestHost, input.dispatch));
    try {
        await new Promise((resolve, reject) => {
            const onError = (error) => {
                server.removeListener('listening', onListening);
                reject(error);
            };
            const onListening = () => {
                server.removeListener('error', onError);
                resolve();
            };
            server.once('error', onError);
            server.once('listening', onListening);
            server.listen(paths.pipePath);
        });
    }
    catch (error) {
        requestHost.close();
        if (!input.coreSession)
            coreSession.close();
        try {
            rmSync(paths.lockPath, { force: true });
        }
        catch { /* preserve original error */ }
        throw error;
    }
    return {
        config,
        coreSession,
        requestHost,
        close: async () => {
            if (!input.coreSession)
                coreSession.close();
            requestHost.close();
            await new Promise((resolve) => {
                if (!server.listening) {
                    resolve();
                    return;
                }
                server.close(() => resolve());
            });
            try {
                rmSync(paths.lockPath, { force: true });
            }
            catch { /* 关闭时锁清理失败不掩盖结果 */ }
        }
    };
}
function handleDaemonSocket(socket, config, authToken, requestHost, dispatch) {
    let buffer = '';
    let authed = false;
    let closed = false;
    const connectionAbort = new AbortController();
    const handshakeTimer = setTimeout(() => {
        if (authed || closed)
            return;
        write({ id: '', ok: false, error: sessionError('CLI_HANDSHAKE_TIMEOUT', '本地会话握手超时。', true) });
        connectionAbort.abort();
        socket.destroy();
        closed = true;
    }, HANDSHAKE_TIMEOUT_MS);
    handshakeTimer.unref?.();
    socket.setEncoding('utf8');
    const write = (frame) => {
        if (closed || socket.destroyed)
            return;
        try {
            socket.write(`${JSON.stringify(frame)}\n`, () => undefined);
        }
        catch {
            closed = true;
            connectionAbort.abort();
        }
    };
    socket.on('error', () => {
        closed = true;
        connectionAbort.abort();
        clearTimeout(handshakeTimer);
    });
    socket.on('close', () => {
        closed = true;
        connectionAbort.abort();
        clearTimeout(handshakeTimer);
    });
    socket.on('data', (chunk) => {
        if (closed)
            return;
        buffer += chunk;
        if (Buffer.byteLength(buffer, 'utf8') > MAX_FRAME_BYTES + MAX_HANDSHAKE_BYTES) {
            write({ id: '', ok: false, error: sessionError('CLI_FRAME_TOO_LARGE', '管道帧超过大小上限。', false) });
            socket.destroy();
            closed = true;
            return;
        }
        let newline = buffer.indexOf('\n');
        while (newline !== -1) {
            const line = buffer.slice(0, newline);
            buffer = buffer.slice(newline + 1);
            newline = buffer.indexOf('\n');
            if (line.trim() === '')
                continue;
            if (Buffer.byteLength(line, 'utf8') > MAX_FRAME_BYTES) {
                write({ id: '', ok: false, error: sessionError('CLI_FRAME_TOO_LARGE', '管道帧超过大小上限。', false) });
                socket.destroy();
                closed = true;
                return;
            }
            // The request host already serializes tool execution.  Do not serialize
            // the socket reader as well: a cancellation/status frame must be able to
            // reach the host while a native request is still running.
            void handleDaemonLine(write, socket, line, config, authToken, requestHost, dispatch, connectionAbort.signal, () => {
                authed = true;
                clearTimeout(handshakeTimer);
            }, () => authed).catch(() => undefined);
        }
    });
}
async function handleDaemonLine(write, socket, line, config, authToken, requestHost, dispatch, signal, markAuthed, isAuthed) {
    let frame;
    try {
        frame = JSON.parse(line);
    }
    catch {
        write({ id: '', ok: false, error: sessionError('CLI_FRAME_INVALID', '管道帧不是有效 JSON。', false) });
        return;
    }
    if (!isAuthed()) {
        const handshake = frame;
        if (handshake.protocol !== DAEMON_PROTOCOL
            || handshake.workspaceKey !== config.workspaceKey
            || handshake.sessionName !== config.sessionName
            || handshake.authToken !== authToken) {
            write({ id: '', ok: false, error: sessionError('CLI_SESSION_AUTH_FAILED', '本地会话握手认证失败。', false) });
            socket.end();
            return;
        }
        markAuthed();
        write({ id: 'handshake', ok: true, handshake: true });
        return;
    }
    const id = typeof frame.id === 'string' ? frame.id : '';
    const tool = typeof frame.tool === 'string' ? frame.tool : '';
    const args = typeof frame.args === 'object' && frame.args !== null ? frame.args : {};
    if (!id || !tool) {
        write({ id, ok: false, error: sessionError('CLI_REQUEST_INVALID', '本地会话请求格式无效。', false) });
        return;
    }
    if (tool === '__host_status') {
        const statuses = requestHost.listRequestStatuses();
        write({
            id,
            ok: true,
            result: {
                session: config.sessionName,
                workspaceId: config.workspaceId,
                inFlight: statuses.filter((item) => ['queued', 'running', 'cancel_requested'].includes(item.state)).length,
                requests: statuses
            }
        });
        return;
    }
    if (tool === '__host_operation_status') {
        const opId = typeof args.opId === 'string' ? args.opId : '';
        if (!opId) {
            write({ id, ok: false, error: sessionError('CLI_OPERATION_ID_REQUIRED', '必须提供 opId。') });
            return;
        }
        write({ id, ok: true, result: await requestHost.operationStatus(opId) });
        return;
    }
    if (tool === '__host_cancel') {
        const targetId = typeof args.requestId === 'string' ? args.requestId : id;
        write({ id, ok: true, result: requestHost.requestCancel(targetId) });
        return;
    }
    if (tool === '__host_request_status') {
        const targetId = typeof args.requestId === 'string' ? args.requestId : id;
        const status = await requestHost.resolveRequestStatus(targetId);
        write(status
            ? { id, ok: true, result: status }
            : { id, ok: false, error: sessionError('CLI_REQUEST_NOT_FOUND', `没有找到请求 ${targetId}。`, false) });
        return;
    }
    try {
        const outcome = await requestHost.dispatch({ id, tool, args }, dispatch, signal);
        write(outcome);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const code = /^CLI_[A-Z0-9_]+/u.exec(message)?.[0] ?? 'CLI_REQUEST_FAILED';
        write({ id, ok: false, error: sessionError(code, message, code === 'CLI_REQUEST_TIMEOUT' || code === 'CLI_DAEMON_DISCONNECTED') });
    }
}
//# sourceMappingURL=sessionPipeDaemon.js.map