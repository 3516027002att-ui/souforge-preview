'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { copyFileSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const { pathToFileURL } = require('node:url');

const bundle = path.resolve(__dirname, '..');
const env = { ...process.env };
const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'PATH';
env[pathKey] = [path.dirname(process.execPath), env[pathKey]].filter(Boolean).join(path.delimiter);
for (const key of ['SOULFORGE_WORKSPACE', 'SOULFORGE_SEKIRO_MOD_ROOT', 'SOULFORGE_SEKIRO_ROOT']) {
  delete env[key];
}

function spawnCli(args, options = {}) {
  const child = spawnSync(env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `bin\\sfcli.cmd ${args}`], {
    cwd: bundle, env, encoding: 'utf8', windowsVerbatimArguments: true, timeout: 30_000, ...options
  });
  if (child.error) throw child.error;
  return child;
}

function scratchFor(t) {
  const parent = realpathSync(tmpdir());
  const scratch = mkdtempSync(path.join(parent, 'soulforge-bundle-test-'));
  t.after(() => {
    const resolved = realpathSync(scratch);
    if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith('soulforge-bundle-test-')) {
      throw new Error('Refusing to remove a path outside the temporary test directory.');
    }
    rmSync(resolved, { recursive: true });
  });
  return scratch;
}

test('绑定接受游戏里的 Mod 目录并解析 Junction，不把 .git 索引为游戏资源', (t) => {
  const scratch = scratchFor(t);
  const base = path.join(scratch, 'Sekiro');
  const mods = path.join(base, 'mods');
  const alias = path.join(scratch, 'Mod loaded');
  mkdirSync(path.join(mods, '.git'), { recursive: true });
  writeFileSync(path.join(base, 'sekiro.exe'), '');
  writeFileSync(path.join(base, 'oo2core_6_win64.dll'), '');
  writeFileSync(path.join(mods, '.git', 'checkpoint.txt'), 'Git metadata is not a game asset.');
  writeFileSync(path.join(mods, 'readme.txt'), 'Mod resource fixture.');
  symlinkSync(mods, alias, 'junction');

  const report = spawnCli(`--workspace "${alias}" --base "${base}" --json preflight`);
  assert.equal(report.status, 0, report.stdout + report.stderr);
  assert.equal(JSON.parse(report.stdout).workspace, realpathSync.native(mods));
  assert.equal(spawnCli(`--workspace "${mods}" --base "${base}" --json preflight`).status, 0);
  const res = spawnCli(`--workspace "${alias}" --base "${base}" --mode plan --no-analyze --json --quiet call --stdin workspace_stats`, {
    env: { ...env, SF_E2E_WORKSPACE_STORAGE_ROOT: path.join(scratch, 'storage') }, input: '{}\n'
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).data.record.files, 1);
});

test('预检和真正打开会话都拒绝把原版资源目录或游戏的父目录当 Mod', (t) => {
  const scratch = scratchFor(t);
  const base = path.join(scratch, 'Sekiro');
  const param = path.join(base, 'param');
  const alias = path.join(scratch, 'Not named param');
  const storage = path.join(scratch, 'storage');
  mkdirSync(param, { recursive: true });
  writeFileSync(path.join(base, 'sekiro.exe'), '');
  writeFileSync(path.join(base, 'oo2core_6_win64.dll'), '');
  symlinkSync(param, alias, 'junction');
  for (const [workspace, code] of [[base, 'WORKSPACE_EQUALS_BASE'], [scratch, 'BASE_INSIDE_WORKSPACE'], [alias, 'WORKSPACE_IS_BASE_RESOURCE']]) {
    const flags = `--workspace "${workspace}" --base "${base}"`;
    const report = spawnCli(`${flags} --json preflight`);
    assert.equal(report.status, 2, report.stdout + report.stderr);
    assert.ok(JSON.parse(report.stdout).findings.some((finding) => finding.code === code));
    const res = spawnCli(`${flags} --mode normal --no-analyze --json --quiet call --stdin workspace_stats`, {
      env: { ...env, SF_E2E_WORKSPACE_STORAGE_ROOT: storage }, input: '{}\n'
    });
    assert.equal(res.status, 2);
    assert.ok(res.stderr.includes(code), res.stderr);
  }
  // Omission of --base must not allow a known original resource directory to be opened for writes.
  const res = spawnCli(`--workspace "${alias}" --mode normal --json --quiet call --stdin workspace_stats`, {
    env: { ...env, SF_E2E_WORKSPACE_STORAGE_ROOT: storage }, input: '{}\n'
  });
  assert.equal(res.status, 2);
  assert.ok(res.stderr.includes('WORKSPACE_IS_BASE_RESOURCE'), res.stderr);
});

