import { EDITOR_CAPABILITY_CONTRACTS } from './editorCapabilityContract.js';
const RELEASE_SAFE_SCALE_ACCESS = new Set([
    'pagination',
    'virtualization',
    'chunking',
    'streaming'
]);
const ACCEPTED_ACCESS_MODES = [
    'pagination',
    'virtualization',
    'chunking',
    'streaming'
];
export function buildProposedReleaseEditorInventory() {
    return Object.values(EDITOR_CAPABILITY_CONTRACTS)
        .filter((contract) => contract.proposedReleaseEditorId !== null)
        .sort((left, right) => (left.proposalOrder ?? Number.MAX_SAFE_INTEGER)
        - (right.proposalOrder ?? Number.MAX_SAFE_INTEGER))
        .map((contract) => ({
        releaseEditorId: contract.proposedReleaseEditorId,
        editorKind: contract.editorKind,
        scopeRulingStatus: 'user-approved',
        releaseIncluded: true,
        documentAuthorityRequirement: contract.documentAuthority,
        mutationKinds: [...contract.mutationKinds],
        revisionContract: contract.revisionContract,
        scalePrimitives: [...contract.scalePrimitives],
        currentScaleAccess: contract.scaleAccess,
        scaleDimensions: [...contract.scaleDimensions],
        contractSources: [...contract.contractSources]
    }));
}
/**
 * Defines the non-quantitative editor scale contract. Numeric capacity, latency,
 * package-size, and elapsed-time thresholds are explicitly outside acceptance;
 * every editor must instead expose complete content through a bounded access
 * mode and retain the normal authority/revision/mutation gates.
 */
export function buildReleaseEditorFunctionalScaleSchemas() {
    return buildProposedReleaseEditorInventory().map((editor) => ({
        schemaVersion: 2,
        releaseEditorId: editor.releaseEditorId,
        scopeRulingStatus: 'user-approved',
        quantitativeThresholdsRequired: false,
        acceptedAccessModes: [...ACCEPTED_ACCESS_MODES],
        scaleDimensions: [...editor.scaleDimensions]
    }));
}
/**
 * Evaluates one functional observation. This contract harness cannot emit a
 * release pass: the later production gate must still run the complete Electron
 * workflow against real native documents. No numeric threshold ruling is
 * required.
 */
