import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createOpaqueCursor, parseOpaqueCursor } from '@soulforge/shared';
import { expandParamFieldQuery } from '../param/containerParamEdit.js';
import { paramContainerRecoveryUri, paramReadCoverage, paramReadSourceHash, paramReadWindow } from '../param/paramReadWindow.js';
import { createReadParamFieldsTool } from '../ai/tools/read_param_fields.js';
const fixtureRoot = join(tmpdir(), 'soulforge-param-read-window-fixture');
const overlayRoot = join(fixtureRoot, 'mods');
assert.equal(paramContainerRecoveryUri(overlayRoot, join(overlayRoot, 'param', 'gameparam', 'gameparam.parambnd.dcx')), 'file://param/gameparam/gameparam.parambnd.dcx');
assert.equal(paramContainerRecoveryUri(overlayRoot, join(fixtureRoot, 'outside', 'gameparam.parambnd.dcx')), undefined);
assert.equal(paramContainerRecoveryUri(overlayRoot, join(fixtureRoot, 'mods-other', 'gameparam.parambnd.dcx')), undefined);
assert.ok(expandParamFieldQuery('ninsatsuNum').includes('ninsatu'), 'near-name recovery must surface the trusted field ID spelling');
assert.deepEqual(paramReadCoverage({ missingRows: 0, missingFields: 0, hasMore: false }), {
    complete: true, status: 'complete'
});
for (const incomplete of [
    { missingRows: 1, missingFields: 0, hasMore: false },
    { missingRows: 0, missingFields: 1, hasMore: false },
    { missingRows: 0, missingFields: 0, hasMore: true }
]) {
    assert.deepEqual(paramReadCoverage(incomplete), { complete: false, status: 'partial' });
}
const cells = Array.from({ length: 20 }, (_, index) => ({ table: 'SpEffectParam', fieldId: `field${index}` }));
const versions = [{ table: 'A', entryIndex: 1, sourceHash: 'a' }, { table: 'B', entryIndex: 2, sourceHash: 'b' }];
assert.notEqual(paramReadSourceHash(versions), paramReadSourceHash(versions.map((v) => ({ ...v, sourceHash: v.sourceHash === 'a' ? 'b' : 'a' }))));
assert.equal(paramReadSourceHash(versions), paramReadSourceHash([...versions].reverse()));
assert.equal(paramReadSourceHash([versions[0]]), 'a');
assert.throws(() => paramReadSourceHash([versions[0], { ...versions[0], sourceHash: 'other' }]), { code: 'PARAM_SOURCE_CHANGED_DURING_READ' });
const definitions = new Map(cells.map((cell) => [`${cell.table}\0${cell.fieldId}`, { fieldId: cell.fieldId, description: 'full metadata'.repeat(20) }]));
const legacyScope = `param-fields:file:///C:/private/container:workspace:${'long-field-scope'.repeat(1000)}`;
const input = { cells, definitions, legacyScope, sourceHash: 'a'.repeat(64), pageSize: 4,
    cellIdentity: (cell) => [cell.table, cell.fieldId] };
