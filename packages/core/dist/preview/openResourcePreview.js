import { open } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { runBridge } from '../bridge/runBridge.js';
import { parseEventText } from '../parsers/eventTextParser.js';
import { parseMsgText } from '../parsers/msgTextParser.js';
const DEFAULT_MAX_BYTES = 64 * 1024;
const TEXT_EXTENSIONS = new Set([
    '.txt',
    '.md',
    '.json',
    '.xml',
    '.yml',
    '.yaml',
    '.lua',
    '.hks',
    '.emevd',
    '.js',
    '.ts',
    '.csv',
    '.ini',
    '.cfg',
    '.toml',
    '.log'
]);
const NATIVE_INSPECT_FORMATS = new Set([
    'dcx',
    'bnd',
    'emevd',
    'msb',
    'param',
    'fmg',
    'lua',
    'tpf',
    'backup'
]);
export async function openResourcePreview(options) {
    const maxBytes = Math.max(0, options.maxBytes ?? DEFAULT_MAX_BYTES);
    const diagnostics = [];
    try {
        const { buffer, bytesRead } = await readPrefix(options.file.absolutePath, Math.min(options.file.size, maxBytes));
        const slice = buffer.subarray(0, bytesRead);
        const truncated = options.file.size > bytesRead;
        const nativeInspection = await inspectNativeEnvelope(options);
        const previewKind = determinePreviewKind(options.file, slice);
        const text = previewKind === 'text' ? slice.toString('utf8') : undefined;
        const structuredPreview = await buildStructuredPreview(options, text, nativeInspection);
        const previewDiagnostics = [
            ...diagnostics,
            ...nativeInspectionDiagnostics(nativeInspection),
            ...structuredPreviewDiagnostics(structuredPreview),
            ...(truncated ? [truncatedDiagnostic(options.file)] : [])
        ];
        if (options.file.size === 0) {
            return {
                file: options.file,
                previewKind: 'empty',
                ...(nativeInspection ? { nativeInspection } : {}),
                ...(structuredPreview ? { structuredPreview } : {}),
                truncated: false,
                bytesRead,
                diagnostics: previewDiagnostics
            };
        }
        if (previewKind === 'text') {
            return {
                file: options.file,
                previewKind: 'text',
                ...(text !== undefined ? { text } : {}),
                ...(nativeInspection ? { nativeInspection } : {}),
                ...(structuredPreview ? { structuredPreview } : {}),
                truncated,
                bytesRead,
                diagnostics: previewDiagnostics
            };
        }
        return {
            file: options.file,
            previewKind: 'hex',
            hex: toHexPreview(slice),
            ...(nativeInspection ? { nativeInspection } : {}),
            ...(structuredPreview ? { structuredPreview } : {}),
            truncated,
            bytesRead,
            diagnostics: [
                ...previewDiagnostics,
                {
                    severity: 'info',
                    code: 'BINARY_PREVIEW_ONLY',
                    message: 'Binary resource is shown as a limited hex preview until a parser is available.',
                    sourceUri: options.file.sourceUri
                }
            ]
        };
    }
    catch (error) {
        return {
            file: options.file,
            previewKind: 'failed',
            truncated: false,
            // 读失败时没有读到任何字节。bytesRead 声明在 try 块内（:70 的解构），
            // catch 里访问不到，故显式填 0——这不是占位值，是真实读取量。
            bytesRead: 0,
            diagnostics: [
                {
                    severity: 'error',
                    code: 'PREVIEW_FAILED',
                    message: error instanceof Error ? error.message : 'Failed to open resource preview.',
                    sourceUri: options.file.sourceUri,
                    details: { path: options.file.absolutePath }
                }
            ]
        };
    }
}
async function inspectNativeEnvelope(options) {
    if (!(options.inspectNative ?? false))
        return undefined;
    if (!shouldInspectNativeResource(options.file))
        return undefined;
    return runBridge({
        command: 'inspect',
        filePath: options.file.absolutePath,
        resourceUri: options.file.sourceUri,
        allowedRoots: [workspaceRootForFile(options.file)],
        ...(options.oodleRuntimeRoot ? { oodleRuntimeRoot: options.oodleRuntimeRoot } : {}),
        ...(options.bridgeProjectPath ? { bridgeProjectPath: options.bridgeProjectPath } : {}),
        ...(options.bridgeTimeoutMs ? { timeoutMs: options.bridgeTimeoutMs } : {})
    });
}
async function buildStructuredPreview(options, text, nativeInspection) {
    if (!(options.parseStructured ?? true))
        return undefined;
    if (text !== undefined) {
        const parsedText = parseStructuredText(options.file, text);
        if (parsedText)
            return parsedText;
    }
    const container = nativeInspection ? buildContainerReadSummary(nativeInspection) : undefined;
    const command = exportCommandForStructuredPreview(options.file);
    if (!command) {
        if (!nativeInspection)
            return undefined;
        return {
            status: nativeInspection.parseStatus === 'failed' ? 'failed' : 'partial',
            kind: options.file.resourceKind,
            parser: 'bridge.inspect',
            summary: summarizeContainerInspection(container),
            editable: false,
            ...(container ? { container } : {}),
            bridgeResult: nativeInspection,
            diagnostics: []
        };
    }
    const exported = await runBridge({
        command,
        filePath: options.file.absolutePath,
        resourceUri: options.file.sourceUri,
        allowedRoots: [workspaceRootForFile(options.file)],
        ...(options.oodleRuntimeRoot ? { oodleRuntimeRoot: options.oodleRuntimeRoot } : {}),
        ...(options.bridgeProjectPath ? { bridgeProjectPath: options.bridgeProjectPath } : {}),
        ...(options.bridgeTimeoutMs ? { timeoutMs: options.bridgeTimeoutMs } : {})
    });
    return bridgeExportToStructuredPreview(options.file, command, exported);
}
function workspaceRootForFile(file) {
    try {
        if (file.workspaceId.startsWith('file:'))
            return fileURLToPath(file.workspaceId);
    }
    catch {
        // Fall through to the path/relative-path derivation for legacy indexes.
    }
    const suffixLength = file.relativePath.replaceAll('/', '\\').length;
    return file.absolutePath.slice(0, Math.max(0, file.absolutePath.length - suffixLength)).replace(/[\\/]+$/, '');
}
function parseStructuredText(file, text) {
    if (file.resourceKind === 'event' || file.relativePath.toLowerCase().endsWith('.emevd.dcx.js')) {
        const parsed = parseEventText({ sourceUri: file.sourceUri, sourcePath: file.relativePath, text });
        return {
            status: parsed.export.events.length > 0 ? 'parsed' : 'partial',
            kind: 'event',
            parser: 'eventTextParser',
            summary: `Parsed ${parsed.export.events.length} event(s) and ${countEventInstructions(parsed.export)} instruction(s).`,
            editable: true,
            events: [parsed.export],
            diagnostics: parsed.diagnostics
        };
    }
    if (file.resourceKind === 'msg' || isMsgLikeTextPath(file.relativePath)) {
        const parsed = parseMsgText({ sourceUri: file.sourceUri, sourcePath: file.relativePath, text });
        return {
            status: parsed.export.entries.length > 0 ? 'parsed' : 'partial',
            kind: 'msg',
            parser: 'msgTextParser',
            summary: `Parsed ${parsed.export.entries.length} text entr${parsed.export.entries.length === 1 ? 'y' : 'ies'}.`,
            editable: true,
            msgs: [parsed.export],
            diagnostics: parsed.diagnostics
        };
    }
    if (isPlainEditableText(file)) {
        return {
            status: 'partial',
            kind: file.resourceKind,
            parser: 'plainText',
            summary: 'Editable text file. No resource-specific semantic parser matched yet.',
            editable: true,
            diagnostics: []
        };
    }
    return undefined;
}
function bridgeExportToStructuredPreview(file, command, result) {
    const container = buildContainerReadSummary(result);
    const semantic = bridgeSemanticData(command, result.data);
    return {
        status: result.parseStatus === 'failed' ? 'failed' : result.parseStatus === 'parsed' ? 'parsed' : 'partial',
        kind: result.resourceKind,
        parser: `bridge.${command}`,
        summary: summarizeBridgeExport(file, command, result, container),
        editable: semantic.editable,
        ...semantic.symbols,
        ...(container ? { container } : {}),
        bridgeResult: result,
        diagnostics: result.diagnostics
    };
}
function bridgeSemanticData(command, data) {
    const record = asRecord(data);
    if (command === 'export-event' && Array.isArray(record.events)) {
        return { editable: false, symbols: { events: [record] } };
    }
    if (command === 'export-map' && (Array.isArray(record.entities) || Array.isArray(record.regions))) {
        return { editable: false, symbols: { maps: [record] } };
    }
    if (command === 'export-param' && Array.isArray(record.params)) {
        return { editable: false, symbols: { params: record.params } };
    }
    if (command === 'export-param' && Array.isArray(record.rows)) {
        return { editable: false, symbols: { params: [record] } };
    }
    if (command === 'export-msg' && Array.isArray(record.msgs)) {
        return { editable: false, symbols: { msgs: record.msgs } };
    }
    if (command === 'export-msg' && Array.isArray(record.entries)) {
        return { editable: false, symbols: { msgs: [record] } };
    }
    return { editable: false, symbols: {} };
}
function summarizeBridgeExport(file, command, result, container) {
    if (result.parseStatus === 'failed')
        return `Bridge ${command} failed for ${file.formatLabel}.`;
    if (result.parseStatus === 'unsupported')
        return `Bridge ${command} is not supported for this resource yet.`;
    if (container && container.hints.length > 0) {
        return `Bridge ${command} returned ${result.parseStatus} data with ${container.hints.length} container hint(s). Native candidates remain read-only.`;
    }
    return `Bridge ${command} returned ${result.parseStatus} semantic data. Native candidates remain read-only until a writer is implemented.`;
}
function summarizeContainerInspection(container) {
    if (!container)
        return 'Native envelope inspected; no container evidence was extracted yet.';
    const confirmedBinderTables = (container.binderChildTableCount ?? 0) + (container.dcxNestedBinderChildTableCount ?? 0);
    const dcxPreviews = (container.dcxPayloadBoundaryCount ?? 0) + (container.dcxDecompressedPreviewCount ?? 0);
    return `Native ${container.rootFormat ?? 'unknown'} envelope inspected: ${container.pathHintCount} path hint(s), ${container.binderChildCandidateCount} binder child candidate(s), ${container.nestedMagicCandidateCount} nested magic candidate(s), ${confirmedBinderTables} binder table evidence item(s), ${dcxPreviews} DCX evidence item(s).`;
}
function buildContainerReadSummary(result) {
    const data = asRecord(result.data);
    const evidence = Array.isArray(data.evidence) ? data.evidence : [];
    const hints = evidence.flatMap((item) => formatEvidenceToContainerHint(item)).slice(0, 120);
    const file = asRecord(data.file);
    const extensionChain = Array.isArray(file.extensionChain)
        ? file.extensionChain.filter((item) => typeof item === 'string')
        : [];
    const rootFormat = asString(data.rootFormat);
    const fileName = asString(file.fileName);
    const fileSize = asNumber(file.size);
    if (!rootFormat && hints.length === 0 && extensionChain.length === 0)
        return undefined;
    return {
        ...(rootFormat ? { rootFormat } : {}),
        ...(fileName ? { fileName } : {}),
        ...(fileSize !== null ? { fileSize } : {}),
        extensionChain,
        hints,
        pathHintCount: hints.filter((hint) => hint.kind === 'pathHint').length,
        binderChildCandidateCount: hints.filter((hint) => hint.kind === 'binderChildCandidate').length,
        nestedMagicCandidateCount: hints.filter((hint) => hint.kind === 'nestedMagicCandidate').length,
        dcxPayloadBoundaryCount: hints.filter((hint) => hint.kind === 'dcxPayloadBoundary').length,
        dcxDecompressedPreviewCount: hints.filter((hint) => hint.kind === 'dcxDecompressedPreview').length,
        binderChildTableCount: hints.filter((hint) => hint.kind === 'binderChildTable').length,
        dcxNestedBinderChildTableCount: hints.filter((hint) => hint.kind === 'dcxNestedBinderChildTable').length
    };
}
function formatEvidenceToContainerHint(value) {
    const evidence = asRecord(value);
    const kind = asContainerHintKind(asString(evidence.kind));
    if (!kind)
        return [];
    const rawValue = asRecord(evidence.value);
    const label = containerHintLabel(kind, rawValue);
    const resourceKind = asString(rawValue.resourceKind);
    const rootFormat = asString(rawValue.rootFormat);
    const source = asString(rawValue.source);
    const extensionChain = Array.isArray(rawValue.extensionChain)
        ? rawValue.extensionChain.filter((item) => typeof item === 'string')
        : undefined;
    return [{
            kind,
            label,
            offset: asNumber(evidence.offset) ?? 0,
            confidence: toReferenceConfidence(evidence.confidence),
            ...(resourceKind ? { resourceKind } : {}),
            ...(rootFormat ? { rootFormat } : {}),
            ...(extensionChain ? { extensionChain } : {}),
            ...(source ? { source } : {}),
            raw: evidence.value
        }];
}
function asContainerHintKind(value) {
    if (value === 'pathHint'
        || value === 'binderChildCandidate'
        || value === 'nestedMagicCandidate'
        || value === 'dcxPayloadBoundary'
        || value === 'dcxDecompressedPreview'
        || value === 'binderChildTable'
        || value === 'dcxNestedBinderChildTable')
        return value;
    return null;
}
function containerHintLabel(kind, rawValue) {
    if (kind === 'nestedMagicCandidate')
        return asString(rawValue.rootFormat) || 'nested magic';
    if (kind === 'dcxPayloadBoundary')
        return `${asString(rawValue.compressionFormat) ?? 'DCX'} payload boundary`;
    if (kind === 'dcxDecompressedPreview')
        return `${asString(rawValue.nestedRootFormat) ?? 'unknown'} decompressed preview`;
    if (kind === 'binderChildTable')
        return `binder table: ${countChildren(rawValue)} child item(s)`;
    if (kind === 'dcxNestedBinderChildTable')
        return `DCX nested binder: ${countNestedChildren(rawValue)} child item(s)`;
    return asString(rawValue.path) || asString(rawValue.text) || 'path hint';
}
function countChildren(rawValue) {
    const children = rawValue.children;
    return Array.isArray(children) ? children.length : 0;
}
function countNestedChildren(rawValue) {
    const data = asRecord(rawValue.Data ?? rawValue.data);
    return countChildren(data);
}
function toReferenceConfidence(value) {
    return value === 'high' || value === 'medium' || value === 'low' ? value : 'low';
}
function asRecord(value) {
    return value && typeof value === 'object' ? value : {};
}
function asString(value) {
    return typeof value === 'string' && value.length > 0 ? value : undefined;
}
function asNumber(value) {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function exportCommandForStructuredPreview(file) {
    const path = file.relativePath.toLowerCase();
    if (file.resourceKind === 'msg' && (path.endsWith('.fmg') || path.endsWith('.fmg.dcx') || path.includes('.msgbnd')))
        return 'export-msg';
    if (file.resourceKind === 'event' && path.includes('.emevd'))
        return 'export-event';
    if (file.resourceKind === 'map' && path.includes('.msb'))
        return 'export-map';
    if (file.resourceKind === 'param' && path.includes('.param'))
        return 'export-param';
    return null;
}
function shouldInspectNativeResource(file) {
    if (file.resourceKind === 'unknown')
        return false;
    if (NATIVE_INSPECT_FORMATS.has(file.formatKind))
        return true;
    const path = file.relativePath.toLowerCase();
    return path.endsWith('.dcx')
        || path.includes('.bnd')
        || path.includes('.emevd')
        || path.includes('.msb')
        || path.includes('.param')
        || path.endsWith('.fmg');
}
function determinePreviewKind(file, buffer) {
    return shouldPreviewAsText(file.extension, buffer) ? 'text' : 'hex';
}
function nativeInspectionDiagnostics(inspection) {
    if (!inspection)
        return [];
    return [
        {
            severity: inspection.parseStatus === 'failed' ? 'warning' : 'info',
            code: 'NATIVE_INSPECTION_ATTACHED',
            message: `Bridge inspect attached to preview with status '${inspection.parseStatus}'.`,
            sourceUri: inspection.sourceUri,
            details: {
                resourceKind: inspection.resourceKind,
                parseStatus: inspection.parseStatus
            }
        },
        ...inspection.diagnostics
    ];
}
function structuredPreviewDiagnostics(preview) {
    if (!preview)
        return [];
    return [
        {
            severity: preview.status === 'failed' ? 'warning' : 'info',
            code: 'STRUCTURED_PREVIEW_ATTACHED',
            message: preview.summary,
            details: { parser: preview.parser, editable: preview.editable }
        },
        ...preview.diagnostics
    ];
}
async function readPrefix(path, bytesToRead) {
    if (bytesToRead === 0)
        return { buffer: Buffer.alloc(0), bytesRead: 0 };
    const handle = await open(path, 'r');
    try {
        const buffer = Buffer.alloc(bytesToRead);
        const result = await handle.read(buffer, 0, bytesToRead, 0);
        return { buffer, bytesRead: result.bytesRead };
    }
    finally {
        await handle.close();
    }
}
function shouldPreviewAsText(extension, buffer) {
    if (TEXT_EXTENSIONS.has(extension.toLowerCase()))
        return true;
    if (buffer.includes(0))
        return false;
    const sampleLength = Math.min(buffer.byteLength, 512);
    if (sampleLength === 0)
        return true;
    let suspicious = 0;
    for (let index = 0; index < sampleLength; index += 1) {
        const value = buffer[index] ?? 0;
        const isPrintable = value === 9 || value === 10 || value === 13 || (value >= 32 && value <= 126) || value >= 128;
        if (!isPrintable)
            suspicious += 1;
    }
    return suspicious / sampleLength < 0.08;
}
function isPlainEditableText(file) {
    return file.formatKind === 'text' || TEXT_EXTENSIONS.has(file.extension.toLowerCase());
}
function isMsgLikeTextPath(relativePath) {
    const path = relativePath.toLowerCase();
    return path.includes('/msg/') || path.endsWith('.fmg.txt') || path.endsWith('.fmg.csv') || path.endsWith('.fmg.tsv');
}
function countEventInstructions(eventExport) {
    return eventExport.events.reduce((total, event) => total + event.instructions.length, 0);
}
function toHexPreview(buffer) {
    const lines = [];
    for (let offset = 0; offset < buffer.byteLength; offset += 16) {
        const row = buffer.subarray(offset, offset + 16);
        const hex = [...row].map((byte) => byte.toString(16).padStart(2, '0')).join(' ');
        const ascii = [...row]
            .map((byte) => (byte >= 32 && byte <= 126 ? String.fromCharCode(byte) : '.'))
            .join('');
        lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.padEnd(47, ' ')}  |${ascii}|`);
    }
    return lines.join('\n');
}
function truncatedDiagnostic(file) {
    return {
        severity: 'info',
        code: 'PREVIEW_PREFIX_TRUNCATED',
        message: 'Preview reads only a bounded prefix so every file can be opened safely, including large DCX/BND archives.',
        sourceUri: file.sourceUri,
        details: { size: file.size, maxPreviewBytes: DEFAULT_MAX_BYTES }
    };
}
//# sourceMappingURL=openResourcePreview.js.map