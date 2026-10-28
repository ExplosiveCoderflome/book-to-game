//! Native dialog strings (UI plan §5.3). Not `t()`: the page is not running yet. zh-* UI language → zh, else en (X9).

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Lang {
    Zh,
    En,
}

pub const WEBVIEW2_DOWNLOAD_URL: &str = "https://developer.microsoft.com/microsoft-edge/webview2/";

pub struct Dialog {
    pub title: String,
    pub main: &'static str,
    pub body: &'static str,
    /// MessageBox fallback appends this question and uses Yes/No (N1 only).
    pub question: Option<&'static str>,
}

/// N1 · WebView2 missing (Win10/11).
pub fn n1(lang: Lang, game: &str) -> Dialog {
    match lang {
        Lang::Zh => Dialog {
            title: format!("{game} 无法启动"),
            main: "需要 Microsoft Edge WebView2",
            body: "这台电脑没有找到 Microsoft Edge WebView2 运行时，游戏没有启动，也没有改动任何文件。Windows 11 自带它；Windows 10 可以从微软官网免费安装，装好后再双击本游戏。",
            question: Some("要现在打开微软的下载页吗？"),
        },
        Lang::En => Dialog {
            title: format!("{game} can't start"),
            main: "Microsoft Edge WebView2 is required",
            body: "This PC doesn't have the Microsoft Edge WebView2 Runtime, so the game didn't start and nothing was changed. Windows 11 includes it; on Windows 10 you can install it free from Microsoft, then double-click the game again.",
            question: Some("Open Microsoft's download page now?"),
        },
    }
}

/// N1b · Windows 7 / 8 / 8.1.
pub fn n1b(lang: Lang, game: &str) -> Dialog {
    match lang {
        Lang::Zh => Dialog {
            title: format!("{game} 无法启动"),
            main: "需要 Windows 10 或 11",
            body: "这个游戏需要 Windows 10 或 11（64 位）。这台电脑的系统版本不受支持，游戏没有启动。可以请作者发一份网页版（.html），用浏览器打开就能玩。",
            question: None,
        },
        Lang::En => Dialog {
            title: format!("{game} can't start"),
            main: "Windows 10 or 11 is required",
            body: "This game needs Windows 10 or 11 (64-bit). This PC's Windows version isn't supported, so the game didn't start. Ask the author for the web version (.html) and open it in a browser.",
            question: None,
        },
    }
}

/// N2 · no payload and no sidecar. Title uses the exe file name (no manifest to read).
pub fn n2(lang: Lang, exe_file_name: &str) -> Dialog {
    match lang {
        Lang::Zh => Dialog {
            title: format!("{exe_file_name} 无法启动"),
            main: "找不到游戏内容",
            body: "这个程序里没有游戏内容，同一文件夹里也没有 game.btgpkg.html，游戏没有启动。请向作者重新要一份完整的文件。",
            question: None,
        },
        Lang::En => Dialog {
            title: format!("{exe_file_name} can't start"),
            main: "Game content not found",
            body: "This program has no game content, and there's no game.btgpkg.html next to it, so the game didn't start. Ask the author for a complete copy.",
            question: None,
        },
    }
}