let page = paramReadWindow(input);
assert.equal(page.items.length, 4);
assert.equal(page.fieldDefinitions.length, 4);
assert.ok(page.nextCursor && page.nextCursor.length < 400);
assert.ok(!page.queryScope.includes('private'));
const cursor = page.nextCursor;
const delivered = [...page.items];
while (page.nextCursor) {
    page = paramReadWindow({ ...input, cursor: page.nextCursor });
    assert.deepEqual(page.fieldDefinitions.map((d) => d.fieldId), page.items.map((i) => i.fieldId));
    delivered.push(...page.items);
}
assert.deepEqual(delivered, cells);
assert.throws(() => paramReadWindow({ ...input, cursor, sourceHash: 'b'.repeat(64) }), { code: 'STALE_READ_CURSOR' });
assert.throws(() => paramReadWindow({ ...input, cursor, legacyScope: legacyScope + 'other-workspace' }), { code: 'PARAM_CURSOR_SCOPE_MISMATCH' });
assert.throws(() => paramReadWindow({ ...input, cursor, cells: [...cells].reverse() }), { code: 'PARAM_CURSOR_SCOPE_MISMATCH' });
assert.equal(paramReadWindow({ ...input, cursor, pageSize: 1 }).items[0]?.fieldId, 'field4');
const legacy = createOpaqueCursor({ sessionId: 'old-process-session', domain: 'param', sourceHash: input.sourceHash, scope: legacyScope, offset: 4 });
const migrated = paramReadWindow({ ...input, cursor: legacy });
assert.equal(migrated.offset, 4);
assert.ok(migrated.nextCursor && migrated.nextCursor.length < 400);
assert.equal(parseOpaqueCursor(migrated.nextCursor).sessionId, 'param-fields-v2');
// P0 regression (H3): read_param_fields declared `offset`, describe published it, and the tool forwarded
// it — but this pager never read it, so offset=32 re-served page 1 and pagination.offset stayed 0. Two
// windows looked like eleven pages of distinct data. These cases pin offset as a second spelling of the
// same window: it must select the cells the cursor for that position selects, or refuse by name.
const offsetSecondPage = paramReadWindow({ ...input, offset: 4 });
const cursorSecondPage = paramReadWindow({ ...input, cursor });
assert.notDeepEqual(offsetSecondPage.items, paramReadWindow(input).items, 'offset 非零时必须与第一页不同；这正是修复前失败的那条');
assert.equal(offsetSecondPage.offset, 4);
assert.deepEqual(offsetSecondPage.items, cursorSecondPage.items, 'offset 与同一位置的 cursor 必须交付同一批字段格');
assert.equal(offsetSecondPage.nextCursor, cursorSecondPage.nextCursor);
assert.equal(offsetSecondPage.queryScope, cursorSecondPage.queryScope);
assert.equal(paramReadWindow({ ...input, offset: 8 }).items[0]?.fieldId, 'field8');
assert.equal(paramReadWindow({ ...input, offset: 0 }).items[0]?.fieldId, 'field0');
const offsetTail = paramReadWindow({ ...input, offset: 16 });
assert.equal(offsetTail.items.length, 4);
assert.equal(offsetTail.nextCursor, null);
// A contradictory window has no honest meaning; serving one of the two silently is the bug itself.
assert.throws(() => paramReadWindow({ ...input, cursor, offset: 4 }), { code: 'INVALID_INPUT' });
assert.throws(() => paramReadWindow({ ...input, offset: -1 }), { code: 'INVALID_INPUT' });
assert.throws(() => paramReadWindow({ ...input, offset: 1.5 }), { code: 'INVALID_INPUT' });
// An offset past the collection is a refusal, not an empty page: "no data" must not read as "read is over".
assert.throws(() => paramReadWindow({ ...input, offset: cells.length + 1 }), { code: 'PARAM_OFFSET_OUT_OF_RANGE' });
assert.equal(paramReadWindow({ ...input, offset: cells.length }).items.length, 0);
// The tool boundary is where the value was dropped before reaching the pager. Both checks run before the
// edit session is required, so they are testable without native state.
const readParamFieldsTool = createReadParamFieldsTool();
const bothWindows = await readParamFieldsTool.run({ table: 'NpcParam', rowIds: [1], fieldIds: ['hp'], cursor: 'sf_cur_placeholder', offset: 4 }, {});
assert.equal(bothWindows.ok, false);
assert.equal(bothWindows.error?.code, 'INVALID_INPUT');
assert.match(bothWindows.error?.message ?? '', /cursor.*offset/u);
const negativeOffset = await readParamFieldsTool.run({ table: 'NpcParam', rowIds: [1], fieldIds: ['hp'], offset: -4 }, {});
assert.equal(negativeOffset.ok, false);
assert.equal(negativeOffset.error?.code, 'INVALID_INPUT');
// describe promises what the pager now does: offset documented, and both spellings named.
assert.match(readParamFieldsTool.description, /offset is a zero-based index/u);
assert.match(readParamFieldsTool.description, /Pass offset or cursor, never both/u);
console.log('PARAM bounded cursor and per-page definitions smoke passed.');
//# sourceMappingURL=runParamReadWindowSmoke.js.map