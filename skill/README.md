# soulforge-preview 的构建与发布

本目录是 skill 的**源**，不是可直接分发的产物。产物用脚本从构建输出生成。

## 构建

前置：Node 22.22.0、已完成 `npm ci`，并构建过 core/shared 与自包含 Bridge：

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

脚本会做启动自检：工具目录能列出、能打开工作区会话、且没有退化成内存日志。
任一失败即失败关闭，不会产出「看着完整但跑不起来」的包。

## 产物结构

```
soulforge-preview/
  bin/{sfcli.cmd, sfcli, sfcli.mjs, require-node.cjs}
  packages/{core,shared,agent}/
  node_modules/{better-sqlite3, bindings, file-uri-to-path, @soulforge/shared}
  bridge/SoulForge.Bridge/bin/Release/net10.0/win-x64/publish/SoulForge.Bridge.exe
  skill/{SKILL.md, binding.template.md}
  package.json
```

产物可脱离本仓库运行；调用方用 `bin\sfcli.cmd`（它固定 `SOULFORGE_ROOT`）。

## 发布前的验收

1. 把产物复制到仓库外的目录，用真实游戏根跑一遍：
   `sfcli --workspace <副本> --base <安装根> preflight` 必须 exit 0。
2. 原版读取：`read_param_fields {table:"NpcParam",rowIds:[50800000],fieldIds:["ninsatuNum"],origin:"base"}`
   应返回 `2`。
3. 受控写入 + 回滚：`session` 内读→写应 committed，`--mode fullPermission --confirm-rollback <opId>`
   回滚后复读回到原值。
4. 随包 SKILL.md 与 `binding.template.md` 不得含真实机器路径（`local-path-stock` 门禁会查）。

## 不含什么

- 游戏文件与 Oodle 库（`oo2core_6_win64.dll` 由用户自备）。
- 比对语料与 `output/` 下的运行产物。
