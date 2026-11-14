import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { BRIDGE_PROTOCOL_VERSION } from '@soulforge/shared';
import { BRIDGE_RECOVERY_FAULT_OPTION, BRIDGE_RECOVERY_PHASE_CODES, isBridgeRecoveryHarnessFault } from './bridgeRecoveryHarnessProtocol.js';
const eventLogArgument = process.argv[2];
if (!eventLogArgument)
    throw new Error('Bridge recovery fixture requires an event log path.');
const eventLogPath = eventLogArgument;
const fixtureMode = process.argv[3];
const cancellationTerminals = new Map();
const cancellationTerminalSessions = new Map();
const cancellationTerminalDuplicates = new Map();
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', (line) => {
    if (!line.trim())
        return;
    const frame = JSON.parse(line);
    handleFrame(frame);
});
function handleFrame(frame) {
    if (!frame.requestId)
        return;
    if (frame.kind === 'handshake') {
        record({ kind: 'handshake', requestId: frame.requestId });
        writeFrame('handshake', frame, {
            maxFrameBytes: readNumber(frame.payload, 'maxFrameBytes') ?? 1024 * 1024,
            maxConcurrency: readNumber(frame.payload, 'maxConcurrency') ?? 1,
            syntheticFixture: true,
            nativeFormatAuthority: false
        }, () => {
            if (fixtureMode !== 'pause-after-handshake-close'
                && fixtureMode !== 'pause-after-handshake-hold')
                return;
            input.pause();
            setTimeout(() => process.exit(29), fixtureMode === 'pause-after-handshake-close' ? 75 : 750);
        });
        return;
    }
    if (frame.kind === 'health') {
        writeFrame('health', frame, {
            processId: process.pid,
            syntheticFixture: true,
            nativeFormatAuthority: false
        });
        return;
    }
    if (frame.kind === 'cancel') {
        const targetRequestId = readString(frame.payload, 'targetRequestId');
        record({
            kind: 'cancel',
            requestId: frame.requestId,
            ...(targetRequestId ? { targetRequestId } : {})
        });
        if (targetRequestId) {
            const terminal = cancellationTerminals.get(targetRequestId) ?? 'cancelled';
            const session = cancellationTerminalSessions.get(targetRequestId) ?? 'valid';
            const duplicate = cancellationTerminalDuplicates.get(targetRequestId) ?? false;
            cancellationTerminals.delete(targetRequestId);
            cancellationTerminalSessions.delete(targetRequestId);
            cancellationTerminalDuplicates.delete(targetRequestId);
            if (fixtureMode === 'close-after-cancel' || terminal === 'hold') {
                if (fixtureMode === 'close-after-cancel')
                    setTimeout(() => process.exit(31), 25);
                return;
            }
            const terminalRequest = makeTerminalRequestFrame(frame, targetRequestId, session);
            const writeTerminalOnce = () => {
                if (terminal === 'failed') {
                    writeFrame('failed', terminalRequest, {
                        code: 'BRIDGE_HARNESS_LATE_FAILED',
                        message: 'Deterministic fixture injected a late failed terminal.',
                        retryable: false,
                        syntheticFixture: true,
                        nativeFormatAuthority: false
                    }, () => record({ kind: 'terminal', requestId: targetRequestId }));
                    return;
                }
                if (terminal === 'result') {
                    writeFrame('result', terminalRequest, {
                        authority: 'candidate',
                        nativeFormatAuthority: false,
                        syntheticFixture: true,
                        result: { late: true }
                    }, () => record({ kind: 'terminal', requestId: targetRequestId }));
                    return;
                }
                writeFrame('cancelled', terminalRequest, {
                    syntheticFixture: true,
                    nativeFormatAuthority: false
                }, () => record({ kind: 'terminal', requestId: targetRequestId }));
            };
            const writeTerminal = () => {
                writeTerminalOnce();
                if (duplicate)
                    setTimeout(writeTerminalOnce, 5);
            };
            if (terminal === 'cancelled')
                writeTerminal();
            else
                setTimeout(writeTerminal, 25);
        }
        return;
    }
    if (frame.kind !== 'request')
        return;
    const fault = readFault(frame.payload);
    const cancellationTerminal = readCancellationTerminal(frame.payload);
    record({
        kind: 'request',
        requestId: frame.requestId,
        ...(fault ? { fault } : {})
    });
    if (fault === 'process-exit') {
        writeFrame('progress', frame, { phase: 'fixture-active' }, () => process.exit(23));
        return;
    }
    if (fault === 'timeout' || fault === 'cancel') {
        if (fault === 'cancel' && cancellationTerminal) {
            cancellationTerminals.set(frame.requestId, cancellationTerminal);
            cancellationTerminalSessions.set(frame.requestId, readCancellationTerminalSession(frame.payload));
            cancellationTerminalDuplicates.set(frame.requestId, readCancellationTerminalDuplicate(frame.payload));
        }
        writeFrame('progress', frame, { phase: 'fixture-active' });
        return;
    }
    if (fault === 'progress-terminal-race') {
        writeFrame('progress', frame, { phase: 'fixture-active' });
        writeFrame('result', frame, {
            authority: 'candidate',
            nativeFormatAuthority: false,
            syntheticFixture: true,
            result: { ok: true }
        }, () => record({ kind: 'terminal', requestId: frame.requestId, fault }));
        return;
    }
    if (fault && isRecoveryPhase(fault)) {
        writeFrame('failed', frame, {
            code: BRIDGE_RECOVERY_PHASE_CODES[fault],
            message: `Deterministic fixture injected ${fault} failure.`,
            retryable: false,
            syntheticFixture: true,
            nativeFormatAuthority: false
        });
        return;
    }
    writeFrame('result', frame, {
        authority: 'candidate',
        nativeFormatAuthority: false,
        syntheticFixture: true,
        result: { ok: true }
    });
}
function writeFrame(kind, request, payload, callback) {
    if (!request.requestId)
        throw new Error('Fixture response requires a request id.');
    const response = {
        protocolVersion: BRIDGE_PROTOCOL_VERSION,
        kind,
        requestId: request.requestId,
        ...(request.workspaceSessionId ? { workspaceSessionId: request.workspaceSessionId } : {}),
        payload
    };
    process.stdout.write(`${JSON.stringify(response)}\n`, callback);
}
function readFault(payload) {
    const options = asRecord(asRecord(payload).options);
    const value = options[BRIDGE_RECOVERY_FAULT_OPTION];
    return isBridgeRecoveryHarnessFault(value) ? value : null;
}
function readString(payload, key) {
    const value = asRecord(payload)[key];
    return typeof value === 'string' && value.length > 0 ? value : null;
}
function readNumber(payload, key) {
    const value = asRecord(payload)[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function readCancellationTerminal(payload) {
    const options = asRecord(asRecord(payload).options);
    const value = options.cancellationTerminal;
    return value === 'result' || value === 'failed' || value === 'cancelled' || value === 'hold'
        ? value
        : null;
}
function readCancellationTerminalSession(payload) {
    const options = asRecord(asRecord(payload).options);
    const value = options.cancellationTerminalSession;
    return value === 'missing' || value === 'wrong' ? value : 'valid';
}
function readCancellationTerminalDuplicate(payload) {
    const options = asRecord(asRecord(payload).options);
    return options.cancellationTerminalDuplicate === true;
}
function makeTerminalRequestFrame(cancelFrame, targetRequestId, session) {
    if (session === 'wrong') {
        return { ...cancelFrame, requestId: targetRequestId, workspaceSessionId: 'wrong-session' };
    }
    if (session === 'missing') {
        const { workspaceSessionId: _workspaceSessionId, ...withoutSession } = cancelFrame;
        return { ...withoutSession, requestId: targetRequestId };
    }
    return { ...cancelFrame, requestId: targetRequestId };
}
function isRecoveryPhase(value) {
    return value in BRIDGE_RECOVERY_PHASE_CODES;
}
function asRecord(value) {
    return value && typeof value === 'object' ? value : {};
}
function record(event) {
    appendFileSync(eventLogPath, `${JSON.stringify(event)}\n`, 'utf8');
}
//# sourceMappingURL=bridgeRecoveryFixtureDaemon.js.map