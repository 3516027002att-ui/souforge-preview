import { strict as assert } from 'node:assert';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { runBridge, disposeBridgeDaemonPool } from '../bridge/runBridge.js';
import { resolveNativeFixture } from './nativeFixtureRegistry.js';
import { createSmokeWorkspace } from './harness/smokeWorkspace.js';
import { buildSyntheticStripFlver, buildSyntheticReferencePoseFlver, buildSyntheticTriangleListFlver } from './audit/sf-14/flverFixture.js';
const SF14_MAX_CONCURRENCY = 2;
function optionValue(name) {
    const index = process.argv.indexOf(name);
    return index >= 0 ? process.argv[index + 1] : undefined;
}
function diagnosticCodes(result) {
    return (result.diagnostics ?? [])
        .map((item) => item.code)
        .filter((code) => typeof code === 'string');
}
function decodeIndices(base64, elementBytes) {
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.length % elementBytes, 0);
    const output = [];
    for (let offset = 0; offset < bytes.length; offset += elementBytes) {
        output.push(elementBytes === 2 ? bytes.readUInt16LE(offset) : bytes.readUInt32LE(offset));
    }
    return output;
}
function decodeSourceIndices(base64) {
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.length % 4, 0);
    const output = [];
    for (let offset = 0; offset < bytes.length; offset += 4)
        output.push(bytes.readUInt32LE(offset));
    return output;
}
function decodeFloats(base64) {
    const bytes = Buffer.from(base64, 'base64');
    assert.equal(bytes.length % 4, 0);
    const output = [];
    for (let offset = 0; offset < bytes.length; offset += 4)
        output.push(bytes.readFloatLE(offset));
    return output;
}
function assertClose(actual, expected, label) {
    assert.ok(Math.abs(actual - expected) <= 1e-6, `${label}: ${actual} != ${expected}`);
}
function assertTupleClose(actual, expected, label) {
    assert.equal(actual.length, expected.length, `${label} length`);
    for (let index = 0; index < expected.length; index++) {
        assertClose(actual[index], expected[index], `${label}[${index}]`);
    }
}
function assertSyntheticVertexPayload(chunk, sourceVertexIndices, vertexCount) {
    assert.ok(typeof chunk.positionsBase64 === 'string');
    assert.ok(typeof chunk.normalsBase64 === 'string');
    assert.ok(typeof chunk.uvsBase64 === 'string');
    const positions = decodeFloats(chunk.positionsBase64);
    const normals = decodeFloats(chunk.normalsBase64);
    const uvs = decodeFloats(chunk.uvsBase64);
    assert.equal(positions.length, sourceVertexIndices.length * 3);
    assert.equal(normals.length, sourceVertexIndices.length * 3);
    assert.equal(uvs.length, sourceVertexIndices.length * 2);
    const emittedMin = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY];
    const emittedMax = [Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY];
    sourceVertexIndices.forEach((source, dense) => {
        const position = [source, source % 7, (source % 11) / 10];
        const normal = [
            (source % 5 + 1) / 6,
            (source % 7 + 2) / 9,
            (source % 11 + 3) / 14
        ];
        const uv = [source / Math.max(1, vertexCount - 1), (source % 13 + 1) / 14];
        assertTupleClose(positions.slice(dense * 3, dense * 3 + 3), position, `position source ${source}`);
        assertTupleClose(normals.slice(dense * 3, dense * 3 + 3), normal, `normal source ${source}`);
        assertTupleClose(uvs.slice(dense * 2, dense * 2 + 2), uv, `uv source ${source}`);
        for (let axis = 0; axis < 3; axis++) {
            emittedMin[axis] = Math.min(emittedMin[axis], position[axis]);
            emittedMax[axis] = Math.max(emittedMax[axis], position[axis]);
        }
    });
    assert.ok(chunk.emittedBounds?.min, 'synthetic chunk must expose emitted bounds min');
    assert.ok(chunk.emittedBounds?.max, 'synthetic chunk must expose emitted bounds max');
    assertTupleClose(chunk.emittedBounds.min, emittedMin, 'emitted bounds min');
    assertTupleClose(chunk.emittedBounds.max, emittedMax, 'emitted bounds max');
}
function assertChunkShape(chunk, expected) {
    assert.equal(typeof chunk.positionsBase64, 'string');
    assert.equal(typeof chunk.indicesBase64, 'string');
    assert.equal(typeof chunk.sourceVertexIndicesBase64, 'string');
    const elementBytes = chunk.indexElementBytes;
    assert.ok(elementBytes === 2 || elementBytes === 4);
    const positions = Buffer.from(chunk.positionsBase64, 'base64');
    const indices = decodeIndices(chunk.indicesBase64, elementBytes);
    const sources = decodeSourceIndices(chunk.sourceVertexIndicesBase64);
    assert.equal(chunk.emittedVertexCount, sources.length);
    assert.equal(chunk.emittedIndexCount, indices.length);
    assert.equal(positions.length, sources.length * 12);
    assert.equal(chunk.triangleCount * 3, indices.length);
    assert.ok(chunk.sourceVertexCount >= sources.length);
    assert.ok(chunk.sourceIndexCount >= chunk.sourceIndexStart);
    if (chunk.normalsBase64)
        assert.equal(Buffer.from(chunk.normalsBase64, 'base64').length, sources.length * 12);
    if (chunk.uvsBase64)
        assert.equal(Buffer.from(chunk.uvsBase64, 'base64').length, sources.length * 8);
    if (expected)
        assertSyntheticVertexPayload(chunk, sources, expected.vertexCount);
    const triangles = [];
    for (let i = 0; i < indices.length; i += 3) {
        const a = indices[i];
        const b = indices[i + 1];
        const c = indices[i + 2];
        assert.ok(a < sources.length && b < sources.length && c < sources.length);
        triangles.push([sources[a], sources[b], sources[c]]);
    }
    return { sourceTriangles: triangles };
}
async function requestStaticPage(filePath, modelName, options) {
    const result = await runBridge({
        command: 'read-map-static-geometry',
        filePath,
        allowedRoots: [dirname(filePath)],
        ...(options.oodleRuntimeRoot ? { oodleRuntimeRoot: options.oodleRuntimeRoot } : {}),
        ...(options.bridgeExecutablePath ? { bridgeExecutablePath: options.bridgeExecutablePath } : {}),
        workspaceSessionId: options.workspaceSessionId,
        maxConcurrency: SF14_MAX_CONCURRENCY,
        timeoutMs: 120_000,
        commandOptions: {
            modelName,
            ...(options.ownerLeaseId ? { ownerLeaseId: options.ownerLeaseId } : {}),
            ...(options.sessionToken ? { sessionToken: options.sessionToken } : {}),
            ...(options.cursor ? { cursor: options.cursor } : {}),
            resourceCacheKey: 'sf14-smoke'
        }
    });
    return {
        data: (result.data ?? {}),
        diagnostics: result.diagnostics,
        parseStatus: result.parseStatus
    };
}
async function readMapTypedIndexCount(filePath, workspaceSessionId) {
    const result = await runBridge({
        command: 'read-flver-document',
        filePath,
        allowedRoots: [dirname(filePath)],
        workspaceSessionId,
        maxConcurrency: SF14_MAX_CONCURRENCY,
        timeoutMs: 120_000
    });
    assert.notEqual(result.parseStatus, 'failed', JSON.stringify(result.diagnostics));
    const count = result.data?.telemetry?.mapTypedIndexRead;
    assert.equal(typeof count, 'number', 'read-flver-document must expose mapTypedIndexRead');
    return count;
}
async function collectPages(filePath, modelName, workspaceSessionId, ownerLeaseId, expected, oodleRuntimeRoot, measureIndexReads = false) {
    const pages = [];
    const triangles = [];
    const trianglesByMesh = new Map();
    const mapTypedIndexReadDeltas = [];
    let mapTypedIndexReadBefore;
    if (measureIndexReads) {
        mapTypedIndexReadBefore = await readMapTypedIndexCount(filePath, workspaceSessionId);
        // The probe itself must be inert; otherwise the per-page deltas could be
        // falsely green by mixing parser work into the map index counter.
        const stableProbe = await readMapTypedIndexCount(filePath, workspaceSessionId);
        assert.equal(stableProbe, mapTypedIndexReadBefore, 'read-flver-document must not increment mapTypedIndexRead');
    }
    let sessionToken;
    let cursor;
    for (let pageNumber = 0; pageNumber < 256; pageNumber++) {
        const result = await requestStaticPage(filePath, modelName, {
            workspaceSessionId,
            ownerLeaseId,
            ...(sessionToken ? { sessionToken } : {}),
            ...(cursor ? { cursor } : {}),
            ...(oodleRuntimeRoot ? { oodleRuntimeRoot } : {})
        });
        if (measureIndexReads) {
            const mapTypedIndexReadAfter = await readMapTypedIndexCount(filePath, workspaceSessionId);
            mapTypedIndexReadDeltas.push(mapTypedIndexReadAfter - mapTypedIndexReadBefore);
            mapTypedIndexReadBefore = mapTypedIndexReadAfter;
        }
        assert.notEqual(result.parseStatus, 'failed', JSON.stringify(result.diagnostics));
        assert.equal(result.data.complete === true || typeof result.data.nextCursor === 'string', true);
        const chunk = result.data.chunks?.[0];
        assert.ok((result.data.chunks?.length ?? 0) <= 1);
        if (!chunk) {
            assert.equal(result.data.complete, true);
            pages.push(result.data);
            break;
        }
        const shape = assertChunkShape(chunk, expected);
        triangles.push(...shape.sourceTriangles);
        assert.ok(Buffer.byteLength(JSON.stringify(result.data), 'utf8') < 8 * 1024 * 1024);
        if (expected) {
            assert.equal(chunk.sourceVertexCount, expected.vertexCount);
            assert.equal(chunk.sourceIndexCount, expected.indices.length);
            assert.equal(chunk.boundsStatus, 'native');
        }
        if (sessionToken)
            assert.equal(result.data.sessionToken, sessionToken);
        if (expected) {
            assert.equal(chunk.sourceTriangleStart, triangles.length - shape.sourceTriangles.length);
        }
        else {
            assert.equal(typeof chunk.meshIndex, 'number');
            const meshIndex = chunk.meshIndex;
            const meshTriangleStart = trianglesByMesh.get(meshIndex) ?? 0;
            assert.equal(chunk.sourceTriangleStart, meshTriangleStart);
            trianglesByMesh.set(meshIndex, meshTriangleStart + shape.sourceTriangles.length);
        }
        if (result.data.complete) {
            pages.push(result.data);
            break;
        }
        sessionToken = result.data.sessionToken;
        assert.ok(sessionToken);
        cursor = result.data.nextCursor ?? undefined;
        assert.ok(cursor);
        pages.push(result.data);
    }
    assert.equal(pages.some((page) => page.complete === true), true, 'pagination did not terminate');
    if (expected)
        assert.deepEqual(triangles, expected.expectedTriangles);
    return {
        pages,
        triangles,
        mapTypedIndexReadDeltas,
        ...(measureIndexReads
            ? { mapTypedIndexReadTotal: mapTypedIndexReadDeltas.reduce((sum, value) => sum + value, 0) }
            : {})
    };
}
function assertReferencePayload(chunk, expectedPositions, expectedNormals) {
    assert.ok(chunk.positionsBase64);
    assert.ok(chunk.normalsBase64);
    assert.ok(chunk.sourceVertexIndicesBase64);
    assert.deepEqual(decodeSourceIndices(chunk.sourceVertexIndicesBase64), [0, 1, 2]);
    assertTupleClose(decodeFloats(chunk.positionsBase64), expectedPositions, 'reference positions');
    assertTupleClose(decodeFloats(chunk.normalsBase64), expectedNormals, 'reference normals');
}
async function runReferencePoseRegression(workspaceRoot) {
    const checks = [];
    const cases = [
        { name: 'absolute', testCase: 'absolute' },
        { name: 'dynamic', testCase: 'dynamic' },
        { name: 'dynamic-cycle', testCase: 'dynamic-cycle' },
        { name: 'unused-singular', testCase: 'unused-singular' },
        { name: 'weighted', testCase: 'weighted', expectFailure: 'MAP_STATIC_SKINNING_WEIGHTED_UNSUPPORTED' },
        { name: 'invalid-binding', testCase: 'invalid-binding', expectFailure: 'MAP_STATIC_SKINNING_INVALID' },
        { name: 'used-singular', testCase: 'used-singular', expectFailure: 'FLVER_REFERENCE_FK_SINGULAR' }
    ];
    // Native smoke runners may override the bridge artifact while validating a
    // local Debug build.  Normal suite execution leaves this unset and uses the
    // same automatic resolver as every other runBridge call.
    const bridgeExecutableOverride = process.env.SOULFORGE_BRIDGE_EXECUTABLE;
    for (const item of cases) {
        const fixture = buildSyntheticReferencePoseFlver(item.testCase);
        const filePath = join(workspaceRoot, `sf14-reference-${item.name}.flver`);
        await writeFile(filePath, fixture.bytes);
        const result = await requestStaticPage(filePath, `sf14-reference-${item.name}.flver`, {
            workspaceSessionId: `sf14-reference-${item.name}`,
            ownerLeaseId: `sf14-reference-owner-${item.name}`,
            ...(bridgeExecutableOverride ? { bridgeExecutablePath: bridgeExecutableOverride } : {})
        });
        if (item.expectFailure) {
            assert.equal(result.parseStatus, 'failed', `${item.name} must fail closed`);
            assert.ok(result.diagnostics.some((diagnostic) => `${diagnostic.code ?? ''} ${diagnostic.message ?? ''}`.includes(item.expectFailure)), `${item.name} diagnostics: ${JSON.stringify(result.diagnostics)}`);
            checks.push(`${item.name} failed closed`);
            continue;
        }
        assert.notEqual(result.parseStatus, 'failed', `${item.name}: ${JSON.stringify(result.diagnostics)}`);
        const chunk = result.data.chunks?.[0];
        assert.ok(chunk, `${item.name} must emit one chunk`);
        if (item.testCase === 'dynamic' || item.testCase === 'dynamic-cycle') {
            assertReferencePayload(chunk, fixture.rawPositions, fixture.rawNormals);
        }
        else {
            assertReferencePayload(chunk, fixture.expectedAbsolutePositions, fixture.expectedAbsoluteNormals);
        }
        assert.equal(chunk.sourceVertexCount, 3);
        assert.equal(chunk.sourceIndexCount, 3);
        checks.push(`${item.name} reference payload`);
    }
    return checks;
}
async function runUnit() {
    const fixture = buildSyntheticStripFlver();
    const workspace = await createSmokeWorkspace('audit-sf14-unit');
    try {
        const filePath = join(workspace.root, 'sf14-strip.flver');
        const changedPath = join(workspace.root, 'sf14-strip-changed.flver');
        await writeFile(filePath, fixture.bytes);
        const workspaceSessionId = 'sf14-unit-workspace';
        const ownerA = 'sf14-owner-a';
        const ownerB = 'sf14-owner-b';
        const parserBefore = await runBridge({
            command: 'read-flver-document',
            filePath,
            allowedRoots: [workspace.root],
            workspaceSessionId,
            maxConcurrency: SF14_MAX_CONCURRENCY,
            timeoutMs: 120_000
        });
        assert.notEqual(parserBefore.parseStatus, 'failed', JSON.stringify(parserBefore.diagnostics));
        const parserBeforeTelemetry = parserBefore.data?.telemetry;
        assert.ok((parserBeforeTelemetry?.flverParse ?? 0) >= 2);
        assert.equal(parserBeforeTelemetry?.flverBase64Decode, 0);
        const first = await requestStaticPage(filePath, 'sf14-strip.flver', {
            workspaceSessionId, ownerLeaseId: ownerA
        });
        assert.notEqual(first.parseStatus, 'failed', JSON.stringify(first.diagnostics));
        assert.equal(first.data.telemetry?.skin, 0);
        assert.equal(first.data.telemetry?.skeleton, 0);
        assert.equal(first.data.telemetry?.parse, 1);
        assert.equal(first.data.chunks?.[0]?.triangleCount, 8_000);
        const parserAfter = await runBridge({
            command: 'read-flver-document',
            filePath,
            allowedRoots: [workspace.root],
            workspaceSessionId,
            maxConcurrency: SF14_MAX_CONCURRENCY,
            timeoutMs: 120_000
        });
        assert.notEqual(parserAfter.parseStatus, 'failed', JSON.stringify(parserAfter.diagnostics));
        const parserAfterTelemetry = parserAfter.data?.telemetry;
        assert.equal((parserAfterTelemetry?.flverParse ?? 0) - (parserBeforeTelemetry?.flverParse ?? 0), 3, 'one map session parse plus two independent read-flver reparse calls expected');
        assert.equal((parserAfterTelemetry?.flverBase64Encode ?? 0)
            - (parserBeforeTelemetry?.flverBase64Encode ?? 0), 1, 'read-flver envelope authority performs its known one-mesh wire probe; map did not add one');
        assert.equal(parserAfterTelemetry?.flverBase64Decode, 0);
        const firstCursor = first.data.nextCursor;
        const firstSession = first.data.sessionToken;
        assert.ok(firstCursor && firstSession);
        const oldCursor = Buffer.from('0:0', 'utf8').toString('base64');
        const oldCursorResult = await requestStaticPage(filePath, 'sf14-strip.flver', {
            workspaceSessionId, ownerLeaseId: ownerA, sessionToken: firstSession, cursor: oldCursor
        });
        assert.equal(oldCursorResult.parseStatus, 'failed');
        assert.ok(diagnosticCodes(oldCursorResult).includes('MAP_STATIC_CURSOR_INVALID'));
        const ownerBFirst = await requestStaticPage(filePath, 'sf14-strip.flver', {
            workspaceSessionId, ownerLeaseId: ownerB
        });
        assert.notEqual(ownerBFirst.parseStatus, 'failed');
        assert.ok(ownerBFirst.data.nextCursor);
        const wrongOwnerResult = await requestStaticPage(filePath, 'sf14-strip.flver', {
            workspaceSessionId, ownerLeaseId: ownerA, sessionToken: firstSession,
            cursor: ownerBFirst.data.nextCursor
        });
        assert.equal(wrongOwnerResult.parseStatus, 'failed');
        assert.ok(diagnosticCodes(wrongOwnerResult).includes('MAP_STATIC_CURSOR_INVALID'));
        const changed = Buffer.from(fixture.bytes);
        changed[changed.length - 1] ^= 0x01;
        await writeFile(changedPath, changed);
        const staleResult = await requestStaticPage(changedPath, 'sf14-strip.flver', {
            workspaceSessionId, ownerLeaseId: ownerA, sessionToken: firstSession, cursor: firstCursor
        });
        assert.equal(staleResult.parseStatus, 'failed');
        assert.ok(diagnosticCodes(staleResult).includes('MAP_STATIC_SESSION_EXPIRED'));
        const missingModel = await runBridge({
            command: 'read-map-static-geometry',
            filePath,
            allowedRoots: [workspace.root],
            workspaceSessionId,
            maxConcurrency: SF14_MAX_CONCURRENCY,
            timeoutMs: 120_000,
            commandOptions: {}
        });
        assert.equal(missingModel.parseStatus, 'failed');
        assert.ok(diagnosticCodes(missingModel).includes('MAPBND_MODEL_NAME_MISSING'));
        const collected = await collectPages(filePath, 'sf14-strip.flver', workspaceSessionId, 'sf14-owner-pages', fixture);
        const chunks = collected.pages.filter((page) => (page.chunks?.length ?? 0) > 0);
        assert.equal(chunks[0]?.chunks?.[0]?.sourceTriangleStart, 0);
        assert.equal(chunks[1]?.chunks?.[0]?.sourceTriangleStart, 8_000);
        assert.equal(collected.triangles.length, fixture.expectedTriangles.length);
        assert.equal(chunks[0]?.telemetry?.parse, chunks[1]?.telemetry?.parse);
        assert.ok((chunks[0]?.telemetry?.parse ?? 0) >= 1);
        assert.equal(chunks[0]?.chunks?.[0]?.telemetry?.flverParse, chunks[1]?.chunks?.[0]?.telemetry?.flverParse, 'page two must not re-enter the FLVER parser');
        assert.equal(chunks[0]?.chunks?.[0]?.telemetry?.flverBase64Encode, chunks[1]?.chunks?.[0]?.telemetry?.flverBase64Encode);
        const wideTarget = 32_005;
        const wideStripFixture = buildSyntheticStripFlver(wideTarget);
        const wideStripPath = join(workspace.root, 'sf14-strip-wide.flver');
        await writeFile(wideStripPath, wideStripFixture.bytes);
        const wideStrip = await collectPages(wideStripPath, 'sf14-strip-wide.flver', workspaceSessionId, 'sf14-owner-wide-strip', wideStripFixture, undefined, true);
        const wideStripChunks = wideStrip.pages.filter((page) => (page.chunks?.length ?? 0) > 0);
        assert.ok(wideStripChunks.length >= 4, 'strip fixture must exercise at least four geometry pages');
        assert.ok(wideStrip.mapTypedIndexReadTotal <= wideStripFixture.indices.length + wideStrip.pages.length * 64, `strip map index reads must stay linear: ${wideStrip.mapTypedIndexReadTotal} > ${wideStripFixture.indices.length + wideStrip.pages.length * 64}`);
        const wideListFixture = buildSyntheticTriangleListFlver(wideTarget);
        const wideListPath = join(workspace.root, 'sf14-list-wide.flver');
        await writeFile(wideListPath, wideListFixture.bytes);
        const wideList = await collectPages(wideListPath, 'sf14-list-wide.flver', workspaceSessionId, 'sf14-owner-wide-list', wideListFixture, undefined, true);
        const wideListChunks = wideList.pages.filter((page) => (page.chunks?.length ?? 0) > 0);
        assert.ok(wideListChunks.length >= 4, 'list fixture must exercise at least four geometry pages');
        assert.ok(wideList.mapTypedIndexReadTotal <= wideListFixture.indices.length + wideList.pages.length * 64, `list map index reads must stay linear: ${wideList.mapTypedIndexReadTotal} > ${wideListFixture.indices.length + wideList.pages.length * 64}`);
        const referencePoseChecks = await runReferencePoseRegression(workspace.root);
        return {
            ok: true, status: 'passed', layer: 'unit', pages: chunks.length,
            triangles: collected.triangles.length,
            wideStripPages: wideStripChunks.length,
            wideStripMapTypedIndexRead: wideStrip.mapTypedIndexReadTotal,
            wideListPages: wideListChunks.length,
            wideListMapTypedIndexRead: wideList.mapTypedIndexReadTotal,
            referencePoseChecks,
            checks: [
                'typed lazy projection', 'strip parity across page boundary',
                'degenerate and primitive restart semantics', 'wire frame budget',
                'multi-page list/strip linear index-read budget',
                'opaque old cursor rejection', 'cross-owner cursor rejection',
                'source hash/session expiry rejection', 'missing model rejection',
                'reference FK rigid bake and inverse-transpose normals',
                'dynamic/cyclic hierarchy bypass', 'weighted and invalid binding fail-closed',
                'unused singular bone tolerance'
            ]
        };
    }
    finally {
        await workspace.dispose();
    }
}
async function resolveMapFixture(explicitPath) {
    try {
        const resolved = await resolveNativeFixture(explicitPath, 'map-primary', '../../mods/map/m10_00_00_00/m10_00_00_00_600050.mapbnd.dcx');
        return existsSync(resolved) ? resolved : undefined;
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!explicitPath && (message.includes('NATIVE_FIXTURE_ROLE_MISSING')
            || message.includes('ENOENT') || message.includes('cannot find')))
            return undefined;
        throw error;
    }
}
async function runNative() {
    const fixturePath = await resolveMapFixture(optionValue('--fixture'));
    if (!fixturePath) {
        return {
            ok: true, status: 'skipped', layer: 'native',
            code: 'SF14_NATIVE_FIXTURE_UNAVAILABLE',
            message: '未找到登记的 map-primary 或 legacy mapbnd 语料。'
        };
    }
    const root = process.env.SOULFORGE_SEKIRO_GAME_ROOT?.trim();
    const inventory = await runBridge({
        command: 'list-bnd4-entries',
        filePath: fixturePath,
        allowedRoots: [dirname(fixturePath)],
        ...(root ? { oodleRuntimeRoot: root } : {}),
        timeoutMs: 180_000,
        commandOptions: {}
    });
    if (inventory.parseStatus === 'failed' || !inventory.data) {
        const codes = diagnosticCodes(inventory);
        if (codes.some((code) => code.includes('OODLE') || code.includes('KRAK'))) {
            return {
                ok: true, status: 'skipped', layer: 'native',
                code: 'SF14_NATIVE_OODLE_UNAVAILABLE', diagnostics: inventory.diagnostics
            };
        }
        throw new Error('map-primary BND4 inventory failed: ' + JSON.stringify(inventory.diagnostics));
    }
    const entry = (inventory.data.entries ?? []).find((item) => /\.flver$/i.test(item.name ?? ''));
    assert.ok(entry?.name, 'map-primary BND4 has no FLVER entry');
    const collected = await collectPages(fixturePath, entry.name, 'sf14-native-workspace', 'sf14-native-owner', undefined, root);
    const firstChunk = collected.pages.find((page) => page.complete !== true)?.chunks?.[0];
    assert.ok(firstChunk);
    assert.equal(firstChunk.boundsStatus, 'native');
    assert.equal(firstChunk.sourceVertexCount > 0, true);
    assert.equal(firstChunk.sourceIndexCount > 0, true);
    assert.equal(collected.triangles.length > 0, true);
    return {
        ok: true, status: 'passed', layer: 'native', filePath: fixturePath,
        modelName: entry.name, pages: collected.pages.length,
        triangles: collected.triangles.length,
        sourceVertexCount: firstChunk.sourceVertexCount,
        sourceIndexCount: firstChunk.sourceIndexCount
    };
}
async function main() {
    const layer = optionValue('--layer');
    if (layer !== 'unit' && layer !== 'native') {
        throw new Error('SF14_LAYER_REQUIRED: 使用 --layer unit 或 --layer native。');
    }
    try {
        console.log(JSON.stringify(layer === 'unit' ? await runUnit() : await runNative(), null, 2));
    }
    finally {
        await disposeBridgeDaemonPool();
    }
}
main().catch((error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    process.exitCode = 1;
});
//# sourceMappingURL=runAuditSf14Smoke.js.map