/**
 * Structured error classification for model-service adapters.
 * Differentiates network, timeout, rate-limit, server, client and parse failures.
 */
/**
 * Parse an HTTP Retry-After header into milliseconds. Supports delta-seconds
 * (e.g. "30") and HTTP-date forms. Returns undefined when absent or invalid.
 */
export function parseRetryAfterHeader(header) {
    if (!header)
        return undefined;
    const trimmed = header.trim();
    if (/^\d+$/.test(trimmed)) {
        return Number(trimmed) * 1000;
    }
    const dateMs = Date.parse(trimmed);
    if (!Number.isNaN(dateMs)) {
        return Math.max(0, dateMs - Date.now());
    }
    return undefined;
}
export function classifyFetchError(error, protocol, signal, options) {
    const callerAborted = options?.callerSignal?.aborted ?? false;
    if (signal?.aborted || callerAborted) {
        if (callerAborted) {
            return {
                severity: 'error',
                code: 'MODEL_SERVICE_CANCELLED',
                message: `${protocol} 请求已取消。`
            };
        }
        const reason = signal?.reason;
        if (reason?.name === 'TimeoutError') {
            return {
                severity: 'error',
                code: 'MODEL_SERVICE_TIMEOUT',
                message: `${protocol} 请求超时。`
            };
        }
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_CANCELLED',
            message: `${protocol} 请求已取消。`
        };
    }
    if (error instanceof DOMException && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        if (error.name === 'TimeoutError') {
            return {
                severity: 'error',
                code: 'MODEL_SERVICE_TIMEOUT',
                message: `${protocol} 请求超时。`
            };
        }
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_CANCELLED',
            message: `${protocol} 请求已取消。`
        };
    }
    if (error instanceof TypeError) {
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_NETWORK_ERROR',
            message: `${protocol} 网络连接失败：${error.message}`
        };
    }
    const rawMessage = error instanceof Error ? error.message : String(error);
    const errorCode = error?.code ?? '';
    const errorCauseCode = (error?.cause?.code) ?? '';
    const isTimeout = /timeout/i.test(rawMessage) || errorCode === 'ETIMEDOUT' || errorCauseCode === 'ETIMEDOUT';
    if (isTimeout) {
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_TIMEOUT',
            message: `${protocol} 请求超时：${rawMessage}`
        };
    }
    const isNetworkLike = /network|socket|connreset|timedout|connrefused|epipe|und_err|premature close|fetch failed|stream|disconnect|closed|eai_again|reset by peer|broken pipe/i.test(rawMessage) ||
        ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'ERR_STREAM_PREMATURE_CLOSE'].includes(errorCode) ||
        ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EPIPE', 'UND_ERR_SOCKET', 'UND_ERR_BODY_TIMEOUT', 'ERR_STREAM_PREMATURE_CLOSE'].includes(errorCauseCode);
    if (isNetworkLike) {
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_NETWORK_ERROR',
            message: `${protocol} 网络连接中断：${rawMessage}`
        };
    }
    return {
        severity: 'error',
        code: 'MODEL_SERVICE_REQUEST_FAILED',
        message: `${protocol} 请求失败：${rawMessage}`
    };
}
export function classifyHttpError(status, bodyText, protocol, retryAfterHeader) {
    let detail = bodyText;
    try {
        const parsed = JSON.parse(bodyText);
        if (parsed && typeof parsed.error?.message === 'string') {
            detail = parsed.error.message;
        }
    }
    catch {
        // raw text
    }
    const truncated = detail.length > 800 ? `${detail.slice(0, 800)}…` : detail;
    if (status === 429) {
        const retryAfterMs = parseRetryAfterHeader(retryAfterHeader);
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_RATE_LIMITED',
            message: `${protocol} 速率限制 (HTTP 429)。${retryAfterHeader ? ` Retry-After: ${retryAfterHeader}。` : ''}${truncated ? ` ${truncated}` : ''}`,
            ...(retryAfterMs !== undefined ? { retryAfterMs } : {})
        };
    }
    if (status >= 500) {
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_SERVER_ERROR',
            message: `${protocol} 服务端错误：HTTP ${status} ${truncated}`
        };
    }
    if (status === 401 || status === 403) {
        return {
            severity: 'error',
            code: 'MODEL_SERVICE_AUTH_ERROR',
            message: `${protocol} 认证/授权失败：HTTP ${status} ${truncated}`
        };
    }
    return {
        severity: 'error',
        code: 'MODEL_SERVICE_HTTP_ERROR',
        message: `${protocol} 请求失败：HTTP ${status} ${truncated}`
    };
}
export function classifyParseError(error, protocol) {
    return {
        severity: 'error',
        code: 'MODEL_SERVICE_RESPONSE_PARSE_FAILED',
        message: `${protocol} 响应解析失败：${error instanceof Error ? error.message : String(error)}`
    };
}
export function errorResult(diagnostic) {
    return {
        message: { role: 'assistant', content: '' },
        finishReason: 'error',
        diagnostics: [diagnostic]
    };
}
export function errorStreamEvent(diagnostic) {
    return {
        type: 'error',
        code: diagnostic.code,
        message: diagnostic.message
    };
}
/**
 * Create a combined AbortSignal from an optional caller signal and an optional timeout.
 * Returns the signal and a cleanup function to clear the timeout timer.
 */
export function createRequestSignal(callerSignal, timeoutMs) {
    if (!callerSignal && !timeoutMs) {
        return { signal: undefined, cleanup: () => { } };
    }
    const signals = [];
    if (callerSignal)
        signals.push(callerSignal);
    let timer;
    if (timeoutMs && timeoutMs > 0) {
        // AbortSignal.timeout() cannot be cancelled.  A long Agent session can
        // create one signal per model turn, so use a cancellable controller and
        // release its timer when the adapter reaches any terminal stream path.
        const timeoutController = new AbortController();
        timer = setTimeout(() => {
            const reason = typeof DOMException === 'function'
                ? new DOMException('The request timed out.', 'TimeoutError')
                : Object.assign(new Error('The request timed out.'), { name: 'TimeoutError' });
            timeoutController.abort(reason);
        }, timeoutMs);
        timer.unref?.();
        signals.push(timeoutController.signal);
    }
    const cleanup = () => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
    };
    if (signals.length === 1) {
        return { signal: signals[0], cleanup };
    }
    const combined = AbortSignal.any(signals);
    return { signal: combined, cleanup };
}
//# sourceMappingURL=errorClassification.js.map