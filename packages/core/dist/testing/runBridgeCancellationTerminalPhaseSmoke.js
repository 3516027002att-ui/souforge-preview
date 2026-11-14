import { BridgeDaemonClient, BridgeDaemonError } from '../bridge/bridgeDaemonClient.js';
import { disposeBridgeDaemonPool, runBridge } from '../bridge/runBridge.js';
const projectPath = `${process.cwd()}\\bridge\\SoulForge.Bridge\\SoulForge.Bridge.csproj`;
const sourcePath = `${process.cwd()}\\package.json`;
let fakeMode = 'command';
async function main() {
    const clientClass = BridgeDaemonClient;
    const originalStart = clientClass.start;
    clientClass.start = async (options) => createFakeClient(options);
    try {
        await assertPhase('command', {
            command: 'validate',
            workspaceSessionId: 'phase-command'
        });
        await assertPhase('artifact', {
            command: 'read-bridge-artifact',
            workspaceSessionId: 'phase-explicit-artifact'
        });
        fakeMode = 'artifact-child';
        const observed = [];
        try {
            await runBridge({
                ...baseOptions('phase-artifact-child'),
                command: 'validate',
                onCancellationTerminal: (receipt) => { observed.push(receipt); }
            });
        }
        catch (error) {
            if (!(error instanceof BridgeDaemonError))
                throw error;
        }
        if (observed.length !== 1 || observed[0]?.requestPhase !== 'artifact') {
            throw new Error(`Internal artifact request phase was not artifact: ${JSON.stringify(observed)}`);
        }
        console.log(JSON.stringify({
            ok: true,
            status: 'fixture-confirmed',
            syntheticFixture: true,
            cases: {
                commandPhase: 'command',
                explicitArtifactPhase: 'artifact',
                internalArtifactPhase: 'artifact'
            },
            nonClaims: [
                'fake Bridge client only verifies runBridge callback phase projection.',
                '未运行 production Bridge、native parser、writer 或真实资源。'
            ]
        }, null, 2));
    }
    finally {
        clientClass.start = originalStart;
        await disposeBridgeDaemonPool();
    }
}
function baseOptions(workspaceSessionId) {
    return {
        bridgeProjectPath: projectPath,
        bridgeExecutablePath: process.execPath,
        filePath: sourcePath,
        allowedRoots: [process.cwd()],
        workspaceSessionId,
        timeoutMs: 500
    };
}
async function assertPhase(expected, partial) {
    fakeMode = partial.command === 'read-bridge-artifact' ? 'explicit-artifact' : 'command';
    const observed = [];
    await runBridge({
        ...baseOptions(partial.workspaceSessionId ?? `phase-${expected}`),
        command: partial.command,
        onCancellationTerminal: (receipt) => { observed.push(receipt); }
    });
    if (observed.length !== 1 || observed[0]?.requestPhase !== expected) {
        throw new Error(`Expected ${expected} phase, got ${JSON.stringify(observed)}`);
    }
}
function createFakeClient(options) {
    const fake = {
        options,
        get isClosed() {
            return false;
        },
        request: async (request) => {
            const command = request.payload.command;
            if (fakeMode === 'artifact-child' && command === 'validate') {
                return {
                    authority: 'candidate',
                    nativeFormatAuthority: false,
                    result: {
                        sourceUri: 'file://phase-fixture',
                        sourcePath: 'phase-fixture',
                        game: 'synthetic',
                        resourceKind: 'document',
                        parseStatus: 'partial',
                        diagnostics: [],
                        data: {
                            fileBacked: {
                                artifactToken: 'phase-fixture-token-1234',
                                payloadFormat: 'bridge-result-json',
                                payloadVersion: 1,
                                byteLength: 1,
                                chunkSize: 1
                            }
                        }
                    }
                };
            }
            request.onCancellationTerminal?.(receiptFor(command));
            throw new BridgeDaemonError('BRIDGE_REQUEST_CANCELLED', 'synthetic cancellation', true);
        },
        dispose: async () => undefined
    };
    return fake;
}
function receiptFor(command) {
    return {
        requestId: `phase-${command}`,
        outcome: 'cancelled',
        receivedAt: new Date().toISOString(),
        cancelRequested: true
    };
}
main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=runBridgeCancellationTerminalPhaseSmoke.js.map