test('嵌套 Mod 路径映射到原版同名文件，原版读不落回 Mod 或目录外', async (t) => {
  const scratch = scratchFor(t);
  const baseRoot = path.join(scratch, 'Sekiro');
  const mods = path.join(baseRoot, 'mods');
  const alias = path.join(scratch, 'Mod link');
  const outside = path.join(scratch, 'outside');
  const relative = 'param/sample.parambnd.dcx';
  const original = path.join(baseRoot, relative);
  const modified = path.join(mods, relative);
  for (const dir of [path.dirname(original), path.dirname(modified), outside]) mkdirSync(dir, { recursive: true });
  writeFileSync(original, 'original bytes');
  writeFileSync(modified, 'mod bytes');
  writeFileSync(path.join(mods, 'param', 'mod-only.parambnd.dcx'), 'no original counterpart');
  writeFileSync(path.join(outside, 'escape.parambnd.dcx'), 'outside bytes');
  symlinkSync(mods, alias, 'junction');
  symlinkSync(mods, path.join(baseRoot, 'mod-alias'), 'junction');
  symlinkSync(outside, path.join(baseRoot, 'outside-alias'), 'junction');

  const { openWorkspaceSession } = await import('../packages/core/dist/workspace/workspaceSession.js');
  const { resolveBaseOriginFile } = await import('../packages/core/dist/ai/readOrigin.js');
  for (const overlayRoot of [mods, alias]) {
    const session = await openWorkspaceSession({ overlayRoot, baseRoot, game: 'sekiro' });
    for (const token of [relative, modified, pathToFileURL(modified).href, path.join(overlayRoot, relative)]) {
      const found = await resolveBaseOriginFile({ session }, token);
      assert.equal(found.ok, true, JSON.stringify(found));
      assert.equal(found.sourceUri, 'base://' + relative);
      assert.equal(readFileSync(found.path, 'utf8'), 'original bytes');
    }
    const missing = await resolveBaseOriginFile({ session }, path.join(mods, 'param', 'mod-only.parambnd.dcx'));
    assert.equal(missing.code, 'BASE_FILE_MISSING');
    for (const token of ['base://mods/' + relative, 'mod-alias/' + relative, 'outside-alias/escape.parambnd.dcx']) {
      const refused = await resolveBaseOriginFile({ session }, token);
      assert.equal(refused.ok, false, token);
      assert.equal(refused.code, 'BASE_ORIGIN_PATH_INVALID');
      assert.equal(refused.sourceUri, undefined);
    }
  }
});

test('安装无需游戏路径，持久日志所需的 SQLite 可以实际打开', (t) => {
  const listed = spawnCli('--json list');
  assert.equal(listed.status, 0, listed.stderr);
  const catalog = JSON.parse(listed.stdout);
  assert.equal(catalog.ok, true);
  assert.ok(catalog.data.record.names.includes('read_param_fields'));

  const scratch = scratchFor(t);
  const workspace = path.join(scratch, 'Mod copy');
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, 'readme.txt'), 'Synthetic bundle test.');
  const res = spawnCli(`--workspace "${workspace}" --mode plan --no-analyze --json --quiet --diagnostics call --stdin workspace_stats`, {
    env: { ...env, SF_E2E_WORKSPACE_STORAGE_ROOT: path.join(scratch, 'storage') }, input: '{}\n'
  });
  assert.equal(res.status, 0, res.stderr);
  assert.equal(JSON.parse(res.stdout).ok, true);
  const audit = res.stderr.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
    .find((event) => event.phase === 'storage.audit');
  assert.equal(audit?.details.durableLog, true, audit?.details.message);
});

