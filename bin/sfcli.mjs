#!/usr/bin/env node
/**
 * SoulForge CLI — 在桌面应用之外调用生产 ToolRegistry 的全部 Agent 工具。
 *
 * 用法:
 *   node tools/soulforge-cli/sfcli.mjs --workspace <mods> [选项] list
 *   node tools/soulforge-cli/sfcli.mjs --workspace <mods> call <tool> '<json>'
 *   node tools/soulforge-cli/sfcli.mjs --workspace <mods> call --stdin <tool>
 *   node tools/soulforge-cli/sfcli.mjs --workspace <mods> session   （读+写必须同进程，见 --help）
 *
 * 选项:
 *   --workspace <path>   Mod 工作区（overlay），必填
 *   --base <path>        游戏根目录（可选，用于 Oodle/EMEDF）
 *   --game <name>        默认 sekiro
 *   --mode <mode>        plan | normal | fullPermission（默认 normal）
 *   --confirm-rollback <opId>  显式授予当前 workspace 对单个 opId 的一次性回滚确认
 *   --confirm-patch <opId>     显式批准当前 workspace 的单个 proposal 提交（等价的 CLI 审批通道）
 *   --analyze            打开后执行完整原生分析（慢，但无语义缓存时需要）
 *   --no-analyze          显式跳过语义分析（适用于操作历史/回滚等维护工具）
 *   --no-cache           跳过 workspace.db 语义缓存水合
 *   --json               以紧凑 JSON 输出结果
 *   --quiet              仅输出工具结果
 *   --diagnostics        将阶段耗时与游标诊断以 JSON Lines 写入 stderr
 */

import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { existsSync, realpathSync, statSync } from 'node:fs';
import process from 'node:process';
import { createInterface } from 'node:readline';

// Portable/local SDK hosts may omit ProgramFiles; NuGet restore (dotnet run
// fallback) and some path combinators require them.
if (!process.env.PROGRAMFILES) process.env.PROGRAMFILES = 'C:\\Program Files';
if (!process.env.ProgramW6432) process.env.ProgramW6432 = 'C:\\Program Files';
if (!process.env.CommonProgramFiles) {
  process.env.CommonProgramFiles = 'C:\\Program Files\\Common Files';
}

const here = dirname(fileURLToPath(import.meta.url));
// A packaged distribution does not sit two levels below a checkout: `bin/sfcli.mjs` next to
// `packages/` is the root itself. `SOULFORGE_ROOT` names that root explicitly; without it,
// infer it from the layout (a `packages/core/dist` beside `bin/` means `here/..` is the root),
// and only then fall back to the checkout layout (`tools/soulforge-cli/` → two levels up).
const REPO_ROOT = (() => {
  if (process.env.SOULFORGE_ROOT) return resolve(process.env.SOULFORGE_ROOT);
  const packaged = resolve(here, '..');
  if (existsSync(join(packaged, 'packages/core/dist/index.js'))) return packaged;
  return resolve(here, '../..');
})();
const CORE_DIST = join(REPO_ROOT, 'packages/core/dist/index.js');
const SHARED_DIST = join(REPO_ROOT, 'packages/shared/dist/index.js');

/**
 * `call` answers with the tool envelope itself; `session` wraps that envelope in a request frame.
 * Reading one field path on both silently produced null/undefined, so each response now states
 * where its payload lives, and `session` additionally mirrors the envelope's data/pagination keys
 * at the frame top level. A parser that reads data.record.<field> therefore works for both.
 */
const SHELL_CALL = Object.freeze({
  frame: 'tool-envelope',
  resultPath: '',
  dataPath: 'data',
  recordPath: 'data.record',
  note: '调用结果即工具 envelope：{ok,state,data,pagination,completeness,truncated,identifiers,evidence}。'
    + 'data.record 是主载荷；data.items 只在工具交付条目数组时存在——对象载荷不再附带空 items。'
});
const SHELL_SESSION = Object.freeze({
  frame: 'session-frame',
  resultPath: 'result',
  dataPath: 'data',
  recordPath: 'data.record',
  note: '会话帧 = {id,requestState,transaction,ok,result}；result 是同一工具 envelope。data/pagination/'
    + 'completeness/truncated/identifiers/evidence 同时在帧顶层镜像，故 data.record.<field> 与 call 同路径可读。'
    + 'data.items 只在工具交付条目数组时存在，对象载荷看 data.record。'
});
const SHELL_LIST = Object.freeze({
  frame: 'tool-envelope',
  resultPath: '',
  dataPath: 'data',
  recordPath: 'data.record',
  note: 'list 也使用工具 envelope：data.record.tools / data.record.count / data.record.names。'
    + 'data.items 与 data.record.tools 是同一个数组（同一份目录，不是第二份）。'
});

function decorationShell(command) {
  if (command === 'session') return { command: 'session', ...SHELL_SESSION };
  if (command === 'call' || command === 'search-param' || command === 'read-param') {
    return { command: 'call', ...SHELL_CALL };
  }
  return { command: 'list', ...SHELL_LIST };
}

function fail(message, code = 1) {
  process.stderr.write(`${message}\n`);
  process.exit(code);
}

// PowerShell 管道默认带 BOM（U+FEFF）；直接 JSON.parse 会报
// "Unexpected token 'U+FEFF'"。stdin 入口统一剥离后再解析。
/**
 * Windows shells hand JSON to a pipeline with a byte-order mark in front. Decoding such input as
 * UTF-8 leaves U+FEFF (or replacement characters, when the BOM was UTF-16) and JSON.parse then fails
 * with "No number after minus sign in JSON at position 1". Strip the mark at the byte level and
 * decode according to which one it is, instead of trusting the transport.
 */
