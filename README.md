# SoulForge Preview

《只狼》Mod 工作台的预览版：一个把 SoulForge 的原生解析能力（C# Bridge）和 69 个 Agent 工具
封装起来的本地 Skill。这个仓库已包含运行所需的工具，不需要另行构建 SoulForge。

> **想让 Agent 代装？** 把这个仓库的链接和这句话一起发给它：「请安装 `soulforge` Skill，确认它能列出工具。先不用绑定游戏，也不要修改 Mod。」

## 给 Agent：先安装，再绑定

1. **确认运行环境。** 需要能访问用户本机文件的 Windows x64 宿主，以及 x64 版 Node.js 22.22.0 或更新的 22.x。仅安装 Skill 时不需要游戏路径；缺少运行环境时，说明缺什么，不自行修改系统配置。
2. **下载完整仓库。** 将仓库根目录放进宿主的 Skill 目录，命名为 `soulforge`。保留根目录的 `SKILL.md`、`binding.template.md`、`bin/`、`bridge/`、`packages/` 和 `node_modules/`。**不要只下载 `SKILL.md`**，它不含工具运行时。若目标已存在，先核对来源并保留本地绑定，不要覆盖。
3. **检查安装。** 在安装目录里运行 `bin\sfcli.cmd --json list`。启动器先验证随包 SQLite，再列出工具；检查退出码为 0、返回 `ok: true` 且列表非空。新开本地会话，确认只发现一个 `soulforge`；Codex 用 `$soulforge`，Claude Code 用 `/soulforge`。不用运行 `npm ci`、构建命令或 `agent exec`。

下面是 Codex 的 PowerShell 示例，从要使用这个 Skill 的**项目根目录**执行；
Claude Code 把第一行的 `.agents` 换成 `.claude`。如果用户希望所有项目都能用，再把第一行的 `(Get-Location).Path` 换成 `$HOME`。
没有 Git 时，也可以下载整个仓库的 ZIP，将包含 `SKILL.md` 的根目录解压到对应的安装位置。

```powershell
$skillRoot = Join-Path (Get-Location).Path '.agents\skills'
$package = Join-Path $skillRoot 'soulforge'
if (Test-Path -LiteralPath $package) { throw '目标目录已存在，请先核对现有安装。' }
New-Item -ItemType Directory -Path $skillRoot -Force | Out-Null
git clone --depth 1 https://github.com/3516027002att-ui/souforge-preview.git $package
if ($LASTEXITCODE -ne 0) { throw '下载失败。' }
if (-not (Select-String -LiteralPath (Join-Path $package 'SKILL.md') -Pattern '^name: soulforge$' -Quiet)) {
    throw '下载到的版本未注册为 soulforge。请检查仓库版本。'
}

Push-Location -LiteralPath $package
try {
    # 在子进程中清除绑定变量，让自检不打开任何工作区
    $catalog = cmd.exe /d /c 'set "SOULFORGE_WORKSPACE=" & set "SOULFORGE_SEKIRO_MOD_ROOT=" & set "SOULFORGE_SEKIRO_ROOT=" & bin\sfcli.cmd --json list'
    if ($LASTEXITCODE -ne 0) { throw '工具目录自检失败。' }
    $result = ($catalog -join "`n") | ConvertFrom-Json -ErrorAction Stop
    if (-not $result.ok -or $result.data.record.count -lt 1) { throw '工具列表为空或不可用。' }
    "SQLite 自检通过；已列出 $($result.data.record.count) 个工具，无需绑定游戏。"
} finally {
    Pop-Location
}
```

## 首次使用：绑定两个目录

收到实际任务后再走 [SKILL.md 的绑定流程](SKILL.md#一绑定两个目录用文本目录记录)。
优先用用户本轮明确给出的路径，其次读本地 `binding.md`；缺哪项只问哪项。
`workspace` 就是 **游戏加载的 Mod 目录**（例如 `<GAME_ROOT>\mods`）；`base` 是**只读的《只狼》安装根**。
确认的路径保存在 Skill 安装目录的 `binding.md`，不要提交。CLI 会解析 Junction 后检查两个目录的关系。

```powershell
# 在安装目录执行；首次使用时复制模板，再填写两项
if (-not (Test-Path -LiteralPath 'binding.md')) {
    Copy-Item -LiteralPath 'binding.template.md' -Destination 'binding.md'
}

# 将两个占位符替换成实际绝对路径；预检通过后才继续
.\bin\sfcli.cmd --workspace "<MOD_ROOT>" --base "<GAME_ROOT>" preflight
```

预检只检查目录和标记文件，不会启动 Bridge；预检通过不等于已读到原版。只读查询明确使用 `--mode plan`，不要默认写入。

## 修改直接在游戏使用的 Mod 目录生效

收到明确的修改要求后，先退出游戏。SoulForge 会在自己的本地数据目录保存本次所改文件的原版本，
然后在 Mod 目录原地写入、回读，并返回可用于撤销的操作 ID。不需要 Git，也不会在 Mod 目录建仓库。
确认写入后按原方式启动游戏，不用复制文件或更改 Mod Engine 配置。需要撤销时，按操作 ID 回滚，
只恢复这次改过的文件；如果文件后来又被改过，SoulForge 会拒绝覆盖。
具体命令见 [Skill 的原地编辑与回滚](SKILL.md#原地编辑与回滚)。

## 能做什么

- **读取**：搜索并精确读取 PARAM、FMG、EMEVD、MSB、TAE、FLVER、TPF、GPARAM 和脚本。
- **对照**：用 `origin:"base"` 读取原版，或用 `compare_with_base` 比较两层。
- **写入**：在用户授权的 Mod 目录原地编辑，由 Patch Engine 暂存、备份、记录和回读。

构建与发布验收见 [BUILDING.md](BUILDING.md)；这不是用户的安装步骤。

## 前置条件

- **Windows x64**（Bridge 是自包含的 win-x64 可执行文件）
- **Node.js 22.22.0 或更新的 22.x（x64）**：随包 SQLite 需要 Node ABI 127，不兼容其他主版本。不要在安装目录运行 `npm install` 或 `npm rebuild`。
- **《只狼》安装根**：目录里要有 `sekiro.exe` 与 `oo2core_6_win64.dll`。Oodle 运行库由用户自备，
  不随本包分发。
- **要修改的 Mod 目录**：所有资产改动只写进这个目录；无法保存备份或持久操作记录时，SoulForge 不继续写入。

## 已知限制

- 只支持 Windows x64 与《只狼》Sekiro 1.6.x。
- 读正确性以 `compare/run.mjs` 与成熟参考工具的比对为准：FMG/TAE/EMEVD/MSB/TPF/GPARAM 已比对；
- 安装根及其原版资源目录不能作为编辑工作区；安装根下的 `mods` 等独立 Mod 目录可以。
- 本包默认**不含**内置 Agent 运行时（`agent exec` 不可用）；工具类命令（`list`/`describe`/
  `call`/`session`/`preflight`）全部可用。

## 反馈问题

如果安装说明和实际行为不符，或使用中遇到 SoulForge 工具故障，请到 [Issues](https://github.com/3516027002att-ui/souforge-preview/issues) 报告。
Agent 会先查重、整理脱敏的复现信息；经你授权后再公开提交。具体见 [Skill 的报告流程](SKILL.md#七报告问题)。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
