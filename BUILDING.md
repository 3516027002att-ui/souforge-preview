# soulforge-preview 的构建与发布

本仓库是可直接安装的分发包。以下构建命令在包含 `scripts/build-skill-package.mjs` 的
SoulForge 源码树中执行，不是在本仓库或用户的 Skill 安装目录里执行。

## 构建

使用 Windows x64 和 x64 版 Node.js 22.22.0 或更新的 22.x（ABI 127）。用同一个 Node 安装依赖、
构建 core/shared、自包含 Bridge 并打包；不要复用其他 Node 主版本或 Electron 的 SQLite binding：

```powershell
npm ci
npm run build
npm run bridge:publish
```

生成产物（默认输出到 `output/soulforge-preview`，已被 gitignore）：

```powershell
npm run skill:preview                       # 仅工具面
npm run skill:preview -- --with-agent       # 另带内置 Agent 运行时（agent exec 可用）
```

打包端必须实际打开 SQLite，不能只检查 `.node` 是否存在或 `list` 是否成功。
本分发包的 `better-sqlite3` 为 12.11.1，使用[上游发布的 Windows x64、Node ABI 127 构件](https://github.com/WiseLibs/better-sqlite3/releases/expanded_assets/v12.11.1)。
对应归档 `better-sqlite3-v12.11.1-node-v127-win32-x64.tar.gz` 的 SHA-256 为
`927b34496e946dc7c9a45636a03a039df72f10191ccc4960b8616d1a9319e45b`。

## 产物结构

```
soulforge/
  SKILL.md
  binding.template.md
  bin/{sfcli.cmd, sfcli, sfcli.mjs, require-node.cjs}
  packages/{core,shared,agent}/
  node_modules/{better-sqlite3, bindings, file-uri-to-path, @soulforge/shared}
  bridge/SoulForge.Bridge/bin/Release/net10.0/win-x64/publish/SoulForge.Bridge.exe
  package.json
```

产物可脱离本仓库运行；调用方用 `bin\sfcli.cmd`（它固定 `SOULFORGE_ROOT`）。

## 发布前的验收

1. 在这个分发包仓库根目录用 Node 22 运行 `npm test`（不用安装依赖）。它验证不绑定也能列工具、
   合成会话能用持久 SQLite 日志、Mod 与原版的路径边界、唯一的 Skill 入口，以及 PowerShell 经 stdin 传输中文 JSON。
   再用干净项目装一遍，确认宿主只发现一个 `soulforge`。
2. 把产物安装到临时项目，用真实游戏根和完整 Mod 测试夹具跑一遍：
   `sfcli --workspace <Mod 根> --base <安装根> preflight` 必须 exit 0；合成游戏根下的 `mods` 也要通过绑定。
3. 原版读取：`read_param_fields {table:"NpcParam",rowIds:[50800000],fieldIds:["ninsatuNum"],origin:"base"}`
   应返回 `2`。
4. 发布测试使用隔离夹具，不动用户正在玩的 Mod。把夹具放在合成游戏根下的 `mods`，不建 Git 仓库。
   `session` 内先原生读再写，确认写入回执及 SoulForge 本地备份；退出会话后用同一操作 ID 回滚。
   原生复读和容器哈希都应恢复。目标被后续改动时，回滚应拒绝覆盖；原版文件始终不变。
5. 随包 `SKILL.md` 与 `binding.template.md` 不得含真实机器路径；不得分发 `binding.md`。

## 不含什么

- 游戏文件与 Oodle 库（`oo2core_6_win64.dll` 由用户自备）。
- 比对语料与 `output/` 下的运行产物。
