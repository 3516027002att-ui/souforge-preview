# 绑定（复制本文件为 binding.md 后填写）

只写两个绝对路径，下面两行各占一行、冒号后留一个空格：

```text
workspace: <MOD_ROOT_ABSOLUTE_PATH>
base:      <GAME_ROOT_ABSOLUTE_PATH>
```

- **workspace** 是游戏加载的 Mod 根目录（例如 `<GAME_ROOT>\mods`），所有资产写入落在这里。
- **base** 是《只狼》**安装根**（其下直接是 `event/`、`param/`、`chr/`，并且有
  `sekiro.exe` 与 `oo2core_6_win64.dll`）。不要指向 `mods`。

`<MOD_ROOT_ABSOLUTE_PATH>` 与 `<GAME_ROOT_ABSOLUTE_PATH>` 是占位符，替换成你自己的绝对路径。

检查清单：

- [ ] workspace 是 Mod 根目录，不是游戏安装根、它的父目录或原版资源目录
- [ ] base 目录里有 `sekiro.exe` 与 `oo2core_6_win64.dll`
- [ ] 两个路径都是绝对路径；CLI 会解析 Windows 联接点（Junction）