export function evaluateReleaseEditorAcceptance(input) {
    const inventory = buildProposedReleaseEditorInventory();
    const editor = inventory.find((item) => item.releaseEditorId === input.sample.releaseEditorId);
    const diagnostics = [];
    if (!editor) {
        diagnostics.push(error('inventory', 'EDITOR_NOT_IN_RELEASE_INVENTORY', '编辑器不在已批准的发布清单中。'));
        return rejectedResult(input.sample.releaseEditorId, diagnostics);
    }
    if (input.sample.sourceMode !== 'real-document') {
        diagnostics.push(error('source', input.sample.sourceMode === 'demo-fallback'
            ? 'EDITOR_DEMO_FALLBACK_REJECTED'
            : 'EDITOR_SYNTHETIC_SOURCE_REJECTED', '发布编辑器验收必须读取真实 document；demo/synthetic 只能验证 harness。'));
    }
    if (!hasRequiredDocumentAuthority(editor, input.sample)) {
        diagnostics.push(error('document-authority', 'EDITOR_NATIVE_AUTHORITY_REQUIRED', `编辑器 ${editor.releaseEditorId} 缺少 ${editor.documentAuthorityRequirement} authority。`));
    }
    if (input.sample.revision === null
        || (typeof input.sample.revision === 'string' && input.sample.revision.trim() === '')) {
        diagnostics.push(error('revision', 'EDITOR_REVISION_REQUIRED', '验收样本必须绑定非空 revision。'));
    }
    if (!input.sample.rejectsStaleRevision) {
        diagnostics.push(error('revision', 'EDITOR_REVISION_CONFLICT_NOT_REJECTED', '验收样本必须证明 stale revision 失败关闭。'));
    }
    const missingMutations = editor.mutationKinds.filter((kind) => !input.sample.observedMutationKinds.includes(kind));
    if (missingMutations.length > 0) {
        diagnostics.push(error('typed-mutation', 'EDITOR_TYPED_MUTATION_COVERAGE_MISSING', `缺少 typed mutation 覆盖：${missingMutations.join(', ')}。`));
    }
    appendScaleAccessDiagnostic(diagnostics, editor.currentScaleAccess, 'current-contract');
    appendScaleAccessDiagnostic(diagnostics, input.sample.scaleAccess, 'observed-sample');
    if (input.claimedReleaseDecision === 'pass') {
        diagnostics.push(error('release-ruling', 'EDITOR_RELEASE_PASS_FORBIDDEN', 'candidate functional harness 不得输出 release pass。'));
        diagnostics.push(error('functional-acceptance', 'EDITOR_FUNCTIONAL_ACCEPTANCE_PENDING', '尚无完整 Electron 真实文档功能验收证据，不能声明通过。'));
    }
    else {
        diagnostics.push(warning('functional-acceptance', 'EDITOR_FUNCTIONAL_ACCEPTANCE_PENDING', '尚未运行完整 Electron 真实文档功能验收；本 harness 只记录候选观测。'));
    }
    const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === 'error');
    return {
        schemaVersion: 2,
        ok: null,
        releaseEditorId: editor.releaseEditorId,
        acceptanceStatus: hasErrors ? 'rejected' : 'candidate',
        evidenceKind: hasErrors ? 'candidate' : 'functional-observation',
        evidenceAuthority: 'candidate',
        releaseGateDecision: 'pending',
        releasePassed: false,
        scopeRulingStatus: 'user-approved',
        quantitativeThresholdsRequired: false,
        functionalAcceptanceStatus: 'pending',
        realFunctionalAcceptanceRun: false,
        diagnostics
    };
}
function appendScaleAccessDiagnostic(diagnostics, scaleAccess, subject) {
    if (RELEASE_SAFE_SCALE_ACCESS.has(scaleAccess))
        return;
    const subjectLabel = subject === 'current-contract' ? '当前能力契约' : '本次观测';
    if (scaleAccess === 'bounded-window') {
        diagnostics.push(error('scale-access', 'EDITOR_BOUNDED_WINDOW_NOT_RELEASE_SAFE', `${subjectLabel}仅提供固定 bounded window，不能证明用户可访问完整大文档。`));
        return;
    }
    if (scaleAccess === 'eager') {
        diagnostics.push(error('scale-access', 'EDITOR_EAGER_MATERIALIZATION_NOT_RELEASE_SAFE', `${subjectLabel}仍会 eager materialize 完整文档，未满足大文档分页、虚拟化、分块或流式要求。`));
        return;
    }
    diagnostics.push(error('scale-access', 'EDITOR_PAGINATION_OR_VIRTUALIZATION_REQUIRED', `${subjectLabel}的规模访问模式为 ${scaleAccess}，必须提供 pagination、virtualization、chunking 或 streaming。`));
}
function hasRequiredDocumentAuthority(editor, sample) {
    if (sample.documentAuthority !== editor.documentAuthorityRequirement)
        return false;
    if (editor.documentAuthorityRequirement === 'raw-byte-document') {
        return sample.authorityLevel === 'raw-byte-authority';
    }
    if (editor.documentAuthorityRequirement === 'bridge-native-document') {
        return sample.authorityLevel === 'partial' || sample.authorityLevel === 'native-verified';
    }
    return sample.authorityLevel !== 'unsupported' && sample.authorityLevel !== 'unverified';
}
function rejectedResult(releaseEditorId, diagnostics) {
    return {
        schemaVersion: 2,
        ok: null,
        releaseEditorId,
        acceptanceStatus: 'rejected',
        evidenceKind: 'candidate',
        evidenceAuthority: 'candidate',
        releaseGateDecision: 'pending',
        releasePassed: false,
        scopeRulingStatus: 'user-approved',
        quantitativeThresholdsRequired: false,
        functionalAcceptanceStatus: 'pending',
        realFunctionalAcceptanceRun: false,
        diagnostics
    };
}
function error(area, code, message) {
    return { severity: 'error', area, code, message };
}
function warning(area, code, message) {
    return { severity: 'warning', area, code, message };
}
//# sourceMappingURL=releaseEditorAcceptance.js.map