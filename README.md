# SoulForge Preview

《只狼》Mod 工作台的预览版：一个把 SoulForge 的原生解析能力（C# Bridge）和 69 个 Agent 工具
封装成 skill 的**可脱离仓库运行**的分发包。

- 读：PARAM / FMG / EMEVD / MSB / TAE / FLVER / TPF / GPARAM / 脚本 的搜索与精确读取
- 对照：`origin:"base"` 读取游戏原版，或用 `compare_with_base` 逐字段比对
- 写：Patch Engine 受控写入（暂存、备份、日志、原生回读），支持回滚
- 绑定：用一份文本目录记录「Mod 副本目录」与「游戏安装根」两个路径

**使用说明在 [SKILL.md](SKILL.md)**，从「绑定」一节开始读。构建与发布验收见
[BUILDING.md](BUILDING.md)。

## 快速开始

```powershell
# 1) 复制绑定模板，填两个绝对路径
Copy-Item binding.template.md binding.md

# 2) 检查绑定是否安全（0 = 可以继续，2 = 有问题）
.\bin\sfcli.cmd --workspace "<MOD_COPY>" --base "<GAME_ROOT>" preflight

# 3) 查看工具目录（不需要工作区）
.\bin\sfcli.cmd --json list
```

## 前置条件

- **Windows x64**（Bridge 是自包含的 win-x64 可执行文件）
- **Node.js 22.22.0**（启动器会拒绝更低的版本；更高的版本会提示未经验证）
- **《只狼》安装根**：目录里要有 `sekiro.exe` 与 `oo2core_6_win64.dll`。Oodle 运行库由用户自备，
  不随本包分发。
- **Mod 副本目录**：所有写入落在这里。**不要**指向真实的 `mods` 文件夹——工具不会拒绝，
  它会真的写进去。`preflight` 会检查这一点。

## 已知限制

- 只支持 Windows x64 与《只狼》Sekiro 1.6.x。
- 写入只在工作区副本内验证过；不写进游戏目录。
- 本包默认**不含**内置 Agent 运行时（`agent exec` 不可用）；工具类命令（`list`/`describe`/
  `call`/`session`/`preflight`）全部可用。

## 许可证

Apache-2.0，见 [LICENSE](LICENSE) 与 [NOTICE](NOTICE)。