function decodeStdinJson(buffer) {
  if (buffer.length >= 3 && buffer[0] === 0xEF && buffer[1] === 0xBB && buffer[2] === 0xBF) {
    return buffer.subarray(3).toString('utf8');
  }
  if (buffer.length >= 2 && buffer[0] === 0xFF && buffer[1] === 0xFE) {
    return buffer.subarray(2).toString('utf16le');
  }
  if (buffer.length >= 2 && buffer[0] === 0xFE && buffer[1] === 0xFF) {
    const swapped = Buffer.from(buffer.subarray(2));
    swapped.swap16();
    return swapped.toString('utf16le');
  }
  return stripJsonBom(buffer.toString('utf8'));
}

function stripJsonBom(text) {
  return typeof text === 'string' ? text.replace(/^\uFEFF+/u, '') : text;
}

// `call` 每次都是新进程，而原生读取证明只活在产生它的进程里；因此 NATIVE_READ_REQUIRED
// 不能只说「先读一次」——照做仍然会失败。把「用 session、同一进程内先读后写」连同本次的
// 工作区路径和调用方自己的写入参数一起写进错误消息，让它可以直接复制执行。
function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** PARAM 写入的 edits 自带表/行/字段，足以合成授权它的读取帧。 */
function paramReadFrames(toolName, args, stamp) {
  if (toolName !== 'mutate_param_fields' || !args || !Array.isArray(args.edits)) return null;
  const byTable = new Map();
  for (const edit of args.edits) {
    if (!edit || typeof edit !== 'object') continue;
    const table = typeof edit.table === 'string' ? edit.table : '';
    const rowId = typeof edit.rowId === 'number' ? edit.rowId : null;
    const fieldId = typeof edit.fieldId === 'string' ? edit.fieldId : '';
    if (!table || rowId === null || !fieldId) continue;
    if (!byTable.has(table)) byTable.set(table, { rowIds: [], fieldIds: [] });
    const slot = byTable.get(table);
    if (!slot.rowIds.includes(rowId)) slot.rowIds.push(rowId);
    if (!slot.fieldIds.includes(fieldId)) slot.fieldIds.push(fieldId);
  }
  if (byTable.size === 0) return null;
  return [...byTable].map(([table, slot], index) => JSON.stringify({
    id: `r${index + 1}-${stamp}`,
    tool: 'read_param_fields',
    args: { table, rowIds: slot.rowIds, fieldIds: slot.fieldIds }
  }));
}

/**
 * The command a caller should paste back. It has to name *this* installation: a packaged skill has
 * no `tools/soulforge-cli/` directory, so a recipe that spells the checkout path is a command that
 * cannot run — and it is the one thing the error asks the caller to execute.
 *
 * Root resolution is layout-based (see REPO_ROOT), so no environment prefix is needed; an env
 * assignment cannot precede a pipeline stage in PowerShell anyway.
 */
function selfInvocation() {
  return `node ${psQuote(fileURLToPath(import.meta.url))}`;
}

/**
 * Builds the copy-paste `session` recipe for a refused write. PARAM writes get both frames and a
 * runnable one-liner; other domains name the read tool (the envelope's details.readTool) instead of
 * pretending to know its arguments.
 */
function buildSessionGuidance({ toolName, args, details, workspaceRoot, baseRoot, options }) {
  const invocation = [selfInvocation(), '--workspace', psQuote(workspaceRoot)];
  if (baseRoot) invocation.push('--base', psQuote(baseRoot));
  // Carry the flags the caller already used, so the pasted recipe reproduces this invocation
  // instead of silently switching to full analysis (slow) or back to the semantic cache.
  if (options && options.mode && options.mode !== 'normal') invocation.push('--mode', options.mode);
  if (options && options.noAnalyze) invocation.push('--no-analyze');
  if (options && options.useCache === false) invocation.push('--no-cache');
  invocation.push('session');
  const command = invocation.join(' ');
  // Request ids must not be reused for a different payload in the same workspace: an identical id is
  // replayed, a differing one is refused with CLI_REQUEST_ID_CONFLICT. A refusal recipe is designed
  // to be re-run, so mint ids no earlier attempt could have used.
  const stamp = Date.now().toString(36);
  const writeFrame = JSON.stringify({ id: `w-${stamp}`, tool: toolName, args: args ?? {} });
  const readFrames = paramReadFrames(toolName, args, stamp);
  const readTool = details && typeof details.readTool === 'string' ? details.readTool : null;
  const reason = '读证明不跨进程：上一次 call 的读取即使成功，也留在它自己的进程里；call 每次启动新进程，'
    + '所以第二次 call 拿不到第一份证明（这不是读错了）。';
  const receipt = '响应每行一帧；写入帧里的 transaction.state="committed" 与 transaction.opId 就是提交回执。'
    + 'id 是按本次现生成的：改了 args 请同时换一个新 id（同一 id 只接受完全相同的请求）。';
  if (readFrames && readFrames.length > 0) {
    const frames = [...readFrames, writeFrame];
    const pipeline = `${frames.map(psQuote).join(',')} | ${command}`;
    return {
      details: {
        why: 'read-proof-is-process-local',
        transport: 'session',
        command,
        frames,
        note: 'stdin 每行一个 {"id","tool","args"} 帧；读帧必须与写帧在同一个 session 进程里。'
      },
      text: [
        reason,
        '改用 session（同一进程内先读后写）。下面整段复制到 PowerShell 即可运行（路径与参数已是本次的）：',
        pipeline,
        receipt,
        '更多说明见 --help 的 session 一节。'
      ].join('\n')
    };
  }
  return {
    details: {
      why: 'read-proof-is-process-local',
      transport: 'session',
      command,
      frames: [writeFrame],
      readTool,
      note: '第一帧用读工具读回要写的目标，第二帧才是这次写入；两帧必须在同一个 session 进程里。'
    },
    text: [
      reason,
      `改用 session（同一进程内先读后写）：${command}`,
      `  第一帧先读：{"id":"r-${stamp}","tool":"${readTool ?? '<读取该目标的工具>'}","args":{...}}  ← args 用你实际的读取参数`,
      `  第二帧再写：${writeFrame}`,
      receipt,
      '更多说明见 --help 的 session 一节。'
    ].join('\n')
  };
}

