import { createHash, randomUUID } from 'node:crypto';
const VERSION_LINE = /^me3 ((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)$/u;
const SAFE_POLICY_ID = /^[A-Za-z0-9._-]{1,80}$/u;
const MAX_VERSION_OUTPUT_CHARACTERS = 1024;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_SUPPORTED_VERSION_COUNT = 256;
const DISCOVERY_SOURCES = new Set(['registry', 'well-known', 'path']);
const SPAWN_FAILURES = new Set([
    'not-executable',
    'permission-denied',
    'process-unavailable',
    'unknown'
]);
export class Me3RuntimeAdapter {
    adapterId = 'me3';
    game = 'sekiro';
    gateway;
    versionPolicy;
    sessionPids = new Map();
    constructor(options) {
        this.gateway = options.gateway;
        this.versionPolicy = options.versionPolicy;
    }
    async detect(context) {
        if (!Number.isSafeInteger(context.timeoutMs)
            || context.timeoutMs <= 0
            || context.timeoutMs > MAX_TIMER_DELAY_MS) {
            return capability('probe-failed', 'none', [diagnostic('ME3_DETECTION_TIMEOUT_INVALID', 'The me3 detection timeout must be a positive supported timer delay.')]);
        }
        if (context.signal?.aborted)
            return cancelledCapability();
        const gatewayController = new AbortController();
        let gatewayPromise;
        try {
            gatewayPromise = Promise.resolve(this.gateway.probeVersion({
                operation: 'version-probe',
                timeoutMs: context.timeoutMs,
                signal: gatewayController.signal
            }));
        }
        catch {
            gatewayController.abort('spawn-failed');
            if (context.signal?.aborted)
                return cancelledCapability();
            return capability('spawn-failed', 'none', [diagnostic('ME3_PROBE_SPAWN_FAILED', 'The privileged me3 detection gateway failed before returning a probe result.')]);
        }
        const gatewayResult = await awaitGatewayProbe(gatewayPromise, context.timeoutMs, context.signal, gatewayController);
        if (gatewayResult.status === 'cancelled')
            return cancelledCapability();
        if (gatewayResult.status === 'timed-out') {
            return timedOutCapability(context.timeoutMs);
        }
        if (gatewayResult.status === 'rejected') {
            if (context.signal?.aborted)
                return cancelledCapability();
            return capability('spawn-failed', 'none', [diagnostic('ME3_PROBE_SPAWN_FAILED', 'The privileged me3 detection gateway failed before returning a probe result.')]);
        }
        const rawResult = gatewayResult.value;
        // User cancellation is terminal even if a racing process close reports exit code zero.
        if (context.signal?.aborted)
            return cancelledCapability();
        let result;
        try {
            result = validateGatewayResponse(rawResult);
        }
        catch {
            result = null;
        }
        if (!result) {
            return capability('probe-failed', 'none', [diagnostic('ME3_GATEWAY_RESPONSE_INVALID', 'The privileged me3 detection gateway returned an invalid response.')]);
        }
        if (result.status === 'not-found') {
            return capability('not-found', 'none', [diagnostic('ME3_NOT_FOUND', 'No me3 installation candidate was found.', { checkedSources: uniqueSources(result.checkedSources) })]);
        }
        if (result.status === 'ambiguous') {
            return capability('ambiguous', 'multiple', [diagnostic('ME3_INSTALLATION_AMBIGUOUS', 'Multiple distinct me3 installation candidates were found.', {
                    candidateCount: positiveCount(result.candidateCount),
                    discoverySources: uniqueSources(result.discoverySources)
                })]);
        }
        return this.classifyProbe(result.discoverySource, result.process, context.timeoutMs);
    }
    async prepareProfile(workspace, context) {
        if (context.signal?.aborted) {
            return cancelledOperation('prepare-profile');
        }
        const profileName = `soulforge-${workspace.workspaceSessionId.slice(0, 16)}`;
        const gatewayController = new AbortController();
        let gatewayPromise;
        try {
            gatewayPromise = Promise.resolve(this.gateway.createProfile({
                operation: 'profile-create',
                profileName,
                game: 'sekiro',
                packagePaths: [],
                timeoutMs: context.timeoutMs,
                signal: gatewayController.signal
            }));
        }
        catch {
            gatewayController.abort('spawn-failed');
            if (context.signal?.aborted)
                return cancelledOperation('prepare-profile');
            return failedOperation('prepare-profile', 'ME3_PROFILE_CREATE_SPAWN_FAILED', 'The privileged me3 profile creation gateway failed before returning a result.');
        }
        const outcome = await awaitGatewayOperation(gatewayPromise, context.timeoutMs, context.signal, gatewayController);
        if (outcome.status === 'cancelled')
            return cancelledOperation('prepare-profile');
        if (outcome.status === 'timed-out')
            return timedOutOperation('prepare-profile', context.timeoutMs);
        if (outcome.status === 'rejected') {
            if (context.signal?.aborted)
                return cancelledOperation('prepare-profile');
            return failedOperation('prepare-profile', 'ME3_PROFILE_CREATE_SPAWN_FAILED', 'The privileged me3 profile creation gateway failed before returning a result.');
        }
        const result = validateProfileCreateResult(outcome.value);
        if (!result) {
            return failedOperation('prepare-profile', 'ME3_GATEWAY_RESPONSE_INVALID', 'The privileged me3 profile creation gateway returned an invalid response.');
        }
        if (result.cancelled)
            return cancelledOperation('prepare-profile');
        if (result.timedOut)
            return timedOutOperation('prepare-profile', context.timeoutMs);
        if (result.spawnFailure !== null) {
            return failedOperation('prepare-profile', 'ME3_PROFILE_CREATE_SPAWN_FAILED', 'The me3 profile creation process could not be started.', { reason: result.spawnFailure });
        }
        if (result.exitCode !== 0) {
            return failedOperation('prepare-profile', 'ME3_PROFILE_CREATE_FAILED', 'The me3 profile creation exited unsuccessfully.', { exitCode: result.exitCode, stderr: result.stderr.slice(0, 512) });
        }
        const contentSha256 = createHash('sha256')
            .update(`${profileName}:sekiro`)
            .digest('hex');
        return {
            ok: true,
            status: 'succeeded',
            authority: 'fixture-confirmed',
            data: {
                profileId: profileName,
                workspaceSessionId: workspace.workspaceSessionId,
                game: 'sekiro',
                profileVersion: 'v1',
                contentSha256
            },
            diagnostics: [infoDiagnostic('ME3_PROFILE_CREATED', 'The me3 profile was created successfully.', { profileName })]
        };
    }
    async launch(request, context) {
        if (context.signal?.aborted) {
            return cancelledOperation('launch');
        }
        const gatewayController = new AbortController();
        let gatewayPromise;
        try {
            gatewayPromise = Promise.resolve(this.gateway.launchGame({
                operation: 'launch',
                profileName: request.profile.profileId,
                game: 'sekiro',
                diagnostics: true,
                timeoutMs: context.timeoutMs,
                signal: gatewayController.signal
            }));
        }
        catch {
            gatewayController.abort('spawn-failed');
            if (context.signal?.aborted)
                return cancelledOperation('launch');
            return failedOperation('launch', 'ME3_LAUNCH_SPAWN_FAILED', 'The privileged me3 launch gateway failed before returning a result.');
        }
        const outcome = await awaitGatewayOperation(gatewayPromise, context.timeoutMs, context.signal, gatewayController);
        if (outcome.status === 'cancelled')
            return cancelledOperation('launch');
        if (outcome.status === 'timed-out')
            return timedOutOperation('launch', context.timeoutMs);
        if (outcome.status === 'rejected') {
            if (context.signal?.aborted)
                return cancelledOperation('launch');
            return failedOperation('launch', 'ME3_LAUNCH_SPAWN_FAILED', 'The privileged me3 launch gateway failed before returning a result.');
        }
        const result = validateLaunchResult(outcome.value);
        if (!result) {
            return failedOperation('launch', 'ME3_GATEWAY_RESPONSE_INVALID', 'The privileged me3 launch gateway returned an invalid response.');
        }
        if (result.cancelled)
            return cancelledOperation('launch');
        if (result.timedOut)
            return timedOutOperation('launch', context.timeoutMs);
        if (result.spawnFailure !== null) {
            return failedOperation('launch', 'ME3_LAUNCH_SPAWN_FAILED', 'The me3 launch process could not be started.', { reason: result.spawnFailure });
        }
        const sessionId = randomUUID();
        const startedAt = new Date().toISOString();
        if (result.pid !== undefined) {
            this.sessionPids.set(sessionId, result.pid);
        }
        return {
            ok: true,
            status: 'succeeded',
            authority: 'fixture-confirmed',
            data: {
                sessionId,
                ...(request.operationId ? { operationId: request.operationId } : {}),
                game: 'sekiro',
                state: 'running',
                startedAt,
                diagnostics: [infoDiagnostic('ME3_LAUNCH_STARTED', 'The me3 game launch was initiated.', { profileName: request.profile.profileId })]
            },
            diagnostics: [infoDiagnostic('ME3_LAUNCH_STARTED', 'The me3 game launch was initiated.', { profileName: request.profile.profileId })]
        };
    }
    async collectDiagnostics(session, _context) {
        return {
            ok: true,
            status: 'succeeded',
            authority: 'unverified',
            data: {
                sessionId: session.sessionId,
                observedAt: new Date().toISOString(),
                diagnostics: [infoDiagnostic('ME3_DIAGNOSTICS_OBSERVED', 'Basic session diagnostics collected.', { sessionState: session.state })]
            },
            diagnostics: []
        };
    }
    async terminate(session, context) {
        if (context.signal?.aborted) {
            return cancelledOperation('terminate');
        }
        const pid = this.sessionPids.get(session.sessionId);
        if (pid === undefined) {
            return {
                ok: false,
                status: 'failed',
                authority: 'fixture-confirmed',
                diagnostics: [diagnostic('ME3_TERMINATE_NO_PID', 'The session does not carry a process identifier for termination.', { sessionId: session.sessionId })]
            };
        }
        let gatewayResult;
        try {
            gatewayResult = await this.gateway.terminateProcess({
                operation: 'terminate',
                pid,
                timeoutMs: context.timeoutMs
            });
        }
        catch {
            return failedOperation('terminate', 'ME3_TERMINATE_GATEWAY_FAILED', 'The privileged me3 termination gateway failed.');
        }
        const result = validateTerminateResult(gatewayResult);
        if (!result) {
            return failedOperation('terminate', 'ME3_GATEWAY_RESPONSE_INVALID', 'The privileged me3 termination gateway returned an invalid response.');
        }
        this.sessionPids.delete(session.sessionId);
        return {
            ok: result.terminated,
            status: result.terminated ? 'succeeded' : 'failed',
            authority: 'fixture-confirmed',
            data: {
                sessionId: session.sessionId,
                terminated: result.terminated
            },
            diagnostics: result.terminated
                ? [infoDiagnostic('ME3_TERMINATED', 'The me3 game process was terminated.')]
                : [diagnostic('ME3_TERMINATE_FAILED', 'The me3 game process could not be terminated.')]
        };
    }
    classifyProbe(source, process, timeoutMs) {
        if (process.cancelled)
            return cancelledCapability(source);
        if (process.timedOut) {
            return capability('timed-out', source, [diagnostic('ME3_DETECTION_TIMEOUT', 'The me3 version probe timed out and is not a successful detection.', { timeoutMs })]);
        }
        if (process.spawnFailure !== null) {
            return capability('spawn-failed', source, [diagnostic('ME3_PROBE_SPAWN_FAILED', 'The me3 version probe could not be started.', { reason: process.spawnFailure })]);
        }
        if (process.exitCode !== 0) {
            return capability('probe-failed', source, [diagnostic('ME3_VERSION_PROBE_FAILED', 'The me3 version probe exited unsuccessfully.', {
                    exitCode: process.exitCode,
                    stderrObserved: process.stderrObserved,
                    stdoutTruncated: process.stdoutTruncated,
                    stderrTruncated: process.stderrTruncated
                })]);
        }
        const version = parseVersionOutput(process.stdout, process.stdoutTruncated);
        if (!version) {
            return capability('malformed-version', source, [diagnostic('ME3_VERSION_OUTPUT_MALFORMED', 'The me3 version probe returned an unrecognized or truncated version line.', {
                    stdoutTruncated: process.stdoutTruncated,
                    stderrObserved: process.stderrObserved,
                    stderrTruncated: process.stderrTruncated
                })]);
        }
        const exitZeroDiagnostic = diagnostic('ME3_EXIT_ZERO_UNVERIFIED', 'A zero exit code and matching version line do not establish launch readiness or native runtime authority.', { detectedVersion: version });
        const policy = validatePolicy(this.versionPolicy);
        if (!policy.ok) {
            return capability('policy-unset', source, [
                exitZeroDiagnostic,
                diagnostic(policy.code, policy.message)
            ], { detectedVersion: version });
        }
        if (!policy.supportedVersions.has(version)) {
            return capability('unsupported-version', source, [
                exitZeroDiagnostic,
                diagnostic('ME3_VERSION_UNSUPPORTED', 'The detected me3 version is not present in the exact compatibility allowlist.', { detectedVersion: version, versionPolicyId: policy.policyId })
            ], { detectedVersion: version, versionPolicyId: policy.policyId });
        }
        return capability('exit-zero-unverified', source, [exitZeroDiagnostic], {
            detectedVersion: version,
            versionPolicyId: policy.policyId,
            compatible: true
        });
    }
}
function parseVersionOutput(stdout, truncated) {
    if (truncated || stdout.length > MAX_VERSION_OUTPUT_CHARACTERS)
        return null;
    const lines = stdout.split(/\r?\n/u).filter((line) => line.length > 0);
    if (lines.length !== 1)
        return null;
    return VERSION_LINE.exec(lines[0])?.[1] ?? null;
}
function validateGatewayResponse(value) {
    const record = asPlainRecord(value);
    if (!record || typeof record.status !== 'string')
        return null;
    if (record.status === 'not-found') {
        if (!hasExactKeys(record, ['status', 'checkedSources']))
            return null;
        const checkedSources = validateSources(record.checkedSources);
        return checkedSources ? { status: 'not-found', checkedSources } : null;
    }
    if (record.status === 'ambiguous') {
        if (!hasExactKeys(record, ['status', 'candidateCount', 'discoverySources']))
            return null;
        if (typeof record.candidateCount !== 'number'
            || !Number.isSafeInteger(record.candidateCount)
            || record.candidateCount < 2)
            return null;
        const discoverySources = validateSources(record.discoverySources);
        return discoverySources
            ? { status: 'ambiguous', candidateCount: record.candidateCount, discoverySources }
            : null;
    }
    if (record.status === 'probed') {
        if (!hasExactKeys(record, ['status', 'discoverySource', 'process']))
            return null;
        if (!isDiscoverySource(record.discoverySource))
            return null;
        const process = validateProcessResult(record.process);
        return process
            ? { status: 'probed', discoverySource: record.discoverySource, process }
            : null;
    }
    return null;
}
function validateProcessResult(value) {
    const record = asPlainRecord(value);
    if (!record || !hasExactKeys(record, [
        'exitCode',
        'stdout',
        'stdoutTruncated',
        'stderrObserved',
        'stderrTruncated',
        'timedOut',
        'cancelled',
        'spawnFailure'
    ]))
        return null;
    const exitCode = record.exitCode;
    if (exitCode !== null
        && (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)))
        return null;
    if (typeof record.stdout !== 'string'
        || record.stdout.length > MAX_VERSION_OUTPUT_CHARACTERS)
        return null;
    if (typeof record.stdoutTruncated !== 'boolean'
        || typeof record.stderrObserved !== 'boolean'
        || typeof record.stderrTruncated !== 'boolean'
        || typeof record.timedOut !== 'boolean'
        || typeof record.cancelled !== 'boolean')
        return null;
    if (record.timedOut && record.cancelled)
        return null;
    const spawnFailure = record.spawnFailure;
    if (spawnFailure !== null
        && (typeof spawnFailure !== 'string'
            || !SPAWN_FAILURES.has(spawnFailure)))
        return null;
    return {
        exitCode,
        stdout: record.stdout,
        stdoutTruncated: record.stdoutTruncated,
        stderrObserved: record.stderrObserved,
        stderrTruncated: record.stderrTruncated,
        timedOut: record.timedOut,
        cancelled: record.cancelled,
        spawnFailure: spawnFailure
    };
}
function validateSources(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > DISCOVERY_SOURCES.size) {
        return null;
    }
    const result = [];
    const seen = new Set();
    for (const source of value) {
        if (!isDiscoverySource(source) || seen.has(source))
            return null;
        seen.add(source);
        result.push(source);
    }
    return result;
}
function isDiscoverySource(value) {
    return typeof value === 'string' && DISCOVERY_SOURCES.has(value);
}
function asPlainRecord(value) {
    if (value === null || typeof value !== 'object' || Array.isArray(value))
        return null;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null
        ? value
        : null;
}
function hasExactKeys(record, expected) {
    const actual = Object.keys(record).sort();
    const sortedExpected = [...expected].sort();
    return actual.length === sortedExpected.length
        && actual.every((key, index) => key === sortedExpected[index]);
}
function validatePolicy(policy) {
    try {
        return validatePolicyValue(policy);
    }
    catch {
        return invalidPolicy();
    }
}
function validatePolicyValue(policy) {
    if (policy === undefined) {
        return {
            ok: false,
            code: 'ME3_VERSION_POLICY_UNSET',
            message: 'No production me3 compatibility allowlist has been configured.'
        };
    }
    const record = asPlainRecord(policy);
    if (!record || !hasExactKeys(record, ['policyId', 'supportedVersions']))
        return invalidPolicy();
    if (typeof record.policyId !== 'string' || !SAFE_POLICY_ID.test(record.policyId)) {
        return invalidPolicy();
    }
    if (!Array.isArray(record.supportedVersions)
        || record.supportedVersions.length === 0
        || record.supportedVersions.length > MAX_SUPPORTED_VERSION_COUNT)
        return invalidPolicy();
    const supportedVersions = new Set();
    for (const value of record.supportedVersions) {
        if (typeof value !== 'string'
            || !VERSION_LINE.test(`me3 ${value}`)
            || supportedVersions.has(value))
            return invalidPolicy();
        supportedVersions.add(value);
    }
    return { ok: true, policyId: record.policyId, supportedVersions };
}
function invalidPolicy() {
    return {
        ok: false,
        code: 'ME3_VERSION_POLICY_INVALID',
        message: 'The me3 compatibility policy must be a bounded exact-version allowlist.'
    };
}
function capability(state, discoverySource, diagnostics, options = {}) {
    return {
        adapterId: 'me3',
        game: 'sekiro',
        state,
        detected: options.detectedVersion !== undefined,
        compatible: options.compatible ?? false,
        canPrepareProfile: false,
        canLaunch: false,
        discoverySource,
        ...(options.detectedVersion !== undefined
            ? { detectedVersion: options.detectedVersion }
            : {}),
        ...(options.versionPolicyId !== undefined
            ? { versionPolicyId: options.versionPolicyId }
            : {}),
        authority: 'unverified',
        nativeRuntimeAuthority: false,
        diagnostics
    };
}
function cancelledCapability(source = 'none') {
    return capability('cancelled', source, [diagnostic('ME3_DETECTION_CANCELLED', 'The me3 detection request was cancelled.')]);
}
function timedOutCapability(timeoutMs) {
    return capability('timed-out', 'none', [diagnostic('ME3_DETECTION_TIMEOUT', 'The privileged me3 detection gateway did not return before the detection deadline.', { timeoutMs })]);
}
function awaitGatewayProbe(gatewayPromise, timeoutMs, signal, gatewayController) {
    return new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (outcome) => {
            if (settled)
                return;
            settled = true;
            if (timer !== undefined)
                clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (outcome.status === 'timed-out' || outcome.status === 'cancelled') {
                gatewayController.abort(outcome.status);
            }
            resolve(outcome);
        };
        const onAbort = () => finish({ status: 'cancelled' });
        timer = setTimeout(() => finish({ status: 'timed-out' }), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        void gatewayPromise.then((value) => finish({ status: 'resolved', value }), () => finish({ status: 'rejected' }));
        if (signal?.aborted) {
            finish({ status: 'cancelled' });
        }
    });
}
function unsupportedOperation(operation) {
    return {
        ok: false,
        status: 'unsupported',
        authority: 'unverified',
        diagnostics: [diagnostic('ME3_RUNTIME_OPERATION_NOT_IMPLEMENTED', `The me3 runtime operation is not implemented in this contract-only slice: ${operation}.`, { operation })]
    };
}
function diagnostic(code, message, details) {
    return {
        severity: 'error',
        code,
        message,
        ...(details === undefined ? {} : { details })
    };
}
function uniqueSources(sources) {
    return [...new Set(sources)];
}
function positiveCount(value) {
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
}
function awaitGatewayOperation(gatewayPromise, timeoutMs, signal, gatewayController) {
    return new Promise((resolve) => {
        let settled = false;
        let timer;
        const finish = (outcome) => {
            if (settled)
                return;
            settled = true;
            if (timer !== undefined)
                clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            if (outcome.status === 'timed-out' || outcome.status === 'cancelled') {
                gatewayController.abort(outcome.status);
            }
            resolve(outcome);
        };
        const onAbort = () => finish({ status: 'cancelled' });
        timer = setTimeout(() => finish({ status: 'timed-out' }), timeoutMs);
        signal?.addEventListener('abort', onAbort, { once: true });
        void gatewayPromise.then((value) => finish({ status: 'resolved', value }), () => finish({ status: 'rejected' }));
        if (signal?.aborted) {
            finish({ status: 'cancelled' });
        }
    });
}
function validateProfileCreateResult(value) {
    const record = asPlainRecord(value);
    if (!record)
        return null;
    if (typeof record.exitCode !== 'number' || !Number.isSafeInteger(record.exitCode))
        return null;
    if (typeof record.stdout !== 'string')
        return null;
    if (typeof record.stderr !== 'string')
        return null;
    if (typeof record.timedOut !== 'boolean')
        return null;
    if (typeof record.cancelled !== 'boolean')
        return null;
    if (record.timedOut && record.cancelled)
        return null;
    const spawnFailure = record.spawnFailure;
    if (spawnFailure !== null
        && (typeof spawnFailure !== 'string'
            || !SPAWN_FAILURES.has(spawnFailure)))
        return null;
    return {
        exitCode: record.exitCode,
        stdout: record.stdout,
        stderr: record.stderr,
        timedOut: record.timedOut,
        cancelled: record.cancelled,
        spawnFailure: spawnFailure
    };
}
function validateLaunchResult(value) {
    const record = asPlainRecord(value);
    if (!record)
        return null;
    const exitCode = record.exitCode;
    if (exitCode !== null
        && (typeof exitCode !== 'number' || !Number.isSafeInteger(exitCode)))
        return null;
    if (typeof record.stdout !== 'string')
        return null;
    if (typeof record.stderr !== 'string')
        return null;
    if (typeof record.timedOut !== 'boolean')
        return null;
    if (typeof record.cancelled !== 'boolean')
        return null;
    if (record.timedOut && record.cancelled)
        return null;
    const spawnFailure = record.spawnFailure;
    if (spawnFailure !== null
        && (typeof spawnFailure !== 'string'
            || !SPAWN_FAILURES.has(spawnFailure)))
        return null;
    const pid = record.pid;
    if (pid !== undefined
        && (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0))
        return null;
    return {
        exitCode,
        stdout: record.stdout,
        stderr: record.stderr,
        timedOut: record.timedOut,
        cancelled: record.cancelled,
        spawnFailure: spawnFailure,
        ...(pid !== undefined ? { pid } : {})
    };
}
function validateTerminateResult(value) {
    const record = asPlainRecord(value);
    if (!record)
        return null;
    if (typeof record.terminated !== 'boolean')
        return null;
    return { terminated: record.terminated };
}
function cancelledOperation(operation) {
    return {
        ok: false,
        status: 'cancelled',
        authority: 'unverified',
        diagnostics: [diagnostic('ME3_OPERATION_CANCELLED', `The me3 runtime operation was cancelled: ${operation}.`, { operation })]
    };
}
function timedOutOperation(operation, timeoutMs) {
    return {
        ok: false,
        status: 'timed-out',
        authority: 'unverified',
        diagnostics: [diagnostic('ME3_OPERATION_TIMEOUT', `The me3 runtime operation timed out: ${operation}.`, { operation, timeoutMs })]
    };
}
function failedOperation(operation, code, message, details) {
    return {
        ok: false,
        status: 'failed',
        authority: 'unverified',
        diagnostics: [diagnostic(code, message, { operation, ...asRecordOrEmpty(details) })]
    };
}
function infoDiagnostic(code, message, details) {
    return {
        severity: 'info',
        code,
        message,
        ...(details === undefined ? {} : { details })
    };
}
function asRecordOrEmpty(value) {
    if (value === null || value === undefined)
        return {};
    if (typeof value === 'object' && !Array.isArray(value))
        return value;
    return {};
}
//# sourceMappingURL=me3RuntimeAdapter.js.map