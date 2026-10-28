//! Where the game HTML comes from (UI plan §2.2, slice §5 X3):
//!   1. our own exe tail: [player][payload = M1b-1 HTML, byte-for-byte][52-byte footer]
//!   2. else `game.btgpkg.html` next to the exe (dev / "sidecar" mode, no hash in footer)
//!   3. else N2「找不到游戏内容」.
//! Footer (must match packages/play-runtime/src/package/host-api.ts + server exe-trailer.ts):
//!   magic "BTGPKG01" (8) | payloadLength u64 LE (8) | sha256(payload) raw (32) | hostApiVersion u32 LE (4)
//! The player never parses, rewrites or re-encodes the payload; it only serves the bytes.

use std::path::Path;

pub const MAGIC: &[u8; 8] = b"BTGPKG01";
pub const TRAILER_LEN: usize = 52;
pub const SIDECAR_FILE: &str = "game.btgpkg.html";
/// Host API implemented by THIS player build. The page refuses versions it does not list.
pub const HOST_API_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trailer {
    pub payload_offset: usize,
    pub payload_length: usize,
    pub payload_sha256: [u8; 32],
    pub host_api_version: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Source {
    Trailer,
    Sidecar,
}

#[derive(Debug)]
pub struct Payload {
    pub html: Vec<u8>,
    pub source: Source,
    /// false ⇒ sha256 in the footer does not match ⇒ the page shows the M1b-1「已损坏」page (no native box).
    pub intact: bool,
    /// hostApiVersion the exporter stamped in the footer (sidecar: assumed = ours).
    pub host_api_version: u32,
}

impl Payload {
    /// Runtime check of the footer's hostApiVersion against this player's own. A mismatch does NOT block
    /// the game (UI plan §2.3: 「宿主接口版本不认 → host-fallback + Banner」, not a native dialog — N1b is only
    /// for Win7/8/8.1): the page receives both numbers and switches to its temporary-location storage itself.
    pub fn host_compatible(&self) -> bool {
        self.host_api_version == HOST_API_VERSION
    }
}

/// `None` = no (valid) footer. Never panics on short / hostile input.
pub fn decode_trailer(file: &[u8]) -> Option<Trailer> {
    if file.len() < TRAILER_LEN {
        return None;
    }
    let footer = &file[file.len() - TRAILER_LEN..];
    if &footer[0..8] != MAGIC {
        return None;
    }
    let len = u64::from_le_bytes(footer[8..16].try_into().ok()?);
    let max = (file.len() - TRAILER_LEN) as u64;
    if len == 0 || len > max {
        return None;
    }
    let mut sha = [0u8; 32];
    sha.copy_from_slice(&footer[16..48]);
    let ver = u32::from_le_bytes(footer[48..52].try_into().ok()?);
    let length = len as usize;
    Some(Trailer {
        payload_offset: file.len() - TRAILER_LEN - length,
        payload_length: length,
        payload_sha256: sha,
        host_api_version: ver,
    })
}

pub fn from_exe_bytes(file: &[u8]) -> Option<Payload> {
    let t = decode_trailer(file)?;
    let html = file[t.payload_offset..t.payload_offset + t.payload_length].to_vec();
    let intact = crate::sha256::digest(&html) == t.payload_sha256;
    Some(Payload { html, source: Source::Trailer, intact, host_api_version: t.host_api_version })
}

/// Resolve the payload for the running exe. `None` ⇒ caller shows N2 and exits ≠ 0.
pub fn locate(exe_path: &Path) -> Option<Payload> {
    if let Ok(bytes) = std::fs::read(exe_path) {
        if let Some(p) = from_exe_bytes(&bytes) {
            return Some(p);
        }
    }
    let sidecar = exe_path.parent()?.join(SIDECAR_FILE);
    let html = std::fs::read(sidecar).ok()?;
    if html.is_empty() {
        return None;
    }
    Some(Payload { html, source: Source::Sidecar, intact: true, host_api_version: HOST_API_VERSION })
}

/// Title for the window / N1 box: `btg-manifest` → `title`; else None (caller uses the exe stem).
/// A deliberately small scan — the page itself does the real manifest validation.
pub fn manifest_title(html: &[u8]) -> Option<String> {
    let text = std::str::from_utf8(html).ok()?;
    let start = text.find("id=\"btg-manifest\"")?;
    let open_end = start + text[start..].find('>')? + 1;
    let close = open_end + text[open_end..].find("</script>")?;
    let json = &text[open_end..close];
    let key = json.find("\"title\"")?;
    let rest = &json[key + 7..];
    let colon = rest.find(':')?;
    let rest = rest[colon + 1..].trim_start();
    let rest = rest.strip_prefix('"')?;
    let mut out = String::new();
    let mut chars = rest.chars();
    while let Some(c) = chars.next() {
        match c {
            '"' => return if out.trim().is_empty() { None } else { Some(out) },
            '\\' => match chars.next()? {
                'n' | 'r' | 't' => out.push(' '),
                'u' => {
                    let code: String = chars.by_ref().take(4).collect();
                    let cp = u32::from_str_radix(&code, 16).ok()?;
                    // \u003c-style escapes (the exporter escapes `<`) and BMP chars; surrogate pairs → skip.
                    if let Some(ch) = char::from_u32(cp) {
                        out.push(ch);
                    }
                }
                other => out.push(other),
            },
            c => out.push(c),
        }
    }
    None
}