/** Adds the session recipe to a NATIVE_READ_REQUIRED envelope without changing its success shape. */
function applySessionGuidance(result, toolName, args, roots) {
  if (!result || result.ok !== false || typeof result.content !== 'string') return result;
  let envelope;
  try { envelope = JSON.parse(result.content); } catch { return result; }
  const error = envelope && typeof envelope === 'object' ? envelope.error : null;
  const code = (error && typeof error.code === 'string' ? error.code : result.code);
  if (code !== 'NATIVE_READ_REQUIRED') return result;
  const guidance = buildSessionGuidance({
    toolName,
    args: args ?? {},
    details: error.details,
    workspaceRoot: roots.workspaceRoot,
    baseRoot: roots.baseRoot,
    options: roots.options
  });
  const message = typeof error?.message === 'string' ? error.message : '写入被拒绝：缺少原生读取证明。';
  envelope.error = {
    ...error,
    message: `${message}\n\n${guidance.text}`,
    details: {
      ...(error?.details && typeof error.details === 'object' ? error.details : {}),
      session: guidance.details
    }
  };
  return { ...result, code, content: JSON.stringify(envelope) };
}

// stdout 消费者提前关闭管道（例如 `| head`）时 Node 默认抛出
// 未捕获的 EPIPE，直接崩溃并打印堆栈。只对 EPIPE 静默退出（类
// Unix 惯例），其他写入错误仍按原样报告。
process.stdout.on('error', (error) => {
  if (error && error.code === 'EPIPE') process.exit(0);
  process.stderr.write(`stdout 写入失败: ${error?.stack || error}\n`);
  process.exit(1);
});

function parseArgs(argv) {
  const options = {
    workspace: process.env.SOULFORGE_WORKSPACE || process.env.SOULFORGE_SEKIRO_MOD_ROOT || null,
    base: process.env.SOULFORGE_SEKIRO_ROOT || null,
    game: process.env.SOULFORGE_GAME || 'sekiro',
    mode: process.env.SOULFORGE_MODE || 'normal',
    confirmRollback: null,
    analyze: false,
    noAnalyze: false,
    useCache: true,
    json: false,
    quiet: false,
    diagnostics: false,
    command: null,
    tool: null,
    describeTool: null,
    argsJson: null,
    stdin: false
  };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      i += 1;
      if (i >= argv.length) fail(`选项 ${arg} 缺少取值`);
      return argv[i];
    };
    if (arg.startsWith('--tool=')) {
      options.describeTool = arg.slice('--tool='.length);
      continue;
    }
    switch (arg) {
      case '--workspace':
      case '-w':
        options.workspace = next();
        break;
      case '--base':
      case '-b':
        options.base = next();
        break;
      case '--game':
        options.game = next();
        break;
      case '--tool':
        options.describeTool = next();
        break;
      case '--mode':
        options.mode = next();
        break;
      case '--confirm-rollback':
        options.confirmRollback = next();
        break;
      case '--confirm-patch':
        options.confirmPatch = next();
        break;
      case '--analyze':
        options.analyze = true;
        break;
      case '--no-analyze':
        options.noAnalyze = true;
        break;
      case '--no-cache':
        options.useCache = false;
        break;
      case '--json':
        options.json = true;
        break;
      case '--quiet':
      case '-q':
        options.quiet = true;
        break;
      case '--diagnostics':
        options.diagnostics = true;
        break;
      case '--help':
      case '-h':
        options.command = 'help';
        break;
      default:
        rest.push(arg);
    }
  }
  if (!options.command) {
    options.command = rest.shift() ?? 'help';
  }
  if (options.analyze && options.noAnalyze) fail('--analyze 与 --no-analyze 不能同时使用');
  if (options.describeTool !== null && options.command !== 'describe' && options.command !== 'desc') {
    fail(`--tool 只用于 describe：describe --tool <name>（收到命令 ${options.command}）。`);
  }
  if (options.command === 'agent') {
    options.agentArgs = rest;
    } else if (options.command === 'call') {
      // `--stdin` reads as an option and callers write it on either side of the tool name. Accept
      // both, and say what was wrong when the leftover looks like a flag: silently handing it to
      // JSON.parse produced "No number after minus sign in JSON at position 1".
      if (rest[0] === '--stdin') {
        options.stdin = true;
        rest.shift();
      }
      options.tool = rest.shift() ?? null;
      if (!options.stdin && rest[0] === '--stdin') {
        options.stdin = true;
        rest.shift();
      }
      options.argsJson = rest.length > 0 ? rest.join(' ') : null;
      if (options.argsJson !== null && options.argsJson.trim().startsWith("-")) {
        fail(`call 的参数应是 JSON 对象，收到选项文本：${options.argsJson.trim()}。用法：call --stdin <tool> 或 call <tool> --stdin。`);
      }
  } else if (options.command === 'describe' || options.command === 'desc') {
    // Both `describe <name>` and `describe --tool <name>` are accepted: the flag spelling is what
    // callers reach for first, and silently treating "--tool" as the tool name produced
    // "未知工具: --tool" from a command that looked correct.
    const positional = rest.shift() ?? null;
    if (positional !== null && options.describeTool !== null && positional !== options.describeTool) {
      fail(`describe 收到了两个不同的工具名：位置参数 ${positional} 与 --tool ${options.describeTool}。用法：describe <name> 或 describe --tool <name>。`);
    }
    options.tool = options.describeTool ?? positional;
    if (rest.length > 0) {
      fail(`describe 只接受一个工具名，多出的参数：${rest.join(' ')}。用法：describe <name> 或 describe --tool <name>。`);
    }
  } else if (options.command === 'read-param') {
    // read-param <table> <rowId> <field1,field2,...>
    options.table = rest.shift() ?? null;
    options.rowId = rest.shift() ?? null;
    options.fieldList = rest.shift() ?? null;
  } else if (options.command === 'search-param') {
    options.query = rest.shift() ?? null;
    options.paramNames = rest.length > 0 ? rest : null;
  }
  return options;
}

