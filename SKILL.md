---
name: soulforge
description: 在《只狼》Mod 目录中搜索、精确读取、对照游戏原版或受控修改 PARAM、FMG、EMEVD、MSB、TAE 与脚本等资源。适用于直接检查或编辑正在使用的 Mod，以及按已提交的操作回滚。
---

# SoulForge Preview

SoulForge 把 FromSoftware 原生格式的生产解析放在 C# Bridge 里，工具通过一个本地 CLI
（`sfcli`）暴露。这个 skill 教你如何绑定两个目录、用哪个工具、以及哪些操作会失败。

仅查看工具目录或 schema 不需要绑定游戏。编辑工作区就是游戏加载的 Mod 目录，不需要另建副本或部署。

下文的 PowerShell 示例均从本 `SKILL.md` 所在目录执行，使用包内启动器：

```powershell
.\bin\sfcli.cmd --json list
```

启动器验证 Windows x64、x64 版 Node.js 22.22.0 或更新的 22.x，以及随包 SQLite 能否加载。
自检失败就停止并告知用户，不要替用户安装 Node、重建依赖或绕过启动器。

## 一、绑定：两个目录，用文本目录记录

工具只需要两个绝对路径：

| 名称 | 含义 | 传入方式 |
|---|---|---|
| 工作区（workspace） | **用户要操作的 Mod 根目录**，可以是游戏正在使用的 `<游戏根>\mods` | `--workspace <路径>` 或 `SOULFORGE_WORKSPACE` |
| 游戏根（base） | 《只狼》**安装根**，其下直接是 `event/`、`param/`、`chr/`，并且有 `sekiro.exe` 与 `oo2core_6_win64.dll` | `--base <路径>` 或 `SOULFORGE_SEKIRO_ROOT` |

优先使用用户本轮明确给出的路径，其次读取本 skill 根目录的 `binding.md`；缺哪项只问哪项。
需要保存时，`binding.md` 只写下面两行，并且不要提交：

```text
workspace: <Mod 根目录的绝对路径>
base:      <只狼安装根的绝对路径>
```

首次使用时复制模板再填：

```powershell
if (-not (Test-Path -LiteralPath 'binding.md')) {
    Copy-Item -LiteralPath 'binding.template.md' -Destination 'binding.md'
}
```

读取路径值时只按第一个冒号分隔键和值，保留盘符中的冒号。**不要猜路径，也不要搜盘找游戏。**

### 区分 Mod 与原版

- **写入只落在 `workspace`。** 不要把游戏安装根、游戏根的父目录或原版 `param/`、`event/` 等当 Mod 工作区。
- **`base` 是只读原版。** 读取原版用 `origin:"base"` 和工作区内的相对资源路径，例如 `event/m11_00_00_00.emevd.dcx`。
- CLI 会解析 Junction。后续调用使用预检返回的实际 Mod 路径。
- **只读任务使用 `--mode plan`。** 用户明确要改且游戏已退出时，才用 `--mode normal`。

## 二、开工前必须做的 preflight

绑定后，从安装目录执行以下命令。把 `$workspace` 和 `$base` 的值换成已确认的实际路径：

```powershell
$workspace = '<MOD_ROOT>'
$base = '<GAME_ROOT>'
$binding = .\bin\sfcli.cmd --workspace "$workspace" --base "$base" --json preflight
if ($LASTEXITCODE -ne 0) { throw '绑定预检失败。' }
$binding = $binding | ConvertFrom-Json
$workspace = $binding.workspace
$base = $binding.base

# JSON 用 stdin，不要直接作为 .cmd 的参数；中文请求用 UTF-8。
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = $OutputEncoding
'{}' | .\bin\sfcli.cmd --workspace "$workspace" --base "$base" --mode plan --json --quiet call --stdin workspace_stats
```

