/** T11-C 本地 IPC 客户端：握手、请求与结果传输；只走本机管道，不走 TCP。 */
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { connect } from 'node:net';
import { DAEMON_PROTOCOL, daemonPaths } from './sessionPipeDaemon.js';
import { MAX_FRAME_BYTES } from './localSessionHost.js';
import { summarizeOperationOutcomes } from '../runtime/operationOutcome.js';
export class SessionTransportError extends Error {
    requestId;
    code;
    retryable = false;
    transaction = summarizeOperationOutcomes([]);
    constructor(requestId, code, cause) {
        super(`${code}: 请求已发送，事务结果尚未确认；请查询请求或操作状态。`, { cause });
        this.requestId = requestId;
        this.code = code;
    }
}
const DEFAULT_CALL_TIMEOUT_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 10_000;
export class SessionPipeClient {
    socket = null;
    buffer = '';
    pending = new Map();
    handshakeDone = false;
    async connect(workspaceKey, sessionName) {
        const paths = daemonPaths(workspaceKey, sessionName);
        const authToken = readFileSync(paths.authTokenPath, 'utf8').trim();
        this.socket = connect(paths.pipePath);
        this.socket.setEncoding('utf8');
        await new Promise((resolve, reject) => {
            const onConnect = () => {
                this.socket?.removeListener('error', onError);
                resolve();
            };
            const onError = (error) => {
                this.socket?.removeListener('connect', onConnect);
                reject(error);
            };
            this.socket.once('connect', onConnect);
            this.socket.once('error', onError);
        });
        this.socket.on('data', (chunk) => this.onData(chunk));
        this.socket.on('error', (error) => this.failPending(error instanceof Error ? error : new Error(String(error))));
        this.socket.on('close', () => this.failPending(new Error('CLI_DAEMON_DISCONNECTED')));
        const ack = await this.roundTrip({
            id: 'handshake',
            protocol: DAEMON_PROTOCOL,
            workspaceKey,
            sessionName,
            authToken
        }, HANDSHAKE_TIMEOUT_MS);
        if (!ack.ok) {
            const error = ack.error;
            throw new Error(`CLI_SESSION_AUTH_FAILED: ${error?.code ?? 'CLI_SESSION_AUTH_FAILED'} ${error?.message ?? ''}`);
        }
        this.handshakeDone = true;
    }
    async call(request) {
        if (!this.handshakeDone)
            throw new Error('CLI_SESSION_NOT_CONNECTED');
        return await this.roundTrip(request);
    }
    async cancel(requestId) {
        return await this.call({
            id: `cancel-${randomUUID()}`,
            tool: '__host_cancel',
            args: { requestId }
        });
    }
    async requestStatus(requestId) {
        return await this.call({
            id: `status-${randomUUID()}`,
            tool: '__host_request_status',
            args: { requestId }
        });
    }
    async operationStatus(opId) {
        return this.call({ id: `operation-${randomUUID()}`, tool: '__host_operation_status', args: { opId } });
    }
    close() {
        this.failPending(new Error('CLI_SESSION_CLOSED'));
        this.socket?.end();
        this.socket = null;
        this.buffer = '';
        this.handshakeDone = false;
    }
    roundTrip(frame, timeoutMs = DEFAULT_CALL_TIMEOUT_MS) {
        return new Promise((resolve, reject) => {
            if (!this.socket || this.socket.destroyed) {
                reject(new Error('CLI_DAEMON_DISCONNECTED'));
                return;
            }
            const id = typeof frame.id === 'string' && frame.id !== ''
                ? frame.id
                : `req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
            const timer = setTimeout(() => {
                const entry = this.pending.get(id);
                if (!entry)
                    return;
                this.pending.delete(id);
                entry.reject(new SessionTransportError(id, 'CLI_REQUEST_TIMEOUT'));
            }, timeoutMs);
            timer.unref?.();
            if (this.pending.has(id)) {
                clearTimeout(timer);
                reject(new Error('CLI_REQUEST_ID_CONFLICT'));
                return;
            }
            this.pending.set(id, { resolve, reject, timer });
            const payload = `${JSON.stringify({ ...frame, id })}\n`;
            if (Buffer.byteLength(payload, 'utf8') > MAX_FRAME_BYTES) {
                clearTimeout(timer);
                this.pending.delete(id);
                reject(new Error('CLI_FRAME_TOO_LARGE'));
                return;
            }
            this.socket.write(payload, (error) => {
                if (error) {
                    const entry = this.pending.get(id);
                    if (entry)
                        clearTimeout(entry.timer);
                    this.pending.delete(id);
                    reject(new SessionTransportError(id, 'CLI_TRANSPORT_FAILED', error instanceof Error ? error : new Error(String(error))));
                }
            });
        });
    }
    onData(chunk) {
        this.buffer += chunk;
        if (Buffer.byteLength(this.buffer, 'utf8') > MAX_FRAME_BYTES) {
            this.failPending(new Error('CLI_FRAME_TOO_LARGE'));
            this.socket?.destroy();
            return;
        }
        let newline = this.buffer.indexOf('\n');
        while (newline !== -1) {
            const line = this.buffer.slice(0, newline);
            this.buffer = this.buffer.slice(newline + 1);
            newline = this.buffer.indexOf('\n');
            if (line.trim() === '')
                continue;
            let frame;
            try {
                frame = JSON.parse(line);
            }
            catch {
                this.failPending(new Error('CLI_FRAME_INVALID'));
                continue;
            }
            if (typeof frame.id === 'string') {
                const entry = this.pending.get(frame.id);
                if (entry) {
                    this.pending.delete(frame.id);
                    clearTimeout(entry.timer);
                    entry.resolve(frame);
                }
            }
        }
    }
    failPending(error) {
        for (const [id, entry] of this.pending) {
            this.pending.delete(id);
            clearTimeout(entry.timer);
            entry.reject(new SessionTransportError(id, error.message.split(':', 1)[0], error));
        }
    }
}
//# sourceMappingURL=sessionPipeClient.js.map