function printUsage() {
  process.stdout.write(`SoulForge CLI — 外置调用生产 Agent 工具

命令:
  agent exec --task-file <UTF-8 file> --responses-file <fixture>  完整 Agent（JSON Lines）
  agent exec --task-file <file> --provider-config <file> --max-cost <limit>  有预算的模型任务
  agent exec --provider test --task-file <file> --no-cost-limit --max-steps <n> --timeout-ms <ms>  明确只用步数/总时长限制的模型任务
  agent exec --task-file <file> --provider test --test-config <private-test>  原始加密配置（须显式预算及价格）
  agent exec ... --protocol-stdin  JSON Lines双向审批/取消（绑定当前精确请求）
  agent exec ... --resume-session <rollout.jsonl>  历史承接＋journal回查，不重放旧调用
  preflight                    检查 Mod 工作区与只读游戏根的绑定（不打开工作区）
  list                         列出全部工具
  describe <name>              查看工具说明与输入 schema
  describe --tool <name>       同上（两种写法等价）
  call <tool> ['{"k":v}']      调用任意工具
  call --stdin <tool>          从 stdin 读取 JSON 参数并调用
  session                      一个进程内按行调用工具；读+写必须同进程时用它（见下节）
  search-param <query> [表...]  快捷：search_param_rows
  read-param <table> <rowId> <f1,f2>  快捷：read_param_fields

session 模式（读+写必须同进程）:
  原生读取证明只活在产生它的那个进程里，不会跨进程传递。call 每次调用都是新进程，
  所以「call read_param_fields ...」成功之后再「call mutate_param_fields ...」必然失败：
  NATIVE_READ_REQUIRED —— 不是你读错了，是证明根本没有跨到写的那次调用里。
  需要先读后写时用 session：一次进程内从 stdin 逐行读请求帧，向 stdout 逐行写响应帧。

  启动:
    node tools/soulforge-cli/sfcli.mjs --workspace <Mod目录> [--base <游戏根>] session
  请求帧（stdin，每行一个）:
    {"id":"<本次唯一>","tool":"<工具名>","args":{...}}
    id 每次取没用过的值：同一个 id 只重放旧结果，换了参数再用同一 id 会被拒
    （CLI_REQUEST_ID_CONFLICT）。所以示例里的 id 用 GUID 现生成。
  响应帧（stdout，每行一个）:
    {"id":...,"ok":...,"requestState":...,"transaction":{...},"result":<工具 envelope>}
    data/pagination/completeness/truncated/identifiers/evidence 同时镜像到帧顶层，
    所以按 call 的 data.record.<field> 读取，在 session 里同样成立。
  写入回执:
    帧里的 transaction.state="committed" 与 transaction.opId 即提交回执；
    跨表写入时还有 transaction.opIds 与 transaction.operations[{table,opId}]。
  证明范围:
    读证明绑定被写的那个对象本身；同一张表被写过后它的证明即作废（NATIVE_READ_STALE），
    要重读后再写。分页读取要翻完全部页才算数（例如 read_param_fields {allRows:true}
    从 rowOffset=0 按 hasMore/nextOffset 翻到 hasMore=false），页会累积、不会互相顶掉。
  最小示例（整段复制到 PowerShell，把两个占位路径换成自己的；每帧一行，读帧在前、写帧在后）:
    ('{"id":"r-' + [guid]::NewGuid().ToString('N') + '","tool":"read_param_fields","args":{"table":"Bullet","rowIds":[12200404],"fieldIds":["HitBulletID"]}}'),('{"id":"w-' + [guid]::NewGuid().ToString('N') + '","tool":"mutate_param_fields","args":{"edits":[{"table":"Bullet","rowId":12200404,"fieldId":"HitBulletID","value":940}]}}') | node tools/soulforge-cli/sfcli.mjs --workspace "<Mod目录>" --base "<游戏根>" session

选项:
  --workspace <path>           Mod 工作区（必填）
  --base <path>                游戏根目录（可选）
  --mode <mode>                plan | normal | fullPermission
  --confirm-rollback <opId>    当前 workspace 对单个 opId 的一次性 rollback 授权
--confirm-patch <opId>       当前 workspace 对单个 proposal opId 的一次性提交授权
  --analyze                    显式请求完整原生语义分析
  --no-analyze                 显式跳过语义分析；适用于操作历史/回滚等维护工具
  --no-cache                   跳过 workspace.db 语义缓存水合
  --json                       一次性调用输出 JSON
  --quiet                      隐藏普通进度
  --diagnostics                stderr 输出阶段诊断 JSON Lines

示例:
  # --workspace 可直接指向 <游戏根>/mods。Patch Engine 自动保存修改前的文件版本，可按操作 ID 回滚。
  # 只写 --workspace；--base 提供只读的原版资源和压缩库。
  node tools/soulforge-cli/sfcli.mjs \\
    --workspace "<Mod目录>" \\
    --base "<游戏根>" \\
    search-param 落雷 Bullet

  node tools/soulforge-cli/sfcli.mjs \\
    --workspace "<Mod目录>" \\
    --base "<游戏根>" \\
    call read_param_fields \\
    '{"table":"Bullet","rowIds":[12200404],"fieldIds":["atkId_Bullet","sfxId_Bullet","HitBulletID"]}'

  # 读+写必须同进程：上面的 call 读取不能授权下面另一次 call 的写入。
  # 用 session 把两帧送进同一个进程（读帧在前、写帧在后），见上节的最小示例。
`);
}

async function loadCore() {
  if (!existsSync(CORE_DIST) || !existsSync(SHARED_DIST)) {
    fail(
      '未找到 packages/core/dist 或 packages/shared/dist。\n' +
      '请先构建: npm run build -w @soulforge/shared && npm run build -w @soulforge/core\n' +
      `期望路径: ${CORE_DIST}`
    );
  }
  return import(pathToFileURL(CORE_DIST).href);
}

