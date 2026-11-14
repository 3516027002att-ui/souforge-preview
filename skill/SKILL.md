---
name: soulforge-preview
description: 只读+受控写入的《只狼》Mod 工作台。用文本目录把「Mod 副本目录（工作区）」和「游戏安装根（--base）」绑定到 CLI，然后搜索、精确读取、与原版对照，并在隔离副本上做单字段修改和回滚。适用于 FromSoftware 资源（PARAM/FMG/EMEVD/MSB/TAE/FLVER/TPF/GPARAM/脚本）的定位、读取与受控编辑。
---

# SoulForge Preview

SoulForge 把 FromSoftware 原生格式的生产解析放在 C# Bridge 里，工具通过一个本地 CLI
（`sfcli`）暴露。这个 skill 教你如何绑定两个目录、用哪个工具、以及哪些操作会失败。

**先读「绑定」一节再执行任何命令。** 绑定错了，写入会落进真实 Mod。

所有命令都通过包内的启动器执行（它会设置 `SOULFORGE_ROOT`，直接调 `sfcli.mjs` 会找不到
编译包）：

```powershell
<PACKAGE>\bin\sfcli.cmd <参数>      # Windows
<PACKAGE>/bin/sfcli <参数>           # POSIX
```

下文用 `<PACKAGE>` 指打包目录，`sfcli` 指上述启动器。

启动器会检查 Node 版本：低于 22 直接拒绝，高于 22 打印「未经验证」提示后继续。

## 一、绑定：两个目录，用文本目录记录

工具只需要两个绝对路径：

| 名称 | 含义 | 传入方式 |
|---|---|---|
| 工作区（workspace） | **Mod 的副本目录**，所有写入落在这里 | `--workspace <路径>` 或 `SOULFORGE_WORKSPACE` |
| 游戏根（base） | 《只狼》**安装根**，其下直接是 `event/`、`param/`、`chr/`，并且有 `sekiro.exe` 与 `oo2core_6_win64.dll` | `--base <路径>` 或 `SOULFORGE_SEKIRO_ROOT` |

在本 skill 目录里维护一份 `binding.md`（文本目录），只写这两行：

```text
workspace: <Mod 副本的绝对路径>
base:      <只狼安装根的绝对路径>
```

首次使用时复制模板再填：

```powershell
Copy-Item <PACKAGE>\skill\binding.template.md "<任意位置>\binding.md"
```

每次会话开始先读它，然后用它拼命令。**不要猜路径，不要在工作区里搜索游戏文件。**

### 绑定的四条硬纪律

1. **工作区必须是副本，不是真实 Mod。** 工具没有任何「拒绝写进真实 mods」的保护：
   `--workspace` 指向哪里，写入就落在哪里。若绑定文本里 workspace 指向
   `<游戏根>\mods`，或者路径里出现 `sekiro.exe`，**停止**，先复制一份副本。
2. **base 是安装根，不是 mods。** base 只用于读取原版做对照；指到 mods 会让「原版」返回
   Mod 的内容。
3. **路径拼写固定。** junction 路径与真实路径共享同一份工作区数据库（键来自物理路径），
   但为可读性，绑定文本统一写一种拼写，不要混用。
4. **只读任务一律先 `--mode plan`。** plan 模式会拒绝所有写入工具；确认要改再重启为
   `--mode normal`。

## 二、开工前必须做的 preflight

绑定后，第一条命令固定是下面两条；任一失败就停，并把诊断报给用户：

```powershell
<PACKAGE>\bin\sfcli.cmd --workspace "<workspace>" --base "<base>" preflight
<PACKAGE>\bin\sfcli.cmd --workspace "<workspace>" --base "<base>" --quiet call workspace_stats '{}'
```

- **`preflight` 必须 exit 0。** 它会检查工作区是不是副本、base 是不是安装根。退出码 2 时
  会列出问题（`WORKSPACE_LOOKS_LIKE_MODS`、`WORKSPACE_IS_GAME_ROOT`、`WORKSPACE_INSIDE_BASE`、
  `BASE_NOT_GAME_ROOT` 等）。**出现任何一条就不要继续写**，让用户改绑定。
- 会话打开时如果 `--base` 不是安装根，stderr 会出现 `CLI_BASE_NOT_GAME_ROOT` 或
  `CLI_BASE_OODLE_MISSING`。**看到这两条就停下来问用户**：此时 `origin:"base"` 读到的可能
  是 Mod 自己的字节，原版对照的结论不可信。
- `workspace_stats` 应返回非零 `files`；全 0 说明工作区是空的或路径错。
- 可选的一条原版对照自检（不指定的 `NpcParam` 行可能不存在，所以只在用户确认有该行时用）：

```powershell
<PACKAGE>\bin\sfcli.cmd --workspace "<workspace>" --base "<base>" --quiet call read_param_fields '{"table":"NpcParam","rowIds":[50800000],"fieldIds":["ninsatuNum"],"origin":"base"}'
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
- **读证明绑定对象本身。** 同一对象被写过后它的证明作废（`NATIVE_READ_STALE`），再写要重读。
- **分页要翻到 `hasMore=false`** 才算整表读证据；`nextActions` 可以直接原样执行。

## 四、工具面

工具目录以 CLI 为准，不要手抄。查目录**不需要工作区**：

```powershell
<PACKAGE>\bin\sfcli.cmd --json list
<PACKAGE>\bin\sfcli.cmd --json describe <tool>
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
- **回滚**：`list_operations` 列出历史，`rollback_operation` 撤销一条。
  **回滚需要 `--mode fullPermission` 且带 `--confirm-rollback <opId>`**；`normal` 模式下
  回滚会被 `TOOL_PERMISSION_DENIED` 拒绝（这是实测过的，不是猜测）。

完整写入+回滚示例（同一个工作区，从 package 目录执行）：

```powershell
# 写：读+写在同一个 session 进程里
'{...read frame...}','{...write frame...}' | <PACKAGE>\bin\sfcli.cmd --workspace "<workspace>" --base "<base>" session
# 回滚：显式授权一条 opId
<PACKAGE>\bin\sfcli.cmd --workspace "<workspace>" --base "<base>" --mode fullPermission `
  --confirm-rollback <opId> --quiet call rollback_operation '{"opId":"<opId>"}'
```

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
- 需要 Node.js 22.22.0（本包在该版本上验证）。其它版本未验证，尤其 `--analyze` 在
  Node 24 + better-sqlite3 12.11.1 上有已知 abort。
- 读正确性用 `compare/run.mjs` 与成熟参考工具比对：FMG/TAE/EMEVD/MSB/TPF/GPARAM 已比对；
  PARAM 有 7 张表因参考工具缺定义而未比对（`reference-unsupported`）。
- 全部引用扫描（`find_references`）在大工作区上可能需要数十秒并返回 `partial`；不要把它当成
  每个问题的默认步骤。
