/** T11-B/C 本地会话 host：同用户同工作区复用 CoreToolSession；协议校验与请求去重。 */
import { createHash, randomBytes } from 'node:crypto';
import { CoreToolSession } from '../runtime/coreToolSession.js';
import { queryOperationOutcome, receiptOperationIds, summarizeOperationOutcomes, trackRequestOperations } from '../runtime/operationOutcome.js';
export function sessionError(code, message, retryable = false) {
    return { code, message, retryable };
}
export const MAX_FRAME_BYTES = 4 * 1024 * 1024;
export const MAX_QUEUE = 64;
function payloadHash(request) {
    return createHash('sha256').update(JSON.stringify({ tool: request.tool, args: request.args })).digest('hex');
}
export class LocalSessionHost {
    sessionName;
    workspaceId;
    authToken;
    coreSession;
    tracked = new Map();
    inFlight = new Map();
    requests = new Map();
    tail = Promise.resolve();
    pendingCount = 0;
    closed = false;
    writerCalls = 0;
    constructor(sessionName, workspaceId, principal, coreSession) {
        this.sessionName = sessionName;
        this.workspaceId = workspaceId;
        this.authToken = randomBytes(32).toString('hex');
        this.coreSession = coreSession ?? new CoreToolSession({ principal, workspaceId });
    }
    async dispatch(request, call, signal) {
        if (this.closed)
            throw new Error('CLI_SESSION_CLOSED');
        const frameBytes = Buffer.byteLength(JSON.stringify(request), 'utf8');
        if (frameBytes > MAX_FRAME_BYTES)
            throw new Error('CLI_FRAME_TOO_LARGE');
        const seen = this.tracked.get(request.id);
        const hash = payloadHash(request);
        if (seen) {
            if (seen.payloadHash !== hash)
                throw new Error('CLI_REQUEST_ID_CONFLICT');
            return seen.outcome;
        }
        const active = this.inFlight.get(request.id);
        if (active) {
            if (active.payloadHash !== hash)
                throw new Error('CLI_REQUEST_ID_CONFLICT');
            return active.promise;
        }
        if (this.pendingCount >= MAX_QUEUE)
            throw new Error('CLI_QUEUE_FULL');
        this.pendingCount += 1;
        const controller = new AbortController();
        const requestRecord = {
            id: request.id,
            payloadHash: hash,
            state: 'queued',
            queuedAt: Date.now(),
            controller
        };
        this.requests.set(request.id, requestRecord);
        const abortFromCaller = () => {
            if (requestRecord.state === 'queued' || requestRecord.state === 'running') {
                requestRecord.state = 'cancel_requested';
                requestRecord.cancelRequestedAt = Date.now();
            }
            controller.abort();
        };
        if (signal) {
            if (signal.aborted)
                abortFromCaller();
            else
                signal.addEventListener('abort', abortFromCaller, { once: true });
        }
        const operations = new Map();
        const transactionOutcome = async (result) => {
            for (const opId of receiptOperationIds(result)) {
                if (!operations.has(opId))
                    operations.set(opId, this.coreSession.operationLog);
            }
            requestRecord.opIds = [...operations.keys()];
            const outcomes = await Promise.all([...operations].map(([opId, store]) => queryOperationOutcome(store, opId)));
            return summarizeOperationOutcomes(outcomes, requestRecord.startedAt === undefined);
        };
        const task = this.tail.then(async () => {
            // The prior host may have committed and lost its response. Use existing
            // durable journal correlation before allowing the executor to run again.
            let recovered;
            try {
                recovered = await this.recoverRequestOutcome(request.id, hash);
            }
            catch (error) {
                recovered = { id: request.id, ok: false, requestState: 'unknown', transaction: summarizeOperationOutcomes([]),
                    // 防重放本身是对的：同一 id 的请求可能已经提交过，不能悄悄再跑一次。
                    // 但拒绝必须给出下一步——旧文案只说「已拒绝重放」，调用方只会以为这条路
                    // 被封死。换一个没用过的 id 重发是安全且通常正确的做法。
                    error: sessionError(error instanceof Error && error.message === 'CLI_REQUEST_ID_CONFLICT' ? error.message : 'CLI_REQUEST_OUTCOME_UNKNOWN', '无法安全核对先前请求的持久结果，已拒绝重放。请改用一个未使用过的 request id 重发（同一 id 只对完全相同的请求有效）。', false) };
            }
            if (recovered) {
                requestRecord.state = 'unknown';
                requestRecord.finishedAt = Date.now();
                requestRecord.opIds = recovered.transaction?.operations.map(op => op.opId) ?? [];
                return recovered;
            }
            if (this.closed) {
                const cancelled = controller.signal.aborted || requestRecord.state === 'cancel_requested';
                requestRecord.state = cancelled ? 'cancelled' : 'failed';
                requestRecord.finishedAt = Date.now();
                return {
                    id: request.id,
                    ok: false,
                    error: sessionError(cancelled ? 'CLI_REQUEST_CANCELLED' : 'CLI_SESSION_CLOSED', cancelled ? '请求已取消；本地会话随后关闭。' : '本地会话已关闭。', true),
                    requestState: requestRecord.state,
                    transaction: summarizeOperationOutcomes([], true)
                };
            }
            try {
                if (controller.signal.aborted) {
                    requestRecord.state = 'cancelled';
                    requestRecord.finishedAt = Date.now();
                    return {
                        id: request.id,
                        ok: false,
                        error: sessionError('CLI_REQUEST_CANCELLED', '本地会话请求已取消。', true),
                        requestState: 'cancelled',
                        transaction: summarizeOperationOutcomes([], true)
                    };
                }
                requestRecord.state = requestRecord.state === 'cancel_requested' ? 'cancel_requested' : 'running';
                requestRecord.startedAt = Date.now();
                const result = await trackRequestOperations((opId, store) => {
                    operations.set(opId, store);
                    requestRecord.opIds = [...operations.keys()];
                }, () => call(request.tool, request.args, controller.signal), { sessionName: this.sessionName, id: request.id, payloadHash: hash });
                const transaction = await transactionOutcome(result);
                if (transaction.operations.some(op => op.state === 'committed'))
                    this.writerCalls += 1;
                if (controller.signal.aborted || requestRecord.state === 'cancel_requested') {
                    requestRecord.state = 'cancelled';
                    requestRecord.finishedAt = Date.now();
                    return {
                        id: request.id, ok: false, result, requestState: 'cancelled', transaction,
                        error: sessionError('CLI_REQUEST_CANCELLED', '请求已取消；执行结果已保留，请先核对事务状态。', transaction.state === 'not_committed')
                    };
                }
                requestRecord.state = 'completed';
                requestRecord.finishedAt = Date.now();
                return { id: request.id, ok: true, result, requestState: 'completed', transaction };
            }
            catch (error) {
                const cancelled = controller.signal.aborted || requestRecord.state === 'cancel_requested';
                requestRecord.state = cancelled ? 'cancelled' : 'failed';
                requestRecord.finishedAt = Date.now();
                const transaction = await transactionOutcome();
                return {
                    id: request.id,
                    ok: false,
                    requestState: requestRecord.state,
                    transaction,
                    error: sessionError(cancelled
                        ? 'CLI_REQUEST_CANCELLED'
                        : error instanceof Error && /^CLI_[A-Z0-9_]+/u.test(error.message)
                            ? error.message.split(':', 1)[0]
                            : 'CLI_TOOL_FAILED', cancelled ? '请求已取消；执行方已返回终态。' : error instanceof Error ? error.message : String(error), transaction.state === 'not_committed')
                };
            }
        });
        requestRecord.promise = task;
        this.tail = task.then(() => undefined, () => undefined);
        this.inFlight.set(request.id, { payloadHash: hash, promise: task, controller });
        try {
            const outcome = await task;
            requestRecord.outcome = outcome;
            this.tracked.set(request.id, { payloadHash: hash, outcome });
            return outcome;
        }
        finally {
            signal?.removeEventListener('abort', abortFromCaller);
            this.inFlight.delete(request.id);
            this.pendingCount -= 1;
        }
    }
    /** Request cancellation is separate from the terminal cancelled state. */
    requestCancel(requestId) {
        const record = this.requests.get(requestId);
        if (!record)
            return { ok: false, code: 'CLI_REQUEST_NOT_FOUND', message: `没有找到请求 ${requestId}。` };
        if (record.state === 'completed' || record.state === 'failed' || record.state === 'cancelled') {
            return { ok: true, status: this.requestStatus(requestId) };
        }
        if (record.state !== 'cancel_requested') {
            record.state = 'cancel_requested';
            record.cancelRequestedAt = Date.now();
            record.controller.abort();
        }
        return { ok: true, status: this.requestStatus(requestId) };
    }
    requestStatus(requestId) {
        const record = this.requests.get(requestId);
        if (!record)
            return undefined;
        const { payloadHash: _payloadHash, controller: _controller, promise: _promise, ...status } = record;
        return status;
    }
    async operationStatus(opId) {
        return queryOperationOutcome(this.coreSession.operationLog, opId);
    }
    async resolveRequestStatus(requestId) {
        const current = this.requestStatus(requestId);
        if (current)
            return current;
        const outcome = await this.recoverRequestOutcome(requestId);
        if (!outcome)
            return undefined;
        return { id: requestId, state: 'unknown', queuedAt: 0, opIds: outcome.transaction?.operations.map(op => op.opId) ?? [], outcome };
    }
    async recoverRequestOutcome(requestId, expectedHash) {
        const store = this.coreSession.operationLog;
        const records = await store.findTransactionsForRequest?.(this.sessionName, requestId);
        if (!records?.length)
            return undefined;
        if (expectedHash && records.some(record => record.state?.request?.payloadHash !== expectedHash)) {
            throw new Error('CLI_REQUEST_ID_CONFLICT');
        }
        const opIds = [...new Set(records.map(record => record.opId))];
        const transaction = summarizeOperationOutcomes(await Promise.all(opIds.map(opId => queryOperationOutcome(store, opId))));
        return { id: requestId, ok: false, requestState: 'unknown', transaction,
            error: sessionError('CLI_REQUEST_REPLAY_BLOCKED', '已找回先前请求的持久操作；请核对事务结果，禁止自动重放。', false) };
    }
    listRequestStatuses() {
        return [...this.requests.keys()].map((id) => this.requestStatus(id)).filter((item) => item !== undefined);
    }
    get writerCallCount() {
        return this.writerCalls;
    }
    /** host 重启语义：proof 清空，审计保留（由 operationLog 持有）。 */
    restart() {
        this.coreSession.proofStore.invalidateAll('host-restart');
        this.tracked.clear();
        this.requests.clear();
    }
    close() {
        if (this.closed)
            return;
        this.closed = true;
        for (const entry of this.inFlight.values())
            entry.controller.abort();
        for (const record of this.requests.values()) {
            if (record.state === 'queued' || record.state === 'running' || record.state === 'cancel_requested') {
                record.state = 'cancel_requested';
                record.cancelRequestedAt ??= Date.now();
                record.controller.abort();
            }
        }
        this.coreSession.close();
    }
}
const HOSTS = new Map();
export function openLocalSession(sessionName, workspaceId, principal, coreSession) {
    const key = `${principal}|${workspaceId}|${sessionName}`;
    const existing = HOSTS.get(key);
    if (existing)
        return existing;
    const host = new LocalSessionHost(sessionName, workspaceId, principal, coreSession);
    HOSTS.set(key, host);
    return host;
}
export function closeLocalSession(sessionName, workspaceId, principal) {
    const key = `${principal}|${workspaceId}|${sessionName}`;
    HOSTS.get(key)?.close();
    HOSTS.delete(key);
}
//# sourceMappingURL=localSessionHost.js.map