function abs(path) {
  if (!path) return null;
  return isAbsolute(path) ? path : resolve(process.cwd(), path);
}

/** `list` / `describe` answer from a registry alone; no workspace, scan or Bridge needed. */
async function runCatalogOnly({ command, tool: toolName, registry, json }) {
  const tools = registry.list();
  if (command === 'list' || command === 'ls') {
    if (json) {
      // A bare array broke the one thing every other command guarantees: a caller reads
      // data.record.<field>. An array-typed payload still belongs in data.items, but the tool
      // list must also be reachable at the envelope path, so both are populated from the same
      // array (one object, not two tool catalogs).
      process.stdout.write(`${JSON.stringify({
        ok: true,
        shell: decorationShell('list'),
        data: {
          items: tools,
          record: {
            tools,
            count: tools.length,
            names: tools.map((tool) => tool.name),
            readProof: {
              scope: 'session-process',
              requires: 'session',
              note: '读+写必须同进程：原生读取证明不跨进程，call 每次是新进程；需要先读后写请用 session（--help 的 session 一节）。'
            }
          },
          scalar: null,
          summary: null
        },
        pagination: {
          originalChars: 0,
          returnedCount: tools.length,
          totalCount: tools.length,
          total: tools.length,
          offset: 0,
          limit: null,
          truncated: false,
          deliveryTruncated: false,
          cursors: {}
        },
        completeness: 'complete',
        truncated: false,
        identifiers: tools.slice(0, 64).map((tool) => `tool=${tool.name}`),
        evidence: { sourceUris: [], sourceHashes: [], sourceRevisions: [], status: 'not_applicable', kind: 'other', nextActions: [], repeatedQuery: false }
      }, null, 2)}\n`);
    } else {
      process.stdout.write(`${tools.length} tools:\n`);
      for (const tool of tools) {
        process.stdout.write(`  ${tool.permissionLevel?.padEnd(6) ?? 'read  '}  ${tool.name}\n`);
      }
      // The one thing every list reader needs and no tool name says: a read receipt does not
      // cross a process boundary, so `call` cannot do read-then-write.
      process.stdout.write('\n读+写必须同进程：call 每次是新进程，原生读取证明不跨进程；需要先读后写请用 session（见 --help 的 session 一节）。\n');
    }
    process.exit(0);
  }

  if (!toolName) {
    fail('describe 需要工具名。用法：describe <name> 或 describe --tool <name>；用 list 查看全部工具名。');
  }
  const tool = tools.find((candidate) => candidate.name === toolName);
  if (!tool) {
    fail(`未知工具: ${toolName}。用法：describe <name> 或 describe --tool <name>；用 list 查看全部工具名。`);
  }
  // The two commands answer with different outer frames. Say so here, in the tool description
  // a caller actually reads, instead of letting a single-parser consumer read null.
  process.stdout.write(`${JSON.stringify({
    ...tool,
    responseEnvelope: {
      call: decorationShell('call'),
      session: decorationShell('session'),
      list: decorationShell('list')
    },
    // A read receipt is process-local, so "read then write" cannot be two `call`s. This is part
    // of the tool description because that is what a caller reads before choosing a transport.
    readProof: {
      scope: 'session-process',
      requires: 'session',
      note: '原生读取证明只活在产生它的进程里；call 每次是新进程，所以「先 call 读、再 call 写」必然得到 NATIVE_READ_REQUIRED。'
        + '需要读后写时改用 session：一个进程内从 stdin 按行收 {"id","tool","args"} 帧，读帧在前、写帧在后。'
        + '同一对象被写过之后它的读证明即作废（NATIVE_READ_STALE），再写要重读。',
      sessionExample: `'{"id":"r1","tool":"<读取该目标的工具>","args":{...}}','{"id":"w1","tool":"${tool.name}","args":{...}}' | ${selfInvocation()} --workspace "<Mod目录>" session`,
      seeAlso: '--help 的 session 一节'
    }
  }, null, 2)}\n`);
  process.exit(0);
}

// A Mod may be inside the game directory, but never use the game's own resource trees as an overlay.
const SEKIRO_BASE_RESOURCE_DIRS = new Set([
  'action', 'ai', 'asset', 'chr', 'cutscene', 'event', 'facegen', 'font', 'map', 'menu', 'movie',
  'msg', 'mtd', 'obj', 'other', 'param', 'parts', 'script', 'sfx', 'shader', 'sound'
]);

function checkBinding(workspace, base, { requireBase = false, checkBaseMarkers = false } = {}) {
  const findings = [];
  const isFile = (path) => { try { return statSync(path).isFile(); } catch { return false; } };
  const rootOf = (path, code, label) => {
    try {
      if (path && statSync(path).isDirectory()) return realpathSync.native(path);
    } catch { /* Report missing or inaccessible directories without opening the workspace. */ }
    findings.push({ code, message: `${label}不存在、不是目录或无法解析：${path ?? '(未提供)'}` });
    return null;
  };
  const workspaceRoot = rootOf(workspace, 'WORKSPACE_MISSING', 'Mod 工作区');
  const baseRoot = base || requireBase ? rootOf(base, 'BASE_MISSING', '游戏根目录') : null;
  const childOf = (parent, child) => {
    const rel = relative(parent, child);
    return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
  };
  if (workspaceRoot) {
    if (isFile(resolve(workspaceRoot, 'sekiro.exe'))) {
      findings.push({ code: 'WORKSPACE_IS_GAME_ROOT', message: '工作区里有 sekiro.exe；请选择 Mod 目录，不要选择游戏安装根。' });
    }
    // Also check the nearest install owning this physical directory, even when --base was omitted
    // or points to a different installation. The overlay name alone is not a path boundary.
    for (let parent = dirname(workspaceRoot); parent !== dirname(parent); parent = dirname(parent)) {
      if (!isFile(join(parent, 'sekiro.exe'))) continue;
      const first = relative(parent, workspaceRoot).split(sep)[0].toLowerCase();
      if (SEKIRO_BASE_RESOURCE_DIRS.has(first)) {
        findings.push({ code: 'WORKSPACE_IS_BASE_RESOURCE', message: `工作区在游戏原版资源目录 ${first}/ 中；请选择 Mod 根目录。` });
      }
      break;
    }
  }
  if (workspaceRoot && baseRoot) {
    if (relative(workspaceRoot, baseRoot) === '') {
      findings.push({ code: 'WORKSPACE_EQUALS_BASE', message: '工作区与游戏根是同一个目录。' });
    } else if (childOf(workspaceRoot, baseRoot)) {
      findings.push({ code: 'BASE_INSIDE_WORKSPACE', message: '游戏根位于工作区内；请选择较窄的 Mod 目录。' });
    }
  }
  if (checkBaseMarkers && baseRoot) {
    if (!isFile(resolve(baseRoot, 'sekiro.exe'))) {
      findings.push({ code: 'BASE_NOT_GAME_ROOT', message: '游戏根目录里没有 sekiro.exe：--base 指向的可能是 mods，而不是安装根。' });
    }
    if (!isFile(resolve(baseRoot, 'oo2core_6_win64.dll'))) {
      findings.push({ code: 'BASE_OODLE_MISSING', message: '游戏根目录里没有 oo2core_6_win64.dll：KRAK 压缩的资源将无法解压。' });
    }
  }

  return { workspaceRoot, baseRoot, findings };
}

