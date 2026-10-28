//! std-only unit tests for the player core (payload/trailer, saves, host script, sha256, native text).
//! Runs on any host without crates or a Windows toolchain:
//!   rustc --edition 2021 --test tests-std/core_tests.rs -o /tmp/btg-core-tests && /tmp/btg-core-tests
//! Optional cross-language check: BTG_TS_EXE=<exe built by the TS exporter> (see scripts/core-tests.sh).

#[path = "../src/sha256.rs"]
mod sha256;
#[path = "../src/payload.rs"]
mod payload;
#[path = "../src/saves.rs"]
mod saves;
#[path = "../src/host_script.rs"]
mod host_script;
#[path = "../src/native_text.rs"]
mod native_text;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn build_exe(player: &[u8], html: &[u8], ver: u32) -> Vec<u8> {
    let mut v = player.to_vec();
    v.extend_from_slice(html);
    v.extend_from_slice(payload::MAGIC);
    v.extend_from_slice(&(html.len() as u64).to_le_bytes());
    v.extend_from_slice(&sha256::digest(html));
    v.extend_from_slice(&ver.to_le_bytes());
    v
}

fn tmpdir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("btg-core-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

#[test]
fn sha256_known_vectors() {
    assert_eq!(hex(&sha256::digest(b"")), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    assert_eq!(hex(&sha256::digest(b"abc")), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    let long = vec![b'a'; 1_000_000];
    assert_eq!(hex(&sha256::digest(&long)), "cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0");
}

#[test]
fn trailer_round_trip_and_rejects() {
    let html = "<!doctype html><script id=\"btg-manifest\" type=\"application/json\">{\"formatVersion\":1,\"title\":\"雾渡 \\u003c测试\\u003e\"}</script>".as_bytes();
    let exe = build_exe(b"MZ\x90\x00fake-player", html, 1);
    let t = payload::decode_trailer(&exe).expect("trailer");
    assert_eq!(t.payload_offset, 15);
    assert_eq!(t.payload_length, html.len());
    assert_eq!(t.host_api_version, 1);
    let p = payload::from_exe_bytes(&exe).unwrap();
    assert_eq!(p.html, html, "payload byte-for-byte");
    assert!(p.intact);
    assert_eq!(payload::manifest_title(&p.html).as_deref(), Some("雾渡 <测试>"));

    let mut tampered = exe.clone();
    tampered[20] ^= 1;
    assert!(!payload::from_exe_bytes(&tampered).unwrap().intact, "sha mismatch ⇒ corrupt page, not N2");

    assert!(payload::decode_trailer(b"MZ").is_none());
    assert!(payload::decode_trailer(&exe[..exe.len() - 1]).is_none());
    let mut zero = build_exe(b"MZ", b"x", 1);
    let n = zero.len();
    zero[n - 44..n - 36].copy_from_slice(&0u64.to_le_bytes());
    assert!(payload::decode_trailer(&zero).is_none(), "length 0");
    let mut huge = build_exe(b"MZ", b"x", 1);
    huge[n - 44..n - 36].copy_from_slice(&u64::MAX.to_le_bytes());
    assert!(payload::decode_trailer(&huge).is_none(), "length > file");
}

#[test]
fn locate_trailer_then_sidecar_then_none() {
    let dir = tmpdir("locate");
    let exe = dir.join("game.exe");
    std::fs::write(&exe, b"MZ plain player, no trailer").unwrap();
    assert!(payload::locate(&exe).is_none(), "N2");
    std::fs::write(dir.join(payload::SIDECAR_FILE), b"<html>side</html>").unwrap();
    let p = payload::locate(&exe).unwrap();
    assert_eq!(p.source, payload::Source::Sidecar);
    assert_eq!(p.html, b"<html>side</html>");
    std::fs::write(&exe, build_exe(b"MZ", b"<html>tail</html>", 1)).unwrap();
    let p = payload::locate(&exe).unwrap();
    assert_eq!(p.source, payload::Source::Trailer, "own tail wins over sidecar");
    assert_eq!(p.html, b"<html>tail</html>");
}

#[test]
fn saves_atomic_isolated_and_validated() {
    let root = tmpdir("saves");
    assert_eq!(saves::list(&root, "pkgA").unwrap(), Vec::<String>::new());
    saves::write(&root, "pkgA", "s-1", "{\"a\":1}").unwrap();
    saves::write(&root, "pkgA", "index", "[\"s-1\"]").unwrap();
    saves::write(&root, "pkgA", "s-1", "{\"a\":2}").unwrap();
    saves::write(&root, "pkgB", "s-1", "{\"b\":1}").unwrap();
    std::fs::write(root.join("pkgA").join("s-1.json.tmp-999"), "{\"half").unwrap(); // crashed writer leftover
    assert_eq!(saves::list(&root, "pkgA").unwrap(), vec!["index".to_string(), "s-1".to_string()]);
    assert_eq!(saves::read(&root, "pkgA", "s-1").unwrap().as_deref(), Some("{\"a\":2}"));
    assert_eq!(saves::read(&root, "pkgB", "s-1").unwrap().as_deref(), Some("{\"b\":1}"), "games don't mix");
    assert_eq!(saves::read(&root, "pkgA", "nope").unwrap(), None);
    saves::delete(&root, "pkgA", "s-1").unwrap();
    saves::delete(&root, "pkgA", "s-1").unwrap();
    assert_eq!(saves::read(&root, "pkgA", "s-1").unwrap(), None);
    for bad in ["../x", "a/b", "a\\b", "", "con.json", "CON", "lpt1", &"x".repeat(129)] {
        assert!(saves::write(&root, "pkgA", bad, "{}").is_err(), "save id {bad:?}");
        assert!(saves::list(&root, bad).is_err(), "package id {bad:?}");
    }
    assert!(!root.join("x.json").exists());
}

#[test]
fn host_script_shape() {
    let p = payload::Payload { html: vec![], source: payload::Source::Trailer, intact: false, host_api_version: 1 };
    let s = host_script::build(&p);
    for needle in ["hostApiVersion: 1", "payloadHostApiVersion: 1", "payloadIntact: false", "\"trailer\"", "\"save_list\"", "\"save_read\"", "\"save_write\"", "\"save_delete\"", "__BTG_HOST__"] {
        assert!(s.contains(needle), "{needle}");
    }
}

#[test]
fn host_api_version_checked_at_runtime() {
    let ok = payload::from_exe_bytes(&build_exe(b"MZ", b"<html>", payload::HOST_API_VERSION)).unwrap();
    assert!(ok.host_compatible());
    let other = payload::from_exe_bytes(&build_exe(b"MZ", b"<html>", payload::HOST_API_VERSION + 1)).unwrap();
    assert!(!other.host_compatible());
    let s = host_script::build(&other);
    assert!(s.contains(&format!("hostApiVersion: {}", payload::HOST_API_VERSION)));
    assert!(s.contains(&format!("payloadHostApiVersion: {}", payload::HOST_API_VERSION + 1)), "page gets both ⇒ host-fallback");
}

#[test]
fn native_text_both_languages() {
    use native_text::*;
    assert_eq!(n1(Lang::Zh, "雾渡").title, "雾渡 无法启动");
    assert_eq!(n1(Lang::En, "Fog").title, "Fog can't start");
    assert!(n1(Lang::Zh, "x").question.is_some());
    assert!(n1b(Lang::Zh, "x").question.is_none(), "N1b gives no download link");
    assert_eq!(n2(Lang::Zh, "雾渡-v1.exe").main, "找不到游戏内容");
    assert!(n2(Lang::En, "a.exe").body.contains("game.btgpkg.html"));
}

/// Cross-language: an exe produced by the TS exporter (apps/server exe-trailer.ts) decodes here byte-for-byte.
#[test]
fn ts_exporter_exe_decodes() {
    let Ok(path) = std::env::var("BTG_TS_EXE") else { return };
    let exe = std::fs::read(&path).unwrap();
    let p = payload::from_exe_bytes(&exe).expect("TS trailer readable by Rust");
    assert!(p.intact);
    if let Ok(html_path) = std::env::var("BTG_TS_HTML") {
        assert_eq!(p.html, std::fs::read(html_path).unwrap(), "payload == exported HTML");
    }
    assert_eq!(p.host_api_version, payload::HOST_API_VERSION);
}