- **`preflight` 必须 exit 0。** 工作区可以在安装根下，但不能与 `base` 相同、包含 `base` 或指到原版资源目录。
  退出码 2 时先报告 `findings` 并纠正路径。预检不启动 Bridge；通过不等于已经读到原版。
- 确认 `workspace_stats` 的退出码为 0、`ok: true`，并且 `data.record.files` 非零。
- 可选的一条原版对照自检（不指定的 `NpcParam` 行可能不存在，所以只在用户确认有该行时用）：

```powershell
'{"table":"NpcParam","rowIds":[50800000],"fieldIds":["ninsatuNum"],"origin":"base"}' |
    .\bin\sfcli.cmd --workspace "$workspace" --base "$base" --mode plan --json --quiet call --stdin read_param_fields
```

  只狼原版 `ninsatuNum` 是 2。报 `BASE_ROOT_UNAVAILABLE` 或 `BASE_FILE_MISSING` 说明 base 绑错。
- 若提示 `BRIDGE_SPAWN_FAILED` 或「无法枚举 parambnd」，说明随包的 Bridge 没起来——
  **不要**让 agent 自己换目录或加权限，直接报告。

## 三、会话协议（必须遵守）

- **读后写必须同进程。** `call` 每次都是新进程，读证明不跨进程；先 `call` 读、再 `call` 写
  必然得到 `NATIVE_READ_REQUIRED`。先读后写请用 `session`：一个进程内从 stdin 逐行送
  `{"id","tool","args"}`，读帧在前、写帧在后。
- **id 每次现生成。** 同一个 id 只重放旧结果；换了参数再用同一 id 会被拒
  （`CLI_REQUEST_ID_CONFLICT`）。
- **响应按 `id` 关联，不能按行序。** session 的输出不保证与输入同序。
- **用 EOF 正常结束会话。** 收齐本次请求的响应（写入后还要回读），从调用端关闭子进程的 stdin，等待进程退出。
  例如，用 Node.js 调用 `child.stdin.end()`。不要把 `Ctrl+Z` 当作请求发送，也不要用 `Ctrl+C` 正常收尾。
- **读证明绑定对象本身。** 同一对象被写过后它的证明作废（`NATIVE_READ_STALE`），再写要重读。
- **分页要翻到 `hasMore=false`** 才算整表读证据；`nextActions` 可以直接原样执行。

## 四、工具面

工具目录以 CLI 为准，不要手抄。查目录**不需要工作区**：

```powershell
.\bin\sfcli.cmd --json list
.\bin\sfcli.cmd --json describe read_param_fields
```

69 个工具，权限分布：read 41、analyze 11、propose 3、validate 1、commit 12、rollback 1。
按任务选入口：

- **找对象**：`search_param_rows`（PARAM 行）、`search_text_entries`（FMG 文本）、
  `search_events`（EMEVD 指令）、`search_map_entities` / `query_map_objects`（地图）、
  `search_tae_events`（动作）。
- **精确读**：`read_param_fields`、`read_fmg_entries`、`read_emevd_event`、`read_tae_events`、
  `read_msb_parts`。原版对照加 `origin:"base"`，或直接用 `compare_with_base`。
- **写**：`mutate_param_fields`、`mutate_fmg_entries`、`apply_emevd_dsl`、`mutate_tae_event_fields`、
  `mutate_msb_part_transform`、`mutate_luabnd_script`。写入走 Patch Engine：暂存、备份、日志、
  原生回读；提交回执见 `transaction.opId`。
- **回滚**：`list_operations` 列出历史，`rollback_operation` 撤销一条已提交的写入。

### 原地编辑与回滚

用户明确授权且游戏已退出后才写入或回滚。在同一个 `--mode normal` 的 `session` 中先原生读取目标，再用对应领域的写入工具。
Patch Engine 会在 SoulForge 的本地数据目录保存本次所改文件的原版本和操作记录，不需要 Git、手工备份或另建 Mod 副本。
如果工具报告备份或持久日志不可用，停止，不要改用普通文件写入补做。成功后原生回读，报告改了什么和 `transaction.opId`，
用户可以沿用原有配置启动游戏。