/** Binding check for the Mod overlay and the read-only game root; opens neither a session nor Bridge. */
function runPreflight({ workspace, base, json, checkBaseMarkers }) {
  const { workspaceRoot, baseRoot, findings } = checkBinding(workspace, base, { requireBase: true, checkBaseMarkers });
  const ok = findings.length === 0;
  if (json) {
    process.stdout.write(`${JSON.stringify({ ok, workspace: workspaceRoot, base: baseRoot, findings }, null, 2)}\n`);
  } else {
    process.stdout.write(ok
      ? `preflight ok：已确认 Mod 工作区与只读游戏根。\n  workspace=${workspaceRoot}\n  base=${baseRoot}\n`
      : `preflight 发现问题：\n${findings.map((finding) => `  - [${finding.code}] ${finding.message}`).join('\n')}\n`);
  }
  process.exit(ok ? 0 : 2);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.command === 'help') {
    printUsage();
    return;
  }

  if (options.command === 'preflight') {
    runPreflight({ workspace: abs(options.workspace), base: abs(options.base), json: options.json, checkBaseMarkers: options.game === 'sekiro' });
    return;
  }

  const log = (message) => {
    if (!options.quiet) process.stderr.write(`${message}\n`);
  };
  const emitDiagnostic = (event) => {
    if (!options.diagnostics) return;
    process.stderr.write(`${JSON.stringify({
      type: 'soulforge-cli-diagnostic',
      timestamp: new Date().toISOString(),
      ...event
    })}\n`);
  };

  const core = await loadCore();
  const {
    mapCliArgumentsToToolInput,
    openLocalCliSession,
    LocalSessionHost,
    projectSessionTransactionFrame
  } = core;
  // The session frame used to carry the raw operation-log record: targetPath, backupRoot,
  // backupPath and a file:///D:/… workspace id all reached the client, and the event targetUri
  // lost its drive letter to a bad relative conversion. A client only ever needs the logical
  // receipt, so project it here (the Core helper keeps hashes and logical URIs).
  const projectTransaction = (transaction) => (typeof projectSessionTransactionFrame === 'function'
    ? projectSessionTransactionFrame(transaction)
    : transaction);

  // The tool catalog does not depend on a workspace: names, permissions, descriptions and input
  // schemas are static. Requiring --workspace here made a caller pay a full scan just to see what
  // the tool surface is, and made the catalog unavailable while the binding was still being fixed.
  const catalogOnly = options.command === 'list' || options.command === 'ls'
    || options.command === 'describe' || options.command === 'desc';
  if (catalogOnly && !options.workspace) {
    const registry = core.createDefaultToolRegistry();
    await runCatalogOnly({ command: options.command, tool: options.tool, registry, json: options.json });
    return;
  }

  if (!options.workspace) fail('必须通过 --workspace 指定 Mod 工作区路径');
  const { workspaceRoot, baseRoot, findings } = checkBinding(abs(options.workspace), abs(options.base), {
    checkBaseMarkers: options.game === 'sekiro'
  });
  if (findings.length) fail(findings.map(({ code, message }) => `[${code}] ${message}`).join('\n'), 2);

  // Headless reads options directly instead of the roots passed to openLocalCliSession below.
  options.workspace = workspaceRoot;
  options.base = baseRoot;

  if (options.command === 'agent') {
    // Loaded here, not at the top: `agent exec` is the only command that needs the bundled
    // Agent harness. A top-level import made every `list`/`describe`/`call` depend on
    // scripts/testing and packages/agent as well, so a tools-only distribution could not start
    // at all (ERR_MODULE_NOT_FOUND before even printing --help). Keeping it dynamic lets a
    // packaging step ship the tool surface without the model runtime, and the error names the
    // missing harness instead of crashing on import.
    let runHeadlessAgentCommand;
    try {
      ({ runHeadlessAgentCommand } = await import('./headless-agent.mjs'));
    } catch (error) {
      fail(`agent exec 需要内置 Agent 运行时（headless-agent.mjs 及其依赖），当前安装未包含：`
        + `${error instanceof Error ? error.message : String(error)}\n`
        + '工具类命令（list/describe/call/session）不受影响。');
    }
    const report = await runHeadlessAgentCommand(options, core, REPO_ROOT, { emitDiagnostic });
    if (report.state === 'error') process.exitCode = 1;
    return;
  }

  const metadataOnly = options.command === 'list' || options.command === 'ls'
    || options.command === 'describe' || options.command === 'desc';
  log(`打开工作区: ${workspaceRoot}`);
  const cliSession = await openLocalCliSession({
    overlayRoot: workspaceRoot,
    ...(baseRoot ? { baseRoot } : {}),
    game: options.game,
    mode: options.mode === 'plan' || options.mode === 'fullPermission' ? options.mode : 'normal',
    ...(options.confirmRollback ? { confirmRollbackOpId: options.confirmRollback } : {}),
      ...(options.confirmPatch ? { confirmPatchOpId: options.confirmPatch } : {}),
    principal: 'local-cli',
    analyze: options.noAnalyze ? false : options.analyze || !metadataOnly,
    useCache: options.useCache,
    requireDurableLog: false,
    // Quiet suppresses progress, not degraded cache/audit guarantees. These
    // warnings explain why restart-safe cursors or writes may be unavailable.
    onFallbackWarning: (message) => {
      if (options.diagnostics) {
        emitDiagnostic({ phase: 'host.fallback', status: 'failed', details: { message } });
      } else {
        process.stderr.write(`${message}\n`);
      }
    },
    onDiagnostic: (event) => emitDiagnostic(event),
    onProgress: (progress) => {
      emitDiagnostic({
        phase: `workspace.${progress.phase}`,
        status: 'progress',
        details: {
          current: progress.current,
          ...(progress.total === undefined ? {} : { total: progress.total }),
          ...(progress.message ? { message: progress.message } : {})
        }
      });
      log(`  [${progress.phase}] ${progress.current}/${progress.total ?? '?'} ${progress.message ?? ''}`);
    }
  });
  const { registry } = cliSession;
  log(`扫描/索引完成: files=${cliSession.workspaceIndex.getFiles().length}`);
  emitDiagnostic({
    phase: 'session.ready',
    status: 'complete',
    details: {
      workspaceId: cliSession.coreSession.workspaceId,
      files: cliSession.workspaceIndex.getFiles().length
    }
  });

  const finish = async (code = 0) => {
    try { await cliSession.dispose(); } catch { /* ignore */ }
    process.exit(code);
  };

  const parseToolContent = (content) => {
    if (typeof content !== 'string') return content;
    try { return JSON.parse(content); } catch { return content; }
  };

  const executeToolCall = async (requestId, toolName, rawArgs, signal) => {
    const mapped = mapCliArgumentsToToolInput(toolName, rawArgs);
    if (!mapped.ok) {
      return {
        ok: false,
        code: mapped.code,
        content: JSON.stringify({
          ok: false,
          error: { code: mapped.code, message: mapped.message }
        })
      };
    }
    const startedAt = Date.now();
    emitDiagnostic({
      phase: 'tool',
      status: 'start',
      details: { requestId, tool: toolName }
    });
    try {
      const result = await cliSession.executeTool({
        id: requestId,
        name: toolName,
        argumentsJson: JSON.stringify(mapped.input)
      }, signal ? { signal } : {});
      const diagnostic = core.normalizeCliToolDiagnostic(result, signal);
      emitDiagnostic({
        phase: 'tool',
        status: 'complete',
        elapsedMs: Date.now() - startedAt,
        details: { requestId, tool: toolName, ...diagnostic }
      });
      return result;
    } catch (error) {
      const diagnostic = core.normalizeCliToolDiagnostic(
        {
          ok: false,
          ...(error && typeof error === 'object' && typeof error.code === 'string'
            ? { code: error.code }
            : {})
        },
        signal
      );
      emitDiagnostic({
        phase: 'tool',
        status: 'failed',
        elapsedMs: Date.now() - startedAt,
        details: {
          requestId,
          tool: toolName,
          ...diagnostic,
          message: error instanceof Error ? error.message : String(error)
        }
      });
      throw error;
    }
  };

  if (options.command === 'session') {
    if (typeof LocalSessionHost !== 'function') {
      throw new Error('CLI_SESSION_HOST_UNAVAILABLE');
    }
    const sessionHost = new LocalSessionHost(
      'stdin',
      cliSession.coreSession.workspaceId,
      'local-cli',
      cliSession.coreSession
    );
    const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
    let shouldClose = false;
    const pending = new Set();
    // A session frame wraps the tool envelope. Mirror the envelope's payload keys onto the frame so
    // a caller written against `call` (data.record.<field>) reads the same path here, and name the
    // layout in `shell` rather than leaving it to be discovered by a null.
    const decorateSessionFrame = (frame) => {
      if (!frame || typeof frame !== 'object') return frame;
      const mirrored = {};
      const result = frame.result;
      if (result && typeof result === 'object' && !Array.isArray(result)) {
        for (const key of ['state', 'data', 'pagination', 'completeness', 'truncated', 'identifiers', 'evidence']) {
          if (key in result) mirrored[key] = result[key];
        }
      }
      return { ...frame, ...mirrored, shell: decorationShell('session') };
    };
    const writeFrame = (frame) => process.stdout.write(`${JSON.stringify(decorateSessionFrame(frame))}\n`);
    const handleFrame = async (line) => {
      const frameStartedAt = Date.now();
      let frame;
      try {
        frame = JSON.parse(stripJsonBom(line));
      } catch {
        writeFrame({
          id: '',
          ok: false,
          error: { code: 'CLI_REQUEST_INVALID', message: 'session 输入行不是有效 JSON。' }
        });
        return;
      }
      const requestId = typeof frame?.id === 'string' ? frame.id : '';
      const tool = typeof frame?.tool === 'string' ? frame.tool : '';
      const args = frame?.args && typeof frame.args === 'object' && !Array.isArray(frame.args)
        ? frame.args
        : {};
      if (!requestId || !tool) {
        writeFrame({
          id: requestId,
          ok: false,
          error: { code: 'CLI_REQUEST_INVALID', message: 'session 请求必须包含非空 id 和 tool。' }
        });
        return;
      }
      if (tool === '__host_status') {
        writeFrame({
          id: requestId,
          ok: true,
          result: {
            session: 'stdin',
            workspace: workspaceRoot,
            workspaceId: cliSession.coreSession.workspaceId,
            inFlight: sessionHost.listRequestStatuses().filter((item) => ['queued', 'running', 'cancel_requested'].includes(item.state)).length,
            requests: sessionHost.listRequestStatuses()
          }
        });
        return;
      }
      if (tool === '__host_operation_status') {
        const opId = typeof args.opId === 'string' ? args.opId : '';
        writeFrame(opId ? { id: requestId, ok: true, result: await sessionHost.operationStatus(opId) }
          : { id: requestId, ok: false, error: { code: 'CLI_OPERATION_ID_REQUIRED', message: '必须提供 opId。' } });
        return;
      }
      if (tool === '__host_cancel') {
        const targetId = typeof args.requestId === 'string' ? args.requestId : requestId;
        writeFrame({ id: requestId, ok: true, result: sessionHost.requestCancel(targetId) });
        return;
      }
      if (tool === '__host_request_status') {
        const targetId = typeof args.requestId === 'string' ? args.requestId : requestId;
        const status = await sessionHost.resolveRequestStatus(targetId);
        writeFrame(status
          ? { id: requestId, ok: true, result: status }
          : { id: requestId, ok: false, error: { code: 'CLI_REQUEST_NOT_FOUND', message: `没有找到请求 ${targetId}。` } });
        return;
      }
      if (tool === '__host_close') {
        writeFrame({ id: requestId, ok: true, result: { closed: true } });
        shouldClose = true;
        input.close();
        return;
      }
      try {
        const outcome = await sessionHost.dispatch(
          { id: requestId, tool, args },
          (dispatchTool, dispatchArgs, signal) => executeToolCall(requestId, dispatchTool, dispatchArgs, signal)
        );
        if (process.env.SOULFORGE_DEBUG_REF === '1') console.error(`[cli:frame] dispatch=${Date.now() - frameStartedAt}ms contentChars=${typeof outcome?.result?.content === 'string' ? outcome.result.content.length : -1}`);
        if (!outcome.ok) {
          writeFrame({
            id: requestId, ok: false, error: outcome.error,
            requestState: outcome.requestState, transaction: projectTransaction(outcome.transaction),
            ...(outcome.result !== undefined ? { result: outcome.result?.content ? parseToolContent(outcome.result.content) : outcome.result } : {})
          });
        } else {
          const result = outcome.result;
          writeFrame({
            id: requestId,
            requestState: outcome.requestState, transaction: projectTransaction(outcome.transaction),
            ok: Boolean(result?.ok),
            ...(result?.code ? { code: result.code } : {}),
            result: parseToolContent(result?.content)
          });
        }
      } catch (error) {
        writeFrame({
          id: requestId,
          ok: false,
          error: { code: 'CLI_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error) }
        });
      }
    };
    try {
      for await (const line of input) {
        if (shouldClose || line.trim() === '') continue;
        const work = handleFrame(line);
        pending.add(work);
        void work.finally(() => pending.delete(work));
      }
      await Promise.allSettled([...pending]);
    } finally {
      sessionHost.close();
      await finish(0);
    }
    return;
  }

  try {
    if (options.command === 'list' || options.command === 'ls' || options.command === 'describe' || options.command === 'desc') {
      await runCatalogOnly({ command: options.command, tool: options.tool, registry, json: options.json });
      return;
    }

    let toolName = null;
    let args = {};

    if (options.command === 'call') {
      if (!options.tool) fail('call 需要工具名');
      toolName = options.tool;
      if (options.stdin) {
        const chunks = [];
        for await (const chunk of process.stdin) chunks.push(chunk);
        const raw = decodeStdinJson(Buffer.concat(chunks));
        args = raw.trim() ? JSON.parse(raw) : {};
      } else if (options.argsJson && options.argsJson.trim()) {
        args = JSON.parse(options.argsJson);
      }
    } else if (options.command === 'search-param') {
      if (!options.query) fail('search-param 需要查询词');
      toolName = 'search_param_rows';
      args = {
        query: options.query,
        ...(options.paramNames && options.paramNames.length > 0
          ? { paramNames: options.paramNames }
          : {})
      };
    } else if (options.command === 'read-param') {
      if (!options.table || !options.rowId || !options.fieldList) {
        fail('用法: read-param <table> <rowId> <field1,field2,...>');
      }
      toolName = 'read_param_fields';
      args = {
        table: options.table,
        rowIds: [Number(options.rowId)],
        fieldIds: String(options.fieldList)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean)
      };
    } else {
      fail(`未知命令: ${options.command}（使用 --help）`);
    }

    log(`调用 ${toolName}`);
    const result = applySessionGuidance(
      await executeToolCall(`cli-${Date.now()}`, toolName, args),
      toolName,
      args,
      { workspaceRoot, baseRoot, options }
    );
    // The envelope is already JSON; parse it only to state the shell (and keep a non-JSON payload
    // byte-identical rather than pretending it is an envelope).
    const decorateCallContent = (content) => {
      if (typeof content !== 'string') return JSON.stringify({ ...result, shell: decorationShell('call') }, null, 2);
      let envelope;
      try { envelope = JSON.parse(content); } catch { return content; }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return content;
      return JSON.stringify({ ...envelope, shell: decorationShell('call') });
    };

    if (options.json || options.quiet) {
      // bridge returns { ok, content, code? } where content is envelope JSON string
      if (typeof result.content === 'string') {
        process.stdout.write(`${decorateCallContent(result.content)}\n`);
      } else {
        process.stdout.write(`${JSON.stringify({ ...result, shell: decorationShell('call') }, null, 2)}\n`);
      }
    } else {
      process.stdout.write(`ok=${result.ok}${result.code ? ` code=${result.code}` : ''}\n`);
      process.stdout.write(`${typeof result.content === 'string' ? decorateCallContent(result.content) : JSON.stringify({ ...result, shell: decorationShell('call') }, null, 2)}\n`);
    }
    await finish(result.ok ? 0 : 2);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? (error.stack || error.message) : String(error)}\n`);
    await finish(1);
  }
}

await main();
