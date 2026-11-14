# 绑定（复制本文件为 binding.md 后填写）

只写两个绝对路径，下面两行各占一行、冒号后留一个空格：

```text
workspace: <MOD_COPY_ABSOLUTE_PATH>
base:      <GAME_ROOT_ABSOLUTE_PATH>
```

- **workspace** 是 Mod 的**副本**目录，所有写入落在这里。不要指向真实 mods。
- **base** 是《只狼》**安装根**（其下直接是 `event/`、`param/`、`chr/`，并且有
  `sekiro.exe` 与 `oo2core_6_win64.dll`）。不要指向 `mods`。

`<MOD_COPY_ABSOLUTE_PATH>` 与 `<GAME_ROOT_ABSOLUTE_PATH>` 是占位符，替换成你自己的绝对路径
（例如 `<盘符>:\<你的副本目录>`、`<盘符>:\<游戏安装根>`）；本文件不含任何真实机器路径。

检查清单：

- [ ] workspace 是指向副本的目录，不是 `<base>\mods`
- [ ] workspace 路径里不含 `sekiro.exe`
- [ ] base 目录里有 `sekiro.exe` 与 `oo2core_6_win64.dll`
- [ ] 两个路径都是绝对路径，且拼写统一（不要混用 junction 与真实路径）
