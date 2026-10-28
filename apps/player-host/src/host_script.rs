//! The initialization script injected before the page's own scripts (WebView2 AddScriptToExecuteOnDocumentCreated).
//! It is the ONLY thing added to the page; the payload HTML itself is served byte-for-byte.
//! Shape = packages/play-runtime/src/package/host-api.ts `BtgHost`.

use crate::payload::{Payload, Source};

pub fn build(p: &Payload) -> String {
    let source = match p.source {
        Source::Trailer => "trailer",
        Source::Sidecar => "sidecar",
    };
    format!(
        r#"(function () {{
  var invoke = function (cmd, args) {{ return window.__TAURI_INTERNALS__.invoke(cmd, args); }};
  var host = Object.freeze({{
    hostApiVersion: {ver},
    payloadHostApiVersion: {payload_ver},
    payloadIntact: {intact},
    payloadSource: "{source}",
    saveList: function (packageId) {{ return invoke("save_list", {{ packageId: packageId }}); }},
    saveRead: function (packageId, saveId) {{ return invoke("save_read", {{ packageId: packageId, saveId: saveId }}); }},
    saveWrite: function (packageId, saveId, json) {{ return invoke("save_write", {{ packageId: packageId, saveId: saveId, json: json }}).then(function () {{}}); }},
    saveDelete: function (packageId, saveId) {{ return invoke("save_delete", {{ packageId: packageId, saveId: saveId }}).then(function () {{}}); }}
  }});
  Object.defineProperty(window, "__BTG_HOST__", {{ value: host, writable: false, configurable: false, enumerable: false }});
}})();"#,
        ver = crate::payload::HOST_API_VERSION,
        payload_ver = p.host_api_version,
        intact = if p.intact { "true" } else { "false" },
        source = source,
    )
}
