# btg-player · Windows 播放器（M1b-2）

薄 Tauri v2 外壳：读自身尾部（或同目录 `game.btgpkg.html`）里的 M1b-1 HTML，**原样**用自定义协议提供给 WebView2，
注入 `window.__BTG_HOST__`（`hostApiVersion: 1` + `save_list / save_read / save_write / save_delete`）。
无服务器、无 Node sidecar、无 SQLite、无安装器、无游戏规则代码、无网络（响应头 CSP + 禁止导航出 payload）。

作者机**不需要 Rust**：导出 = 预编译播放器 + HTML 原样 + 52 字节 footer（`BTGPKG01 | u64 LE len | sha256 | u32 LE hostApi`），
由 `apps/server/src/modules/exports/domain/exe-trailer.ts` 拼接。

## 在 Windows 构建机上构建（DESKTOP-BTSC7FP：Win10 22H2 · rustup/cargo · VS Build Tools 2022 C++ · WebView2）

只用已装的工具链，不全局安装任何东西，**不需要 tauri-cli**（无安装包，所以直接 `cargo build --release`；
`Cargo.toml` 里开了 `tauri/custom-protocol`，这就是正式构建）。不需要 Node。

| 项 | 值 |
|---|---|
| 项目目录 | `apps\player-host\`（仓库内） |
| 一条命令（仓库根执行） | `powershell -ExecutionPolicy Bypass -File apps\player-host\scripts\build-windows.ps1` |
| 可选冒烟包 | 同上加 `-SampleHtml "C:\…\雾渡-v1.html"` → `dist\player\sample-雾渡-v1.exe`（双击即玩，footer 与导出器一致） |
| cargo 产物 | `apps\player-host\target\release\btg-player.exe` |
| **交付产物** | `dist\player\btg-player-windows-x64.exe` + `dist\player\btg-player-windows-x64.json`（`{version, hostApiVersion, sha256, size, builtAt, rustc, target}`） |

首次构建会由 cargo 拉取 crates（需联网，进 cargo 缓存与 `target\`，都不进 git）。

## 拷回作者机（box）

把上面两个文件放到 **`/workspace/book-to-game/dist/player/`**（已在 `.gitignore`：`/dist/player/`、`dist/`）。
服务端默认就读 `dist/player/btg-player-windows-x64.exe`（可用环境变量 `BTG_WINDOWS_PLAYER` 覆盖）；
`.json` 旁置文件提供报告条里的「播放器 0.1.0 · 宿主接口 v1」。放好后作者页「导出 Windows 版」即可用（`GET /exports/targets`）。

## 不需要 Windows 也能跑的测试

```bash
bash apps/player-host/scripts/core-tests.sh [某个导出的.html]
```
只用 `rustc`（std-only，不下载 crate、不编 Tauri）：sha256 向量、footer 编解码/拒绝、尾部→旁置→N2、
存档原子写/隔离/id 校验、注入脚本形状、N1/N1b/N2 中英文案，以及**用 TS 导出器真实生成的 exe 让 Rust 解出字节一致的 payload**。

## 文件

| 文件 | 作用 |
|---|---|
| `src/main.rs` | 预检（Win10+ / WebView2）→ 定位 payload → 开窗（标题=游戏名，1280×800，最小 980×640）、`btg` 协议、4 个命令 |
| `src/payload.rs` | footer 解码、sha256 校验（不符 → `payloadIntact:false` → 页面「已损坏」页）、旁置 `game.btgpkg.html`、manifest 标题 |
| `src/saves.rs` | `%APPDATA%\BookToGame\Player\saves\<packageId>\<id>.json`；tmp + fsync + rename 原子写；id `[A-Za-z0-9_-]{1,128}`，拒 DOS 设备名 |
| `src/host_script.rs` | 注入的 `__BTG_HOST__`（唯一加到页面的东西，HTML 字节不变） |
| `src/native_text.rs` · `src/win.rs` | N1 / N1b / N2 原生弹窗（UI 规划 §5.3，按 Windows 界面语言 zh/en；MessageBoxW，N1 为 是/否） |
| `src/sha256.rs` | 无依赖 SHA-256 |
| `capabilities/player-saves.json` · `build.rs` | 页面只能调这 4 个命令；无任何插件 |
| `scripts/build-windows.ps1` | 上述一条命令构建 |
| `ci/player-windows.yml.draft` | 可选 GitHub Actions 草稿（不在 `.github/`，未启用） |

## 退出码

`3` = N1b（系统过旧）· `4` = N1（缺 WebView2）· `5` = N2（找不到游戏内容）。

## 状态

本目录在 Linux 作者机上**未编译过 Tauri 部分**（无 Windows 目标/MSVC）；std-only 核心已测。首次 Windows 构建若有 API 小出入，
集中在 `src/main.rs`（Tauri v2 builder）与 `src/win.rs`（windows-sys 0.59 签名）。
