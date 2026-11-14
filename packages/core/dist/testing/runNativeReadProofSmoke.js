import { createHash } from 'node:crypto';
import { createSmokeTemporaryDirectory } from './harness/smokeWorkspace.js';
/** T01/T09 原生读取证明冒烟：无台账 read→require 成功；伪造/过期/越权拒绝。 */
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { createNativeReadProofStore, ProofError } from '../editing/nativeReadProofStore.js';
import { CoreToolSession } from '../runtime/coreToolSession.js';
import { createDefaultToolRegistry, ToolRegistry } from '../ai/toolRegistry.js';
import { finalizeCommittedToolResult } from '../ai/toolRegistry.js';
import { createAgentToolBridge } from '../ai/agentToolBridge.js';
import { buildWriteRequirement, assertAllMutatingToolsClassified } from '../editing/writeRequirements.js';
import { paramDeliveredReads, paramTableObjectKey, paramObjectKey, paramOuterKey, emevdFileObjectKey } from '../editing/proofIdentities.js';
import { fmgDeliveredReads, fmgContainerDeliveredRead, fmgObjectKey, fmgContainerKey, describeObjectKey, scriptObjectKey, taeDeliveredReads, taeObjectKey, parseTaeAddress, msbDeliveredReads, msbObjectKey, msbAddressKey } from '../editing/proofIdentities.js';
function expectProofError(fn, code) {
    try {
        fn();
    }
    catch (error) {
        assert.ok(error instanceof ProofError, `expected ProofError, got ${String(error)}`);
        assert.equal(error.code, code);
        return;
    }
    assert.fail(`expected ${code} but no error thrown`);
}
export async function runNativeReadProofSmoke() {
    const store = createNativeReadProofStore();
    // 正向：宿主记录已送达字段读取后，同版本同字段写入要求通过。
    store.acceptDeliveredRead({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture.parambnd.dcx|entry:0|row:1000|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture.parambnd.dcx',
        version: { outerFileHash: 'a'.repeat(64), childHash: 'b'.repeat(64), sourceRevision: 7 },
        deliveredFields: ['hp'],
        readShape: 'fields'
    });
    const proof = store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture.parambnd.dcx|entry:0|row:1000|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture.parambnd.dcx',
        version: { outerFileHash: 'a'.repeat(64), childHash: 'b'.repeat(64), sourceRevision: 7 },
        requiredFields: ['hp']
    });
    assert.deepEqual(proof.coveredFields, ['hp']);
    // 同一证明可复查多次，无次数限制。
    store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture.parambnd.dcx|entry:0|row:1000|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture.parambnd.dcx',
        version: { outerFileHash: 'a'.repeat(64), childHash: 'b'.repeat(64), sourceRevision: 7 },
        requiredFields: ['hp']
    });
    // 存入防御性拷贝：调用方事后修改传入数组/范围不影响已记录证明。
    const mutableFields = ['mp'];
    store.acceptDeliveredRead({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture2.parambnd.dcx|entry:0|row:1|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture2.parambnd.dcx',
        version: {},
        deliveredFields: mutableFields,
        readShape: 'fields'
    });
    mutableFields.push('hp');
    store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture2.parambnd.dcx|entry:0|row:1|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture2.parambnd.dcx',
        version: {},
        requiredFields: ['mp']
    });
    expectProofError(() => store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture2.parambnd.dcx|entry:0|row:1|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture2.parambnd.dcx',
        version: {},
        requiredFields: ['hp']
    }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    const mutableRange = { startByte: 0, endByte: 64, totalUtf8Bytes: 64, fullTextHash: 'f'.repeat(64) };
    store.acceptDeliveredRead({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'emevd|workspace://mods/event/r.parambnd.dcx|event:1',
        outerSourceKey: 'workspace://mods/event/r.parambnd.dcx',
        version: {},
        readShape: 'full-event',
        deliveredTextRange: mutableRange
    });
    mutableRange.endByte = 0;
    store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'emevd|workspace://mods/event/r.parambnd.dcx|event:1',
        outerSourceKey: 'workspace://mods/event/r.parambnd.dcx',
        version: {},
        requiredShape: 'full-event'
    });
    // P13：全文分页全部送达后形成整对象 proof；页可乱序、重叠。
    const pagedKey = {
        principal: 'page-agent',
        workspaceId: 'page-workspace',
        objectKey: 'emevd|workspace://mods/event/paged.emevd.dcx|event:9',
        outerSourceKey: 'workspace://mods/event/paged.emevd.dcx',
        version: { outerFileHash: 'p'.repeat(64) }
    };
    const page = (startByte, endByte) => ({
        ...pagedKey,
        readShape: 'full-event',
        deliveredTextRange: { startByte, endByte, totalUtf8Bytes: 128, fullTextHash: 't'.repeat(64) }
    });
    const requirePagedFull = () => store.requireCoverage({ ...pagedKey, requiredShape: 'full-event' });
    store.acceptDeliveredRead(page(64, 128));
    expectProofError(requirePagedFull, 'NATIVE_READ_COVERAGE_INCOMPLETE');
    store.acceptDeliveredRead(page(0, 64));
    requirePagedFull();
    // 跨页子范围要求：并集包含即通过。
    store.requireCoverage({ ...pagedKey, requiredShape: 'full-event', requiredTextRange: { startByte: 32, endByte: 96 } });
    expectProofError(() => store.requireCoverage({
        ...pagedKey, requiredShape: 'full-event', requiredTextRange: { startByte: 32, endByte: 129 }
    }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    // P14：缺一字节、纯重复页、跨版本页、跨全文哈希页均不形成整对象 proof。
    const gapKey = { ...pagedKey, objectKey: `${pagedKey.objectKey}-gap` };
    store.acceptDeliveredRead({ ...page(0, 64), objectKey: gapKey.objectKey });
    store.acceptDeliveredRead({ ...page(65, 128), objectKey: gapKey.objectKey });
    expectProofError(() => store.requireCoverage({ ...gapKey, requiredShape: 'full-event' }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    const dupKey = { ...pagedKey, objectKey: `${pagedKey.objectKey}-dup` };
    store.acceptDeliveredRead({ ...page(0, 64), objectKey: dupKey.objectKey });
    store.acceptDeliveredRead({ ...page(0, 64), objectKey: dupKey.objectKey });
    expectProofError(() => store.requireCoverage({ ...dupKey, requiredShape: 'full-event' }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    const verKey = { ...pagedKey, objectKey: `${pagedKey.objectKey}-ver` };
    store.acceptDeliveredRead({ ...page(0, 64), objectKey: verKey.objectKey });
    store.acceptDeliveredRead({
        ...page(64, 128),
        objectKey: verKey.objectKey,
        version: { outerFileHash: 'q'.repeat(64) }
    });
    expectProofError(() => store.requireCoverage({
        ...verKey, version: { outerFileHash: 'q'.repeat(64) }, requiredShape: 'full-event'
    }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    const hashKey = { ...pagedKey, objectKey: `${pagedKey.objectKey}-hash` };
    store.acceptDeliveredRead({ ...page(0, 64), objectKey: hashKey.objectKey });
    store.acceptDeliveredRead({
        ...hashKey,
        readShape: 'full-event',
        deliveredTextRange: { startByte: 64, endByte: 128, totalUtf8Bytes: 128, fullTextHash: 'z'.repeat(64) }
    });
    expectProofError(() => store.requireCoverage({ ...hashKey, requiredShape: 'full-event' }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    // 空事件/空脚本：可信总长度 0 的单页即完整（非“任意空返回”，需显式页）。
    const emptyKey = { ...pagedKey, objectKey: `${pagedKey.objectKey}-empty` };
    store.acceptDeliveredRead({
        ...emptyKey,
        readShape: 'full-script',
        deliveredTextRange: { startByte: 0, endByte: 0, totalUtf8Bytes: 0, fullTextHash: 'e'.repeat(64) }
    });
    store.requireCoverage({ ...emptyKey, requiredShape: 'full-script' });
    // 非法页在存入时即失败关闭。
    expectProofError(() => store.acceptDeliveredRead({
        ...emptyKey,
        readShape: 'full-script',
        deliveredTextRange: { startByte: 90, endByte: 10, totalUtf8Bytes: 128, fullTextHash: 'e'.repeat(64) }
    }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    // 负向1：从未记录的字段不得通过。
    expectProofError(() => store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture.parambnd.dcx|entry:0|row:1000|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture.parambnd.dcx',
        version: { outerFileHash: 'a'.repeat(64), childHash: 'b'.repeat(64), sourceRevision: 7 },
        requiredFields: ['hp', 'mp']
    }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    // 负向2：跨主体 proof 不得复用。
    expectProofError(() => store.requireCoverage({
        principal: 'other-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture.parambnd.dcx|entry:0|row:1000|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture.parambnd.dcx',
        version: { outerFileHash: 'a'.repeat(64), childHash: 'b'.repeat(64), sourceRevision: 7 },
        requiredFields: ['hp']
    }), 'NATIVE_READ_REQUIRED');
    // 负向3：版本变化后旧证明失效，不静默套用。
    expectProofError(() => store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|workspace://mods/param/fixture.parambnd.dcx|entry:0|row:1000|rowIndex:0',
        outerSourceKey: 'workspace://mods/param/fixture.parambnd.dcx',
        version: { outerFileHash: 'c'.repeat(64), childHash: 'b'.repeat(64), sourceRevision: 8 },
        requiredFields: ['hp']
    }), 'NATIVE_READ_STALE');
    // 负向4：片段观察不得授权整事件替换。
    store.acceptDeliveredRead({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'emevd|workspace://mods/event/m11.emevd.dcx|event:1000',
        outerSourceKey: 'workspace://mods/event/m11.emevd.dcx',
        version: { outerFileHash: 'd'.repeat(64) },
        readShape: 'fragment'
    });
    expectProofError(() => store.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'emevd|workspace://mods/event/m11.emevd.dcx|event:1000',
        outerSourceKey: 'workspace://mods/event/m11.emevd.dcx',
        version: { outerFileHash: 'd'.repeat(64) },
        requiredShape: 'full-event'
    }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
    // 会话级失效：source 变化后 proof 不可复用——但它是「读过、对象变了」（STALE），不是「没读过」；
    // 带内容锚点的写入只有锚点仍然相等时才能自证没变，这里锚点已被改动。
    const session = new CoreToolSession({ principal: 'fixture-agent', workspaceId: 'fixture-workspace' });
    session.proofStore.acceptDeliveredRead({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|k',
        outerSourceKey: 'outer',
        version: { outerFileHash: 'e'.repeat(64) },
        deliveredFields: ['hp'],
        readShape: 'fields'
    });
    session.invalidateSource('outer');
    expectProofError(() => session.proofStore.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|k',
        outerSourceKey: 'outer',
        version: {},
        requiredFields: ['hp']
    }), 'NATIVE_READ_STALE');
    expectProofError(() => session.proofStore.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|k',
        outerSourceKey: 'outer',
        version: { outerFileHash: 'f'.repeat(64) },
        requiredFields: ['hp']
    }), 'NATIVE_READ_STALE');
    assert.equal(session.proofStore.requireCoverage({
        principal: 'fixture-agent',
        workspaceId: 'fixture-workspace',
        objectKey: 'param|k',
        outerSourceKey: 'outer',
        version: { outerFileHash: 'e'.repeat(64) },
        requiredFields: ['hp']
    }).objectKey, 'param|k');
    session.close();
    assert.equal(session.isClosed, true);
    // 普通读取没有工作区时先失败关闭；不能把一个额外的模型字段当成
    // 原生读取或证明入口。
    const registry = createDefaultToolRegistry();
    const invalid = await registry.run('read_param_fields', {
        table: 'FixtureNpcParam', rowIds: [1000], fieldIds: ['hp'], related: 'bogus'
    }, { workspaceIndex: null, mode: 'normal' });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error?.code, 'WORKSPACE_REQUIRED');
    // 桥接不再依赖旧 task ledger：普通 stub 读仍可完成，但没有宿主会话
    // 就不会产生可用于写入的 NativeReadProof。
    const confirmRegistry = new ToolRegistry();
    confirmRegistry.register({
        name: 'read_param_fields',
        description: 'fixture native read',
        permission: 'read',
        run: () => ({ ok: true, data: { fields: [{ fieldId: 'hp', rowId: 1000, value: 500 }] } })
    });
    const confirmBridge = createAgentToolBridge({
        registry: confirmRegistry,
        context: {
            workspaceIndex: null,
            mode: 'plan'
        }
    });
    const confirmResult = await confirmBridge.executeTool({
        id: 'bridge-confirm', name: 'read_param_fields', argumentsJson: '{}'
    });
    assert.equal(confirmResult.ok, true);
    // 写入要求：9 个生产写入工具全部分类；实际 payload 每个目标都提取；未知工具失败关闭。
    assertAllMutatingToolsClassified([
        'commit_patch', 'mutate_param_fields', 'create_param_row', 'mutate_fmg_entries', 'apply_emevd_dsl',
        'mutate_tae_event_times', 'mutate_msb_part_transform', 'mutate_luabnd_script',
        'batch_transform_map_objects', 'import_map_from_blender'
    ]);
    const paramReqs = buildWriteRequirement('mutate_param_fields', {
        edits: [
            { table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp', value: 900 },
            { table: 'FixtureNpcParam', rowId: 1000, fieldId: 'mp', value: 100 }
        ]
    }, 'outer');
    assert.equal(paramReqs.length, 2);
    assert.deepEqual(paramReqs[1].requiredFields, ['mp']);
    const patchReqs = buildWriteRequirement('commit_patch', {
        changes: [{ tool: 'mutate_param_fields', args: { edits: [{ table: 'T', rowId: 1, fieldId: 'f', value: 1 }] } }]
    }, 'outer');
    assert.equal(patchReqs.length, 1);
    assert.throws(() => buildWriteRequirement('nonexistent_tool', {}, 'outer'), /WRITE_REQUIREMENT_UNCLASSIFIED_TOOL/);
    assert.throws(() => buildWriteRequirement('mutate_param_fields', { edits: [] }, 'outer'), /WRITE_REQUIREMENT_EMPTY_EDITS/);
    // 会话证明边界端到端（stub 注册表，无原生环境）：
    // 预读证明 → stub 写入放行；无证明 → 拒绝且 writer 未被调用。
    const { mkdir, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const overlayRoot = await createSmokeTemporaryDirectory(join(tmpdir(), 'soulforge-proof-gate-'));
    const containerDir = join(overlayRoot, 'param', 'gameparam');
    await mkdir(containerDir, { recursive: true });
    const containerPath = join(containerDir, 'gameparam.parambnd.dcx');
    await writeFile(containerPath, Buffer.from([0x44, 0x43, 0x58, 0x00]));
    const stubSession = { layers: { overlayRoot } };
    const gateSession = new CoreToolSession({ principal: 'gate-agent', workspaceId: 'gate-workspace' });
    const gateRegistry = new ToolRegistry();
    let gateWriterCalls = 0;
    gateRegistry.register({
        name: 'mutate_param_fields',
        description: 'fixture writer',
        permission: 'commit',
        run: () => { gateWriterCalls += 1; return { ok: true, data: {} }; }
    });
    const gateContext = { workspaceIndex: null, mode: 'fullPermission', coreSession: gateSession, session: stubSession };
    const denied = await gateRegistry.run('mutate_param_fields', {
        edits: [{ table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp', value: 900 }]
    }, gateContext);
    assert.equal(denied.ok, false);
    assert.equal(denied.error?.code, 'NATIVE_READ_REQUIRED');
    assert.equal(gateWriterCalls, 0);
    for (const delivered of paramDeliveredReads({
        principal: 'gate-agent', workspaceId: 'gate-workspace', containerPath,
        fields: [{ table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp', sourceHash: 'a'.repeat(64), sourceRevision: 7 }]
    })) {
        gateSession.proofStore.acceptDeliveredRead(delivered);
    }
    const allowed = await gateRegistry.run('mutate_param_fields', {
        edits: [{ table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp', value: 900 }]
    }, gateContext);
    assert.equal(allowed.ok, true);
    assert.equal(gateWriterCalls, 1);
    // 同一证明不覆盖未读字段：逐字段键下是无证明，整调用在 writer 前拒绝。
    const uncovered = await gateRegistry.run('mutate_param_fields', {
        edits: [{ table: 'FixtureNpcParam', rowId: 1000, fieldId: 'mp', value: 100 }]
    }, gateContext);
    assert.equal(uncovered.ok, false);
    assert.equal(uncovered.error?.code, 'NATIVE_READ_REQUIRED');
    assert.equal(gateWriterCalls, 1);
    gateSession.close();
    // 双跑解耦（T12.4）：会话证明覆盖的写入不依赖旧网关；网关仅为未覆盖路径兜底。
    // 此处网关存在但其写入门禁若被调用即失败——覆盖路径必须一次都不碰它。
    const dualSession = new CoreToolSession({ principal: 'dual-agent', workspaceId: 'dual-workspace' });
    const dualRegistry = new ToolRegistry();
    let dualWriterCalls = 0;
    let dualGateMutationCalls = 0;
    dualRegistry.register({
        name: 'mutate_param_fields',
        description: 'fixture writer',
        permission: 'commit',
        run: () => { dualWriterCalls += 1; return { ok: true, data: {} }; }
    });
    for (const delivered of paramDeliveredReads({
        principal: 'dual-agent', workspaceId: 'dual-workspace', containerPath,
        fields: [{ table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp' }]
    })) {
        dualSession.proofStore.acceptDeliveredRead(delivered);
    }
    const dualContext = {
        workspaceIndex: null,
        mode: 'fullPermission',
        coreSession: dualSession,
        session: stubSession,
        requireTaskRecord: true,
        taskRecord: {
            beforeSearch: async () => ({ ok: true }),
            assertParamReadTarget: async () => ({ ok: true }),
            assertMutationTarget: async () => {
                dualGateMutationCalls += 1;
                return { ok: false, code: 'GATE_SHOULD_NOT_BE_CONSULTED', message: 'covered path must not consult legacy gate' };
            }
        }
    };
    const dualWrite = await dualRegistry.run('mutate_param_fields', {
        edits: [{ table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp', value: 900 }]
    }, dualContext);
    assert.equal(dualWrite.ok, true);
    assert.equal(dualWriterCalls, 1);
    assert.equal(dualGateMutationCalls, 0, '会话覆盖的写入不得调用旧网关写入门禁');
    dualSession.close();
    // 桥接新路径：stub 读取经投影成功后，会话存储自动拥有证明。
    const bridgeSession = new CoreToolSession({ principal: 'bridge-agent', workspaceId: 'bridge-workspace' });
    const bridgeRegistry = new ToolRegistry();
    bridgeRegistry.register({
        name: 'read_param_fields',
        description: 'fixture native read',
        permission: 'read',
        run: () => ({
            ok: true,
            data: {
                containerPath,
                fields: [{ table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp', value: 500, sourceHash: 'b'.repeat(64), sourceRevision: 3 }]
            }
        })
    });
    const sessionBridge = createAgentToolBridge({
        registry: bridgeRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: bridgeSession }
    });
    const bridgeRead = await sessionBridge.executeTool({ id: 'bridge-read', name: 'read_param_fields', argumentsJson: '{}' });
    assert.equal(bridgeRead.ok, true);
    bridgeSession.proofStore.requireCoverage({
        principal: 'bridge-agent', workspaceId: 'bridge-workspace',
        objectKey: paramObjectKey({ outerKey: paramOuterKey(containerPath), table: 'FixtureNpcParam', rowId: 1000, fieldId: 'hp' }),
        outerSourceKey: paramOuterKey(containerPath),
        version: {},
        requiredFields: ['hp']
    });
    bridgeSession.close();
    // FMG/TAE/MSB 会话边界：替换凭条目读取，受体凭容器读取，未读凭据失败关闭。
    assert.deepEqual(parseTaeAddress('c1050#A0200.e0'), { chrId: 'c1050', animId: 200, eventIndex: 0 });
    assert.equal(parseTaeAddress('not-an-address'), null);
    const resSession = new CoreToolSession({ principal: 'res-agent', workspaceId: 'res-workspace' });
    const resRegistry = new ToolRegistry();
    let resWriterCalls = 0;
    for (const tool of ['mutate_fmg_entries', 'mutate_tae_event_times', 'mutate_msb_part_transform', 'batch_transform_map_objects']) {
        resRegistry.register({
            name: tool, description: 'fixture writer', permission: 'commit',
            run: () => { resWriterCalls += 1; return { ok: true, data: {} }; }
        });
    }
    const resContext = { workspaceIndex: null, mode: 'fullPermission', coreSession: resSession, session: stubSession };
    const fmgOuter = paramOuterKey(containerPath);
    for (const delivered of fmgDeliveredReads({
        principal: 'res-agent', workspaceId: 'res-workspace', outerKey: fmgOuter, table: 'Title',
        entries: [{ id: 5, sourceHash: 'f'.repeat(64), sourceRevision: 2 }]
    })) {
        resSession.proofStore.acceptDeliveredRead(delivered);
    }
    const fmgReplace = await resRegistry.run('mutate_fmg_entries', {
        table: 'Title', edits: [{ table: 'Title', id: 5, text: 'new' }], containerPath
    }, resContext);
    assert.equal(fmgReplace.ok, true);
    // 单个条目证明不能授权新增：容器级证明必须来自整表条目枚举，且覆盖 [0, entryCount)。
    const fmgAddWithoutContainer = await resRegistry.run('mutate_fmg_entries', {
        table: 'Title', edits: [{ table: 'Title', id: 9, text: 'added' }], containerPath
    }, resContext);
    assert.equal(fmgAddWithoutContainer.ok, false);
    assert.equal(fmgAddWithoutContainer.error?.code, 'NATIVE_READ_REQUIRED');
    // 只枚举一页（2/10 条）仍然不能新增：报 COVERAGE_INCOMPLETE 并点名缺哪一段。
    resSession.proofStore.acceptDeliveredRead(fmgContainerDeliveredRead({
        principal: 'res-agent', workspaceId: 'res-workspace', outerKey: fmgOuter, table: 'Title',
        sourceHash: 'f'.repeat(64),
        entryRange: { startIndex: 0, endIndex: 2, totalEntries: 10, pageSize: 2 }
    }));
    const fmgAddPartial = await resRegistry.run('mutate_fmg_entries', {
        table: 'Title', edits: [{ table: 'Title', id: 9, text: 'added' }], containerPath
    }, resContext);
    assert.equal(fmgAddPartial.ok, false);
    assert.equal(fmgAddPartial.error?.code, 'NATIVE_READ_COVERAGE_INCOMPLETE');
    assert.match(fmgAddPartial.error?.message ?? '', /缺条目索引 2–9/u);
    // 翻完全部页后放行。
    for (let offset = 2; offset < 10; offset += 2) {
        resSession.proofStore.acceptDeliveredRead(fmgContainerDeliveredRead({
            principal: 'res-agent', workspaceId: 'res-workspace', outerKey: fmgOuter, table: 'Title',
            sourceHash: 'f'.repeat(64),
            entryRange: { startIndex: offset, endIndex: Math.min(offset + 2, 10), totalEntries: 10, pageSize: 2 }
        }));
    }
    const fmgAdd = await resRegistry.run('mutate_fmg_entries', {
        table: 'Title', edits: [{ table: 'Title', id: 9, text: 'added' }], containerPath
    }, resContext);
    assert.equal(fmgAdd.ok, true);
    // 未读过的表既无条目键也无容器键。
    const fmgOtherTable = await resRegistry.run('mutate_fmg_entries', {
        table: 'Other', edits: [{ table: 'Other', id: 1, text: 'x' }], containerPath
    }, resContext);
    assert.equal(fmgOtherTable.ok, false);
    assert.equal(fmgOtherTable.error?.code, 'NATIVE_READ_REQUIRED');
    // 多表 edits 各按自带表名匹配证明。
    for (const delivered of fmgDeliveredReads({
        principal: 'res-agent', workspaceId: 'res-workspace', outerKey: fmgOuter, table: 'Second',
        entries: [{ id: 3 }]
    })) {
        resSession.proofStore.acceptDeliveredRead(delivered);
    }
    const fmgMultiTable = await resRegistry.run('mutate_fmg_entries', {
        edits: [
            { table: 'Title', id: 5, text: 'a' },
            { table: 'Second', id: 3, text: 'b' }
        ],
        containerPath
    }, resContext);
    assert.equal(fmgMultiTable.ok, true);
    // TAE：读过的时间授权，未读动画号拒绝。
    const taeOuter = paramOuterKey(containerPath);
    for (const delivered of taeDeliveredReads({
        principal: 'res-agent', workspaceId: 'res-workspace', outerKey: taeOuter, chrId: 'c1050',
        events: [{ animId: 200, eventIndex: 0, startFrame: 0, endFrame: 30 }]
    })) {
        resSession.proofStore.acceptDeliveredRead(delivered);
    }
    assert.equal(resSession.proofStore.requireCoverage({
        principal: 'res-agent', workspaceId: 'res-workspace',
        objectKey: taeObjectKey(taeOuter, 'c1050', 200, 0),
        outerSourceKey: taeOuter, version: {}, requiredFields: ['startFrame']
    }).objectKey, taeObjectKey(taeOuter, 'c1050', 200, 0));
    const taeWrite = await resRegistry.run('mutate_tae_event_times', {
        file: containerPath, edits: [{ address: 'c1050#A0200.e0', startFrame: 5 }]
    }, resContext);
    assert.equal(taeWrite.ok, true);
    const taeUnread = await resRegistry.run('mutate_tae_event_times', {
        file: containerPath, edits: [{ address: 'c1050#A0201.e0', startFrame: 5 }]
    }, resContext);
    assert.equal(taeUnread.ok, false);
    assert.equal(taeUnread.error?.code, 'NATIVE_READ_REQUIRED');
    // MSB：原生键与地址键同义；未读部件拒绝。
    const msbOuter = paramOuterKey(containerPath);
    for (const delivered of msbDeliveredReads({
        principal: 'res-agent', workspaceId: 'res-workspace', outerKey: msbOuter,
        parts: [{ address: 'm11#c1', nativeOffset: 64, posX: 1, posY: 2, posZ: 3 }]
    })) {
        resSession.proofStore.acceptDeliveredRead(delivered);
    }
    const msbWrite = await resRegistry.run('mutate_msb_part_transform', {
        file: containerPath, edits: [{ address: 'm11#c1', nativeOffset: 64, posX: 2 }]
    }, resContext);
    assert.equal(msbWrite.ok, true);
    const msbBatch = await resRegistry.run('batch_transform_map_objects', {
        file: containerPath, targets: ['m11#c1'], deltaX: 1
    }, resContext);
    assert.equal(msbBatch.ok, true);
    const msbUnread = await resRegistry.run('mutate_msb_part_transform', {
        file: containerPath, edits: [{ address: 'm11#c9', nativeOffset: 99, posX: 2 }]
    }, resContext);
    assert.equal(msbUnread.ok, false);
    assert.equal(msbUnread.error?.code, 'NATIVE_READ_REQUIRED');
    assert.equal(resSession.proofStore.requireCoverage({
        principal: 'res-agent', workspaceId: 'res-workspace',
        objectKey: msbObjectKey(msbOuter, 64),
        outerSourceKey: msbOuter, version: {}, requiredFields: ['posX']
    }).objectKey, msbObjectKey(msbOuter, 64));
    assert.equal(resSession.proofStore.requireCoverage({
        principal: 'res-agent', workspaceId: 'res-workspace',
        objectKey: msbAddressKey(msbOuter, 'm11#c1'),
        outerSourceKey: msbOuter, version: {}, requiredFields: ['posX']
    }).objectKey, msbAddressKey(msbOuter, 'm11#c1'));
    // Whole-script write proofs are assembled from the pages the caller actually received: covering
    // part of the text must not authorize a replacement, and the union of pages must.
    {
        const principal = 'script-agent';
        const workspaceId = 'script-workspace';
        const outer = paramOuterKey(containerPath);
        const key = scriptObjectKey(outer, 'goal_list.lua');
        const text = 'GOAL_COMMON_TopGoal = 0\nGOAL_COMMON_Normal = 1\n';
        const fullHash = createHash('sha256').update(text, 'utf8').digest('hex');
        const total = Buffer.byteLength(text, 'utf8');
        const page = (startByte, endByte) => ({
            principal, workspaceId, objectKey: key, outerSourceKey: outer, version: {},
            readShape: 'full-script',
            deliveredTextRange: { startByte, endByte, totalUtf8Bytes: total, fullTextHash: fullHash }
        });
        resSession.proofStore.acceptDeliveredRead(page(0, 10));
        expectProofError(() => resSession.proofStore.requireCoverage({
            principal, workspaceId, objectKey: key, outerSourceKey: outer, version: {}, requiredShape: 'full-script'
        }), 'NATIVE_READ_COVERAGE_INCOMPLETE');
        resSession.proofStore.acceptDeliveredRead(page(10, total));
        assert.equal(resSession.proofStore.requireCoverage({
            principal, workspaceId, objectKey: key, outerSourceKey: outer, version: {}, requiredShape: 'full-script'
        }).objectKey, key);
        // The write requirement must derive the same key from childPath (childChain only exists on listings).
        const requirement = buildWriteRequirement('mutate_luabnd_script', {
            file: 'script/aicommon.luabnd.dcx', childPath: 'goal_list.lua', text: 'x'
        }, outer);
        assert.equal(requirement[0]?.objectKey, key);
    }
    // One identity per target: the spelling a read reports and the spelling a write target uses must
    // resolve to the same key, otherwise "read then write" fails closed on a fresh native read.
    assert.equal(msbAddressKey(msbOuter, 'm11_02_00_00#c5400_0000'), msbAddressKey(msbOuter, 'c5400_0000'), 'MSB part address must ignore the redundant map prefix');
    assert.equal(fmgObjectKey(msbOuter, 'ItemName', 9801), fmgObjectKey(msbOuter, 'アイテム名', 9801), 'FMG table alias and native name must share one identity');
    assert.equal(fmgContainerKey(msbOuter, 'ITEMNAME'), fmgContainerKey(msbOuter, 'アイテム名'), 'FMG container identity must ignore spelling and case');
    // Diagnostics must not shred the identity they are supposed to preserve.
    const described = describeObjectKey(`fmg-container|file:///D:/games/mods/msg/engus/item.msgbnd.dcx|itemname`);
    assert.ok(!described.includes('D:/games') && !described.includes('fil<workspace>'), described);
    assert.ok(described.includes('FMG 表 itemname'), described);
    // 整脚本替换在完整源码分页落地前失败关闭（旧边界缺席时）。
    resRegistry.register({
        name: 'mutate_luabnd_script', description: 'fixture writer', permission: 'commit',
        run: () => ({ ok: true, data: {} })
    });
    const scriptClosed = await resRegistry.run('mutate_luabnd_script', {
        file: containerPath, childPath: 'a.lua', content: 'x'
    }, resContext);
    assert.equal(scriptClosed.ok, false);
    assert.equal(scriptClosed.error?.code, 'NATIVE_READ_REQUIRED');
    // commit_patch 递归展开嵌套 PARAM 变更。
    resRegistry.register({
        name: 'commit_patch', description: 'fixture writer', permission: 'commit',
        run: () => { resWriterCalls += 1; return { ok: true, data: {} }; }
    });
    for (const delivered of paramDeliveredReads({
        principal: 'res-agent', workspaceId: 'res-workspace', containerPath,
        fields: [{ table: 'T', rowId: 1, fieldId: 'f' }]
    })) {
        resSession.proofStore.acceptDeliveredRead(delivered);
    }
    const patchWrite = await resRegistry.run('commit_patch', {
        changes: [{ tool: 'mutate_param_fields', args: { edits: [{ table: 'T', rowId: 1, fieldId: 'f', value: 1 }] } }]
    }, resContext);
    assert.equal(patchWrite.ok, true);
    // 非工具形态的 proposal 没有可表达的 native read identity；生产链
    // 返回结构化 requirement-unavailable，不能回退到旧 task ledger。
    const textPatchClosed = await resRegistry.run('commit_patch', {
        changes: [{ targetUri: 'file:///x.txt', targetPath: 'x.txt', kind: 'text' }]
    }, resContext);
    assert.equal(textPatchClosed.ok, false);
    assert.equal(textPatchClosed.error?.code, 'NATIVE_READ_REQUIREMENT_UNAVAILABLE');
    resSession.close();
    // 桥接新路径：三类读取投影成功后自动记证明。
    const resBridgeRegistry = new ToolRegistry();
    resBridgeRegistry.register({
        name: 'read_fmg_entries', description: 'fixture', permission: 'read',
        run: (input) => {
            const args = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
            // Whole-table enumeration page: it states its own entry ordinal slice and the table total.
            if (args.allEntries === true) {
                return { ok: true, data: {
                        containerPath, table: 'Title', allEntries: true, sourceHash: 'f'.repeat(64), sourceRevision: 2,
                        entryCount: 10, entryOffset: 0, entryLimit: 10, entryReturned: 10, hasMore: false,
                        entries: [{ id: 5, entryIndex: 0 }, { id: 9, entryIndex: 1 }]
                    } };
            }
            return { ok: true, data: { containerPath, table: 'Title', entries: [{ id: 5 }] } };
        }
    });
    resBridgeRegistry.register({
        name: 'read_tae_events', description: 'fixture', permission: 'read',
        run: () => ({
            ok: true,
            data: { filePath: containerPath, chrId: 'c1050', events: [
                    { animId: 200, eventIndex: 0, startFrame: 0, endFrame: 1 },
                    // projection "compact": identity only as the exact address, which must agree with index.
                    { index: 1, address: 'c1050#A0200.e1', eventTypeId: 1, startFrame: 2, endFrame: 3, fields: [{ name: 'Distance', value: 4 }] },
                    { index: 5, address: 'c1050#A0200.e2', eventTypeId: 1, startFrame: 2, endFrame: 3 }
                ] }
        })
    });
    resBridgeRegistry.register({
        name: 'read_msb_parts', description: 'fixture', permission: 'read',
        run: () => ({ ok: true, data: { filePath: containerPath, parts: [{ address: 'm11#c1', nativeOffset: 64, posX: 1 }] } })
    });
    const resBridgeSession = new CoreToolSession({ principal: 'resb-agent', workspaceId: 'resb-workspace' });
    const resBridge = createAgentToolBridge({
        registry: resBridgeRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: resBridgeSession }
    });
    assert.equal((await resBridge.executeTool({ id: 'r1', name: 'read_fmg_entries', argumentsJson: '{}' })).ok, true);
    assert.equal((await resBridge.executeTool({ id: 'r1b', name: 'read_fmg_entries', argumentsJson: '{"allEntries":true}' })).ok, true);
    assert.equal((await resBridge.executeTool({ id: 'r2', name: 'read_tae_events', argumentsJson: '{}' })).ok, true);
    assert.equal((await resBridge.executeTool({ id: 'r3', name: 'read_msb_parts', argumentsJson: '{}' })).ok, true);
    resBridgeSession.proofStore.requireCoverage({
        principal: 'resb-agent', workspaceId: 'resb-workspace',
        objectKey: fmgObjectKey(paramOuterKey(containerPath), 'Title', 5),
        outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['text']
    });
    resBridgeSession.proofStore.requireCoverage({
        principal: 'resb-agent', workspaceId: 'resb-workspace',
        objectKey: msbObjectKey(paramOuterKey(containerPath), 64),
        outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['posX']
    });
    for (const [eventIndex, requiredFields] of [[0, ['startFrame']], [1, ['startFrame', 'endFrame', 'eventTypeId', 'Distance']]]) {
        resBridgeSession.proofStore.requireCoverage({
            principal: 'resb-agent', workspaceId: 'resb-workspace',
            objectKey: taeObjectKey(paramOuterKey(containerPath), 'c1050', 200, eventIndex),
            outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: [...requiredFields]
        });
    }
    for (const eventIndex of [2, 5]) {
        assert.throws(() => resBridgeSession.proofStore.requireCoverage({
            principal: 'resb-agent', workspaceId: 'resb-workspace',
            objectKey: taeObjectKey(paramOuterKey(containerPath), 'c1050', 200, eventIndex),
            outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['startFrame']
        }), ProofError, `a compact event whose index disagrees with its address proves neither e${eventIndex}`);
    }
    resBridgeSession.proofStore.requireCoverage({
        principal: 'resb-agent', workspaceId: 'resb-workspace',
        objectKey: fmgContainerKey(paramOuterKey(containerPath), 'Title'),
        outerSourceKey: paramOuterKey(containerPath), version: { childHash: 'f'.repeat(64) }, requiredFields: [],
        requiredItemSet: true
    });
    // 桥接成功读取即注册外部监听：外部改写该容器后，刚铸造的证明自动失效。
    await writeFile(containerPath, Buffer.from([0x44, 0x43, 0x58, 0x00, 0x01, 0x02, 0x03, 0x04]));
    let bridgeProofDead = false;
    for (let attempt = 0; attempt < 100 && !bridgeProofDead; attempt += 1) {
        try {
            resBridgeSession.proofStore.requireCoverage({
                principal: 'resb-agent', workspaceId: 'resb-workspace',
                objectKey: fmgObjectKey(paramOuterKey(containerPath), 'Title', 5),
                outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['text']
            });
        }
        catch {
            bridgeProofDead = true;
        }
        if (!bridgeProofDead)
            await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(bridgeProofDead, true, '桥接读取的外层文件被外部改写后证明必须失效');
    // 截断页不铸造：超预算读取的条目证明缺席，写入被拒而非误授信。
    const bigBridgeRegistry = new ToolRegistry();
    bigBridgeRegistry.register({
        name: 'read_fmg_entries', description: 'fixture', permission: 'read',
        run: () => ({
            ok: true,
            data: {
                containerPath,
                table: 'Big',
                // Keep the projection above the current 64 KiB Agent envelope cap.
                entries: Array.from({ length: 300 }, (_, index) => ({ id: index, text: 'x'.repeat(300) }))
            }
        })
    });
    const bigBridgeSession = new CoreToolSession({ principal: 'big-agent', workspaceId: 'big-workspace' });
    const bigBridge = createAgentToolBridge({
        registry: bigBridgeRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: bigBridgeSession }
    });
    const bigRead = await bigBridge.executeTool({ id: 'big-1', name: 'read_fmg_entries', argumentsJson: '{}' });
    assert.equal(bigRead.ok, false);
    assert.equal(bigRead.code, 'RESULT_TEXT_WINDOW_TOO_LARGE');
    assert.throws(() => bigBridgeSession.proofStore.requireCoverage({
        principal: 'big-agent', workspaceId: 'big-workspace',
        objectKey: fmgObjectKey(paramOuterKey(containerPath), 'Big', 0),
        outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['text']
    }), /no delivered read|NATIVE_READ_REQUIRED/);
    bigBridgeSession.close();
    // A page can fit the Agent envelope while still carrying an explicitly
    // incomplete native text window.  The nested completeness flag must keep
    // the FMG write proof closed; envelope size alone is not a full read.
    const partialFmgRegistry = new ToolRegistry();
    partialFmgRegistry.register({
        name: 'read_fmg_entries', description: 'partial FMG fixture', permission: 'read',
        run: () => ({ ok: true, data: {
                containerPath, table: 'Partial', sourceHash: 'p'.repeat(64), sourceRevision: 2,
                offset: 0, limit: 120, total: 500, returned: 120, truncated: true,
                sourceTextComplete: false,
                entries: [{ id: 7, text: 'partial native text window', sourceTextComplete: false }]
            } })
    });
    const partialFmgSession = new CoreToolSession({ principal: 'partial-fmg-agent', workspaceId: 'partial-fmg-workspace' });
    const partialFmgBridge = createAgentToolBridge({
        registry: partialFmgRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: partialFmgSession }
    });
    const partialFmgRead = await partialFmgBridge.executeTool({ id: 'partial-fmg', name: 'read_fmg_entries', argumentsJson: '{}' });
    assert.equal(partialFmgRead.ok, true, partialFmgRead.content);
    assert.throws(() => partialFmgSession.proofStore.requireCoverage({
        principal: 'partial-fmg-agent', workspaceId: 'partial-fmg-workspace',
        objectKey: fmgObjectKey(paramOuterKey(containerPath), 'Partial', 7),
        outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['text']
    }), /no delivered read|NATIVE_READ_REQUIRED/);
    partialFmgSession.close();
    // A byte-bounded page is a batch window, not a text window: every delivered entry
    // carries its whole text, so paging a 400-id read must still authorize a write to
    // the entries that page actually delivered (and only those).
    const pagedFmgRegistry = new ToolRegistry();
    pagedFmgRegistry.register({
        name: 'read_fmg_entries', description: 'paged FMG fixture', permission: 'read',
        run: () => ({ ok: true, data: {
                containerPath, table: 'Paged', sourceHash: 'q'.repeat(64), sourceRevision: 3,
                offset: 0, returnedCount: 2, totalCount: 5, remainingCount: 3, hasMore: true,
                truncated: true, nextOffset: 2,
                pagination: { offset: 0, limit: 2, returnedCount: 2, totalCount: 5, remainingCount: 3, hasMore: true, nextOffset: 2 },
                entries: [{ id: 11, text: 'first page entry' }, { id: 12, text: 'second page entry' }]
            } })
    });
    const pagedFmgSession = new CoreToolSession({ principal: 'paged-fmg-agent', workspaceId: 'paged-fmg-workspace' });
    const pagedFmgBridge = createAgentToolBridge({
        registry: pagedFmgRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: pagedFmgSession }
    });
    const pagedFmgRead = await pagedFmgBridge.executeTool({ id: 'paged-fmg', name: 'read_fmg_entries', argumentsJson: '{}' });
    assert.equal(pagedFmgRead.ok, true, pagedFmgRead.content);
    for (const id of [11, 12]) {
        pagedFmgSession.proofStore.requireCoverage({
            principal: 'paged-fmg-agent', workspaceId: 'paged-fmg-workspace',
            objectKey: fmgObjectKey(paramOuterKey(containerPath), 'Paged', id),
            outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['text']
        });
    }
    assert.throws(() => pagedFmgSession.proofStore.requireCoverage({
        principal: 'paged-fmg-agent', workspaceId: 'paged-fmg-workspace',
        objectKey: fmgObjectKey(paramOuterKey(containerPath), 'Paged', 13),
        outerSourceKey: paramOuterKey(containerPath), version: {}, requiredFields: ['text']
    }), /no delivered read|NATIVE_READ_REQUIRED/);
    pagedFmgSession.close();
    // PARAM 整表行集：桥接器按 allRows 页记录物理行索引区间（含全表行数），单页不能授权新建行；
    // 页并集覆盖 [0, rowCount) 后才放行。
    const paramPageRegistry = new ToolRegistry();
    const paramPages = [
        { offset: 0, returned: 128, total: 256 },
        { offset: 128, returned: 128, total: 256 }
    ];
    let paramPageIndex = 0;
    paramPageRegistry.register({
        name: 'read_param_fields', description: 'paged PARAM row-set fixture', permission: 'read',
        run: () => {
            const page = paramPages[Math.min(paramPageIndex, paramPages.length - 1)];
            paramPageIndex += 1;
            const covered = page.offset + page.returned;
            const hasMore = covered < page.total;
            return { ok: true, data: {
                    allRows: true, containerPath, table: 'NpcParam', sourceHash: 'p'.repeat(64), sourceRevision: 2,
                    rowCount: page.total, rowOffset: page.offset, rowLimit: 128, rowReturned: page.returned,
                    hasMore, ...(hasMore ? { nextOffset: covered } : {}),
                    rows: [{ rowIndex: page.offset, rowId: 1 }],
                    pagination: { offset: page.offset, returnedCount: page.returned, totalCount: page.total, hasMore }
                } };
        }
    });
    const paramPageSession = new CoreToolSession({ principal: 'param-page-agent', workspaceId: 'param-page-workspace' });
    const paramPageBridge = createAgentToolBridge({
        registry: paramPageRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: paramPageSession }
    });
    const requireParamTableSet = () => paramPageSession.proofStore.requireCoverage({
        principal: 'param-page-agent', workspaceId: 'param-page-workspace',
        objectKey: paramTableObjectKey({ outerKey: paramOuterKey(containerPath), table: 'NpcParam' }),
        outerSourceKey: paramOuterKey(containerPath),
        version: { childHash: 'p'.repeat(64) }, requiredFields: [], requiredItemSet: true
    });
    const firstParamPage = await paramPageBridge.executeTool({ id: 'param-page-1', name: 'read_param_fields', argumentsJson: '{"allRows":true}' });
    assert.equal(firstParamPage.ok, true, firstParamPage.content);
    assert.throws(requireParamTableSet, (error) => {
        assert.equal(error.code, 'NATIVE_READ_COVERAGE_INCOMPLETE');
        assert.match(error.message, /缺行索引 128–255/u);
        return true;
    }, 'one PARAM row page must not authorize creation');
    const secondParamPage = await paramPageBridge.executeTool({ id: 'param-page-2', name: 'read_param_fields', argumentsJson: '{"allRows":true}' });
    assert.equal(secondParamPage.ok, true, secondParamPage.content);
    requireParamTableSet();
    paramPageSession.close();
    // 分页读取 luabnd 脚本不得关掉写入授权：每一页都带着自己的字节区间与全文哈希，
    // 证明库按页合并；只有一页时仍缺覆盖（写入被拒），页并集覆盖全文后才放行。
    const pagedScriptRegistry = new ToolRegistry();
    const pagedScriptPages = [
        { startByte: 0, endByte: 5, text: 'hello' },
        { startByte: 5, endByte: 10, text: 'world' }
    ];
    let pagedScriptPageIndex = 0;
    const pagedScriptHash = createHash('sha256').update('helloworld', 'utf8').digest('hex');
    pagedScriptRegistry.register({
        name: 'read_luabnd_script', description: 'paged luabnd fixture', permission: 'read',
        run: () => {
            const page = pagedScriptPages[Math.min(pagedScriptPageIndex, pagedScriptPages.length - 1)];
            pagedScriptPageIndex += 1;
            const complete = page.endByte >= 10;
            return { ok: true, data: {
                    containerPath, sourceUri: 'file://script/paged.luabnd.dcx', childPath: 'paged.lua',
                    script: { sanitizedName: 'paged.lua', representation: 'plaintext', sourceHash: 's'.repeat(64) },
                    sourceText: page.text, offset: page.startByte, limit: 5, returned: page.text.length,
                    returnedCount: page.text.length, total: 10, totalCount: 10,
                    truncated: !complete, hasMore: !complete, sourceTextComplete: complete,
                    pageStartByte: page.startByte, pageEndByte: page.endByte, fullUtf8Bytes: 10,
                    fullTextHash: pagedScriptHash,
                    ...(complete ? {} : { nextCursor: 'paged-script-cursor' })
                } };
        }
    });
    const pagedScriptSession = new CoreToolSession({ principal: 'paged-script-agent', workspaceId: 'paged-script-workspace' });
    const pagedScriptBridge = createAgentToolBridge({
        registry: pagedScriptRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: pagedScriptSession }
    });
    const pagedScriptKey = scriptObjectKey(paramOuterKey(containerPath), 'paged.lua');
    const pagedScriptRead = await pagedScriptBridge.executeTool({ id: 'paged-script-1', name: 'read_luabnd_script', argumentsJson: '{}' });
    assert.equal(pagedScriptRead.ok, true, pagedScriptRead.content);
    assert.throws(() => pagedScriptSession.proofStore.requireCoverage({
        principal: 'paged-script-agent', workspaceId: 'paged-script-workspace',
        objectKey: pagedScriptKey, outerSourceKey: paramOuterKey(containerPath),
        version: {}, requiredShape: 'full-script'
    }), (error) => error.code === 'NATIVE_READ_COVERAGE_INCOMPLETE', 'a single script page must not authorize a whole-script replacement');
    const pagedScriptRead2 = await pagedScriptBridge.executeTool({ id: 'paged-script-2', name: 'read_luabnd_script', argumentsJson: '{}' });
    assert.equal(pagedScriptRead2.ok, true, pagedScriptRead2.content);
    pagedScriptSession.proofStore.requireCoverage({
        principal: 'paged-script-agent', workspaceId: 'paged-script-workspace',
        objectKey: pagedScriptKey, outerSourceKey: paramOuterKey(containerPath),
        version: {}, requiredShape: 'full-script'
    });
    pagedScriptSession.close();
    // EMEVD outline 与脚本页同理：一页只交一页，桥接器必须记录这一页覆盖的事件索引区间。
    // 翻完全部页（页并集覆盖 [0,total)）才等于一次读完；只读一页不能授权 createIfMissing。
    const outlineSourceUri = 'file://event/paged-outline.emevd.dcx';
    const outlinePages = [
        { offset: 0, returned: 256, total: 1744 },
        { offset: 256, returned: 256, total: 1744 },
        { offset: 512, returned: 256, total: 1744 },
        { offset: 768, returned: 256, total: 1744 },
        { offset: 1024, returned: 256, total: 1744 },
        { offset: 1280, returned: 256, total: 1744 },
        { offset: 1536, returned: 208, total: 1744 }
    ];
    let outlinePageIndex = 0;
    const outlineRegistry = new ToolRegistry();
    outlineRegistry.register({
        name: 'read_emevd_outline', description: 'paged EMEVD outline fixture', permission: 'read',
        run: () => {
            const page = outlinePages[Math.min(outlinePageIndex, outlinePages.length - 1)];
            outlinePageIndex += 1;
            const hasMore = page.offset + page.returned < page.total;
            return { ok: true, data: {
                    sourceUri: outlineSourceUri, canonical: true,
                    sourceHash: 'e'.repeat(64), outerFileHash: 'o'.repeat(64), sourceRevision: 1,
                    filePath: containerPath,
                    events: Array.from({ length: page.returned }, (_, index) => ({ eventId: page.offset + index })),
                    offset: page.offset, limit: 256, returned: page.returned,
                    total: page.total, totalCount: page.total, hasMore,
                    truncated: hasMore, darkScriptComplete: false,
                    ...(hasMore ? { nextOffset: page.offset + page.returned } : {})
                } };
        }
    });
    const outlineSession = new CoreToolSession({ principal: 'outline-agent', workspaceId: 'outline-workspace' });
    const outlineBridge = createAgentToolBridge({
        registry: outlineRegistry,
        context: { workspaceIndex: null, mode: 'plan', coreSession: outlineSession }
    });
    const outlineKey = emevdFileObjectKey(outlineSourceUri);
    const requireOutlineSet = () => outlineSession.proofStore.requireCoverage({
        principal: 'outline-agent', workspaceId: 'outline-workspace',
        objectKey: outlineKey, outerSourceKey: outlineSourceUri,
        version: {}, requiredFields: ['event-set'], requiredItemSet: true
    });
    const firstOutlinePage = await outlineBridge.executeTool({ id: 'outline-1', name: 'read_emevd_outline', argumentsJson: '{}' });
    assert.equal(firstOutlinePage.ok, true, firstOutlinePage.content);
    assert.throws(requireOutlineSet, (error) => error.code === 'NATIVE_READ_COVERAGE_INCOMPLETE', 'one outline page must not authorize creation');
    for (let index = 1; index < outlinePages.length; index += 1) {
        const pageRead = await outlineBridge.executeTool({ id: `outline-${String(index + 1)}`, name: 'read_emevd_outline', argumentsJson: '{}' });
        assert.equal(pageRead.ok, true, pageRead.content);
    }
    requireOutlineSet();
    outlineSession.close();
    resBridgeSession.close();
    // 提交成功即失效：changedSources 覆盖的证明不可复用，无关证明保留；
    // 复核失败仍已提交，失效同样发布。
    const invSession = new CoreToolSession({ principal: 'inv-agent', workspaceId: 'inv-workspace' });
    for (const delivered of paramDeliveredReads({
        principal: 'inv-agent', workspaceId: 'inv-workspace', containerPath,
        fields: [
            { table: 'T', rowId: 1, fieldId: 'f' },
            { table: 'T', rowId: 2, fieldId: 'f' }
        ]
    })) {
        invSession.proofStore.acceptDeliveredRead(delivered);
    }
    const invContext = { workspaceIndex: null, mode: 'plan', coreSession: invSession };
    const committed = await finalizeCommittedToolResult({ data: {}, changedSources: [containerPath], context: invContext });
    assert.equal(committed.ok, true);
    assert.equal(committed.state, 'committed');
    const rowKey = (rowId) => paramObjectKey({ outerKey: paramOuterKey(containerPath), table: 'T', rowId, fieldId: 'f' });
    const cover = (rowId) => invSession.proofStore.requireCoverage({
        principal: 'inv-agent', workspaceId: 'inv-workspace',
        objectKey: rowKey(rowId), outerSourceKey: paramOuterKey(containerPath),
        version: {}, requiredFields: ['f']
    });
    // finalize 失效整外层：两条证明都变成「读过但对象变了」（STALE），而不是「没读过」。
    for (const rowId of [1, 2]) {
        assert.throws(() => cover(rowId), (error) => {
            assert.equal(error.code, 'NATIVE_READ_STALE');
            assert.match(String(error.message), /重新读取这个目标后立即写入/u);
            return true;
        });
    }
    for (const delivered of paramDeliveredReads({
        principal: 'inv-agent', workspaceId: 'inv-workspace', containerPath,
        fields: [{ table: 'T', rowId: 3, fieldId: 'f' }]
    })) {
        invSession.proofStore.acceptDeliveredRead(delivered);
    }
    const failed = await finalizeCommittedToolResult({
        data: {},
        changedSources: ['file:///elsewhere/other.parambnd.dcx'],
        context: invContext,
        verifyNative: async () => ({ ok: false, code: 'NATIVE_VERIFY_FAILED', message: '复核失败' })
    });
    assert.equal(failed.state, 'verification_failed');
    // 复核失败不丢失 committed 事务，且无关来源证明保留。
    assert.equal(cover(3).coveredFields.length, 1);
    invSession.close();
    await rm(overlayRoot, { recursive: true, force: true });
    store.dispose();
    store.dispose();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    runNativeReadProofSmoke().then(() => {
        console.log('Native read proof smoke passed.');
    }).catch((error) => {
        console.error(error);
        process.exitCode = 1;
    });
}
//# sourceMappingURL=runNativeReadProofSmoke.js.map