test('缺失随包 SQLite 时，启动器拒绝列出工具而非报告安装成功', (t) => {
  const scratch = scratchFor(t);
  mkdirSync(path.join(scratch, 'bin'));
  for (const file of ['sfcli.cmd', 'require-node.cjs']) {
    copyFileSync(path.join(bundle, 'bin', file), path.join(scratch, 'bin', file));
  }
  const result = spawnCli('--json list', { cwd: scratch });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /SQLITE_BINDING_UNAVAILABLE/);
  assert.equal(result.stdout, '');
});

test('整个分发包只有一个可注册的 Skill 入口', () => {
  const entries = [];
  function findSkills(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory() && !['.git', 'node_modules'].includes(entry.name)) {
        findSkills(path.join(dir, entry.name));
      } else if (entry.isFile() && entry.name.toLowerCase() === 'skill.md') {
        entries.push(path.relative(bundle, path.join(dir, entry.name)));
      }
    }
  }
  findSkills(bundle);
  assert.deepEqual(entries, ['SKILL.md']);
});

test('PowerShell 按 Skill 示例经 stdin 传递中文 JSON', (t) => {
  const skill = readFileSync(path.join(bundle, 'SKILL.md'), 'utf8');
  const examples = Array.from(skill.matchAll(/```powershell\r?\n([\s\S]*?)```/gu), (block) => block[1]);
  const example = examples.find((block) => /\bcall\s+(?:--stdin\s+)?read_param_fields\b/u.test(block));
  assert.ok(example, '未找到 Skill 的原版读取示例');

  const scratch = scratchFor(t);
  const workspace = path.join(scratch, 'Mod copy');
  mkdirSync(workspace);
  writeFileSync(path.join(workspace, '鬼形部.txt'), 'Synthetic bundle test.');
  writeFileSync(path.join(workspace, 'other.txt'), 'Non-matching file.');
  // Preserve the documented transport, but use a searchable fixture instead of game data.
  const command = example.replace(/read_param_fields/u, 'search_resources')
    .replace(/'\{"table":.*\}'/u, `'${JSON.stringify({ query: '鬼形部' })}'`)
    .replace(/<PACKAGE>\\bin\\sfcli\.cmd/u, '.\\bin\\sfcli.cmd')
    .replaceAll('"<workspace>"', '"$workspace"')
    .replace(/\s+--base\s+"(?:\$base|<base>)"/u, '');
  const encodingCommands = examples.flatMap((block) => block.split(/\r?\n/))
    .filter((line) => /^(?:\$OutputEncoding|\[Console\]::OutputEncoding)\s*=/u.test(line));
  const script = path.join(scratch, 'read.ps1');
  writeFileSync(script, ['\uFEFF$workspace = $env:TEST_WORKSPACE', ...encodingCommands, command, 'exit $LASTEXITCODE'].join('\n'));
  const ps = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script], {
    cwd: bundle, env: { ...env, TEST_WORKSPACE: workspace, SF_E2E_WORKSPACE_STORAGE_ROOT: path.join(scratch, 'storage') },
    encoding: 'utf8', timeout: 30_000
  });
  if (ps.error) throw ps.error;
  assert.equal(ps.status, 0, ps.stderr);
  const out = JSON.parse(ps.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.data.record.total, 1);
  assert.equal(out.data.record.matches[0].item.relativePath, '鬼形部.txt');
});
