import { asRecord, fail, ok } from '../toolRegistrySupport.js';
import { assessEditRisk, evaluateWriterGate, resolveWriterContract } from '../../patch/writerContract.js';
/** assess_edit_risk: one domain tool declaration, schema and handler. */
export function createAssessEditRiskTool() {
    return {
        name: 'assess_edit_risk',
        description: 'Assess Files-mode edit risk and resolve writer contract for an indexed file snapshot. '
            + 'file: an object with sourceUri (e.g. "file://map/mapstudio/m11_02_00_00.msb.dcx") plus optional sourcePath, extension, compoundExtension, game, resourceKind, containerFormat. '
            + 'changeKind tells the gate which edit you intend (text, structured or binary).',
        permission: 'analyze',
        permissionLevel: 'analyze',
        inputSchema: {
            // `file` can only be declared as a bare object: ToolInputShape is
            // Record<string, string> and cannot express nested required fields.
            // The run body checks them explicitly and names what is missing.
            file: 'object',
            truncated: 'boolean?',
            structuredEditable: 'boolean?',
            parseStatus: 'enum:unparsed|parsed|partial|unsupported|failed?',
            changeKind: 'enum:text|structured|binary?'
        },
        run: (input, context) => {
            const value = asRecord(input);
            const rawFile = (value.file && typeof value.file === 'object' ? value.file : value);
            if (!rawFile || (typeof rawFile.sourceUri !== 'string' && typeof rawFile.sourcePath !== 'string')) {
                return fail('INVALID_INPUT', 'assess_edit_risk 需要在 { file } 中传入包含 sourceUri 的文件对象。');
            }
            const sourceUri = typeof rawFile.sourceUri === 'string' ? rawFile.sourceUri : `workspace://files/${String(rawFile.sourcePath).replace(/\\/g, '/')}`;
            const pathStr = typeof rawFile.sourcePath === 'string' ? rawFile.sourcePath : sourceUri;
            const parts = pathStr.split(/[/\\]/);
            const name = parts[parts.length - 1] || '';
            const dots = name.split('.');
            const derivedExt = dots.length > 1 ? dots[dots.length - 1] || '' : '';
            const derivedCompoundExt = dots.length > 2 ? dots.slice(1).join('.') : derivedExt;
            // The caller usually has only the path; the index knows the resource kind, extension and
            // game. Without this lookup every file was assessed as resourceKind "unknown", which also
            // leaked into the contract id as a trailing ':undefined'.
            const indexedFile = (typeof context?.workspaceIndex?.getFile === 'function'
                ? context.workspaceIndex.getFile(sourceUri)
                : undefined);
            const indexedKind = typeof indexedFile?.resourceKind === 'string' ? indexedFile.resourceKind : undefined;
            const indexedFormatKind = typeof indexedFile?.formatKind === 'string' ? indexedFile.formatKind : undefined;
            const indexedExtension = typeof indexedFile?.extension === 'string' ? indexedFile.extension : undefined;
            const indexedCompound = typeof indexedFile?.compoundExtension === 'string' ? indexedFile.compoundExtension : undefined;
            const indexedGame = typeof indexedFile?.game === 'string' ? indexedFile.game : undefined;
            const file = {
                sourceUri,
                sourcePath: typeof rawFile.sourcePath === 'string' ? rawFile.sourcePath : name,
                extension: typeof rawFile.extension === 'string' ? rawFile.extension : (indexedExtension ?? derivedExt),
                compoundExtension: typeof rawFile.compoundExtension === 'string' ? rawFile.compoundExtension : (indexedCompound ?? derivedCompoundExt),
                game: typeof rawFile.game === 'string' ? rawFile.game : (indexedGame ?? 'sekiro'),
                // writerContract builds its contract id from formatKind; always supply one, or the id renders a
                // trailing ':undefined' for a file the index does not know.
                ...(typeof rawFile.formatKind === 'string'
                    ? { formatKind: rawFile.formatKind }
                    : { formatKind: (indexedFormatKind ?? 'unknown') }),
                resourceKind: typeof rawFile.resourceKind === 'string' ? rawFile.resourceKind : (indexedKind ?? 'unknown'),
                ...(rawFile.containerFormat ? { containerFormat: rawFile.containerFormat } : {})
            };
            const riskOptions = {
                ...(value.truncated === true ? { truncated: true } : {}),
                ...(typeof value.structuredEditable === 'boolean' ? { structuredEditable: value.structuredEditable } : {}),
                ...(typeof value.parseStatus === 'string' ? { parseStatus: value.parseStatus } : {})
            };
            const risk = assessEditRisk(file, riskOptions);
            const contract = resolveWriterContract(file);
            const gate = evaluateWriterGate({
                file,
                changeKind: value.changeKind === 'structured' || value.changeKind === 'binary' ? value.changeKind : 'text',
                riskOptions
            });
            return ok({ risk, contract, gate });
        }
    };
}
//# sourceMappingURL=assess_edit_risk.js.map