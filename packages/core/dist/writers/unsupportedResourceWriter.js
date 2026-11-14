import { createDiagnostic } from '@soulforge/shared';
/**
 * Always rejects structured/native writes with clear diagnostics.
 */
export class UnsupportedResourceWriter {
    writerId = 'writer:unsupported';
    supportedResourceKinds = [
        'event', 'map', 'param', 'msg', 'menu', 'script', 'action', 'ai',
        'sfx', 'chr', 'obj', 'other', 'unknown'
    ];
    supportedOperations = ['structured_edit', 'container_child_edit'];
    inputSchemaVersion = '';
    preconditions = [
        'native writer not registered',
        'structured write forbidden without fixture-confirmed implementation'
    ];
    canHandle(_operation) {
        return true;
    }
    writePlan(patch, operations) {
        return {
            writerId: this.writerId,
            operations,
            stagingRelativePaths: [],
            preconditions: operations.flatMap((op) => op.preconditions),
            estimatedRisk: 'blocked',
            notes: `Unsupported writer rejects patch ${patch.patchId}`
        };
    }
    async applyToStaging(input) {
        const diagnostics = input.operations.map((op) => createDiagnostic({
            severity: 'error',
            code: 'WRITER_CONTRACT_ABSENT',
            message: `No scaffold writer can apply operation ${op.kind}. Native writers are not implemented.`,
            targetUri: op.targetUri,
            details: {
                writerId: this.writerId,
                operationKind: op.kind,
                nativeFormatAuthority: false
            }
        }));
        return {
            ok: false,
            writtenTargets: [],
            writtenPaths: [],
            diagnostics,
            rollback: this.produceRollbackMetadata({ operations: input.operations, backupPaths: [] })
        };
    }
    produceRollbackMetadata(input) {
        return {
            writerId: this.writerId,
            strategy: 'none',
            backupPaths: input.backupPaths,
            notes: `No writes performed for ${input.operations.length} rejected op(s)`
        };
    }
}
//# sourceMappingURL=unsupportedResourceWriter.js.map