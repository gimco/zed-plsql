//! Glue that starts the bundled language server (`server/plsql-lsp.js`).
//!
//! The server is a single dependency-free JavaScript file. It is embedded in
//! the extension, written to the extension's work directory and run with the
//! Node.js runtime that ships with Zed, so nothing has to be downloaded.

use std::{env, fs};

use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

const SERVER_NAME: &str = "plsql-lsp";
const SERVER_FILE: &str = "plsql-lsp.js";
const SERVER_SOURCE: &str = include_str!("../server/plsql-lsp.js");

struct PlsqlExtension {
    script_written: bool,
}

impl PlsqlExtension {
    /// Absolute path of the server script, (re)writing it when it is missing
    /// or belongs to another version of the extension.
    fn server_script(&mut self) -> Result<String> {
        let path = env::current_dir()
            .map_err(|e| format!("cannot find the extension work directory: {e}"))?
            .join(SERVER_FILE);
        if !self.script_written {
            if fs::read_to_string(&path).ok().as_deref() != Some(SERVER_SOURCE) {
                fs::write(&path, SERVER_SOURCE)
                    .map_err(|e| format!("cannot write {}: {e}", path.display()))?;
            }
            self.script_written = true;
        }
        Ok(path.to_string_lossy().into_owned())
    }
}

impl zed::Extension for PlsqlExtension {
    fn new() -> Self {
        Self {
            script_written: false,
        }
    }

    fn language_server_command(
        &mut self,
        _language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        // `"lsp": {"plsql-lsp": {"binary": {"path": ..., "arguments": [...]}}}`
        // in the settings replaces the bundled server (useful to hack on it).
        let binary = LspSettings::for_worktree(SERVER_NAME, worktree)
            .ok()
            .and_then(|settings| settings.binary);
        if let Some(path) = binary.as_ref().and_then(|b| b.path.clone()) {
            return Ok(zed::Command {
                command: path,
                args: binary.and_then(|b| b.arguments).unwrap_or_default(),
                env: Default::default(),
            });
        }

        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![self.server_script()?, "--stdio".to_string()],
            env: Default::default(),
        })
    }
}

zed::register_extension!(PlsqlExtension);