撤销时使用写入回执中的 `opId`，或从同一工作区的 `list_operations` 找到对应记录。需要
`--mode fullPermission` 和绑定到该操作的 `--confirm-rollback`：

```powershell
$opId = '<已授权回滚的 opId>'
@{opId = $opId} | ConvertTo-Json -Compress |
    .\bin\sfcli.cmd --workspace "$workspace" --base "$base" --mode fullPermission --confirm-rollback "$opId" --json --quiet call --stdin rollback_operation
```

回滚只恢复该操作所改的文件。遇到 `ROLLBACK_TARGET_CHANGED`，先报告冲突，不强行覆盖；若由同一文件上更晚的操作造成，
经用户授权后按从新到旧的顺序回滚，再原生回读。操作结果不明时先查日志，不自动重试写入。

**在 skill 环境里不可用的工具**：`read_memory`、`write_memory`、`list_memories`（没有持久记忆
存储）、`query_knowledge` / `read_knowledge_claims`（空语料）。不要反复尝试。

**常用组合**（实测）：搜索拿到 `rowId` 后，用 `search_param_fields {table, rowIds:[rowId], query}`
发现真实字段名，再用 `read_param_fields {table, rowIds, fieldIds}` 读值——不要凭猜测填字段名，
`read_param_fields` 收到不存在的字段会让整次交付作废。

## 五、输出约定

- 每个工具结果是一个 envelope：`{ok,state,data,pagination,completeness,truncated,identifiers,evidence}`。
  `data.record` 是主载荷；`data.items` 只在交付条目数组时出现，**空数组 ≠ 没有结果**。
- 搜索零命中不等于「不存在」：先看 `variantHints`、`coverage`、`negativeConclusionAllowed`；
  coverage 不完整时结论是「尚未查全」。
- 写入后必须原生回读确认；`ok:true` 但 `completeness:"partial"` 不算查全。

## 六、已知限制（如实告知用户）

- 只支持 Windows x64 与《只狼》Sekiro 1.6.x；Oodle 库由用户自备（不随包分发）。
- 需要 Node.js 22.22.0 或更新的 22.x（x64）。启动器拒绝与随包 SQLite 不匹配的 Node 版本。
- 读正确性用 `compare/run.mjs` 与成熟参考工具比对：FMG/TAE/EMEVD/MSB/TPF/GPARAM 已比对；
  PARAM 有 7 张表因参考工具缺定义而未比对（`reference-unsupported`）。
- 全部引用扫描（`find_references`）在大工作区上可能需要数十秒并返回 `partial`；不要把它当成
  每个问题的默认步骤。

## 七、报告问题

遇到安装、绑定或执行任务时的工具崩溃、结果错误，或文档和实际行为不符，先在任务回执里说明影响。
路径填错、缺少已说明的依赖、正常的权限拒绝不必提 Issue。写入结果不明时，先查操作日志，不要为了复现而重试写入。

1. 用工具名、错误码或现象搜索 [souforge-preview 的 Issues](https://github.com/3516027002att-ui/souforge-preview/issues)，包括已关闭的条目。已有同一问题就返回链接，不重复提交。
2. 标题写清出错的工具或阶段和现象；正文给出分发版本或提交号、Windows 和 Node.js 版本、最小复现步骤、预期与实际结果，以及错误码或必要的日志片段。不能复现时如实注明。用占位符替换本机路径，不上传凭据、`binding.md`、完整日志、游戏文件或私人 Mod。涉及安全漏洞或无法脱敏时，不发公开 Issue。
3. 用户已明确授权公开反馈时，使用已获授权的 GitHub 账号在这个仓库提交，成功后把 Issue 链接带回任务回执。用户未授权、无法查重或没有提交权限时，只给脱敏草稿和 Issues 链接，不代发。
