//! Windows-only: OS version, UI language, native message boxes, opening the WebView2 download page.
//! Uses MessageBoxW (UI plan §3.3 allows it as the TaskDialog fallback: Yes/No + trailing question for N1).
#![cfg(windows)]

use crate::native_text::{Dialog, Lang};
use windows_sys::Win32::Globalization::GetUserDefaultUILanguage;
use windows_sys::Win32::System::SystemInformation::OSVERSIONINFOW;
use windows_sys::Win32::UI::Shell::ShellExecuteW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    MessageBoxW, IDYES, MB_ICONERROR, MB_ICONWARNING, MB_OK, MB_SETFOREGROUND, MB_YESNO, SW_SHOWNORMAL,
};

pub enum Icon {
    Warning,
    Error,
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

pub fn ui_lang() -> Lang {
    // PRIMARYLANGID(langid) == LANG_CHINESE (0x04) → zh-*
    let id = unsafe { GetUserDefaultUILanguage() };
    if id & 0x3ff == 0x04 { Lang::Zh } else { Lang::En }
}

#[link(name = "ntdll")]
extern "system" {
    fn RtlGetVersion(info: *mut OSVERSIONINFOW) -> i32;
}

/// RtlGetVersion is not subject to the GetVersionEx manifest shim, so Win8.1 can't masquerade as 10.
pub fn is_windows_10_or_later() -> bool {
    let mut info: OSVERSIONINFOW = unsafe { std::mem::zeroed() };
    info.dwOSVersionInfoSize = std::mem::size_of::<OSVERSIONINFOW>() as u32;
    let ok = unsafe { RtlGetVersion(&mut info) } == 0;
    !ok || info.dwMajorVersion >= 10
}

/// Returns true when the user picked Yes (only meaningful for dialogs with a question).
pub fn show(d: &Dialog, icon: Icon) -> bool {
    let mut text = format!("{}\n\n{}", d.main, d.body);
    if let Some(q) = d.question {
        text.push_str("\n\n");
        text.push_str(q);
    }
    let buttons = if d.question.is_some() { MB_YESNO } else { MB_OK };
    let icon = match icon {
        Icon::Warning => MB_ICONWARNING,
        Icon::Error => MB_ICONERROR,
    };
    let (t, c) = (wide(&text), wide(&d.title));
    unsafe { MessageBoxW(std::ptr::null_mut(), t.as_ptr(), c.as_ptr(), buttons | icon | MB_SETFOREGROUND) == IDYES }
}

pub fn open_url(url: &str) {
    let (op, u) = (wide("open"), wide(url));
    unsafe {
        ShellExecuteW(std::ptr::null_mut(), op.as_ptr(), u.as_ptr(), std::ptr::null(), std::ptr::null(), SW_SHOWNORMAL);
    }
}
