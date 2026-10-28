//! The four host save commands (hostApiVersion 1): save_list / save_read / save_write / save_delete.
//! Location: %APPDATA%\BookToGame\Player\saves\<packageId>\<saveId>.json   (reserved id "index" = index.json)
//! Writes are atomic: <id>.json.tmp-<pid> → write → fsync → rename over the target (MoveFileExW REPLACE_EXISTING
//! via std::fs::rename). A crash mid-write leaves the previous complete file + a stray .tmp that list() ignores.
//! The player never interprets save JSON (no rules / no schema here — §7.6-11).

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const MAX_SAVE_BYTES: usize = 8 * 1024 * 1024;

fn valid_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        && !is_dos_device(id)
}

/// CON / PRN / AUX / NUL / COM1-9 / LPT1-9 are not regular files on Windows.
fn is_dos_device(id: &str) -> bool {
    let u = id.to_ascii_uppercase();
    matches!(u.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((u.starts_with("COM") || u.starts_with("LPT")) && u.len() == 4 && (b'1'..=b'9').contains(&u.as_bytes()[3]))
}

/// `%APPDATA%\BookToGame\Player\saves`
pub fn default_root() -> Result<PathBuf, String> {
    let appdata = std::env::var_os("APPDATA").ok_or_else(|| "APPDATA is not set".to_string())?;
    Ok(PathBuf::from(appdata).join("BookToGame").join("Player").join("saves"))
}

pub fn package_dir(root: &Path, package_id: &str) -> Result<PathBuf, String> {
    if !valid_id(package_id) {
        return Err("invalid package id".into());
    }
    Ok(root.join(package_id))
}

fn file_for(root: &Path, package_id: &str, save_id: &str) -> Result<PathBuf, String> {
    if !valid_id(save_id) {
        return Err("invalid save id".into());
    }
    Ok(package_dir(root, package_id)?.join(format!("{save_id}.json")))
}

/// Ids (file stems) in this package folder, including the reserved `index` when present;
/// ordering is the page's job (it reads index.json, X14).
pub fn list(root: &Path, package_id: &str) -> Result<Vec<String>, String> {
    let dir = package_dir(root, package_id)?;
    let entries = match fs::read_dir(&dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(vec![]),
        Err(e) => return Err(e.to_string()),
    };
    let mut ids = vec![];
    for entry in entries.flatten() {
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let Some(stem) = name.strip_suffix(".json") else { continue };
        if !valid_id(stem) {
            continue;
        }
        if entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
            ids.push(stem.to_string());
        }
    }
    ids.sort();
    Ok(ids)
}

pub fn read(root: &Path, package_id: &str, save_id: &str) -> Result<Option<String>, String> {
    let file = file_for(root, package_id, save_id)?;
    match fs::read(&file) {
        Ok(bytes) => Ok(Some(String::from_utf8_lossy(&bytes).into_owned())),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

pub fn write(root: &Path, package_id: &str, save_id: &str, json: &str) -> Result<(), String> {
    if json.len() > MAX_SAVE_BYTES {
        return Err("save too large".into());
    }
    let file = file_for(root, package_id, save_id)?;
    let dir = file.parent().ok_or("no parent")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{save_id}.json.tmp-{}", std::process::id()));
    let result = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
        drop(f);
        fs::rename(&tmp, &file)
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&tmp);
        return Err(e.to_string());
    }
    Ok(())
}

pub fn delete(root: &Path, package_id: &str, save_id: &str) -> Result<(), String> {
    let file = file_for(root, package_id, save_id)?;
    match fs::remove_file(file) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
