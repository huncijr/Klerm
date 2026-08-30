use serde::Serialize;
use serde_json::Value;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct BackendProcess {
    child: Child,
    stdin: Option<ChildStdin>,
}

impl Drop for BackendProcess {
    fn drop(&mut self) {
        self.stdin.take();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            match self.child.try_wait() {
                Ok(Some(_)) => return,
                Ok(None) => std::thread::sleep(Duration::from_millis(25)),
                Err(_) => break,
            }
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[derive(Default)]
struct BackendState {
    process: Mutex<Option<BackendProcess>>,
}

impl BackendState {
    fn stop(&self) {
        let process = self
            .process
            .lock()
            .ok()
            .and_then(|mut process| process.take());
        drop(process);
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BackendStartResult {
    already_running: bool,
    cwd: String,
}

#[derive(Clone, Serialize)]
struct BackendErrorPayload {
    message: String,
}

#[derive(Clone, Serialize)]
struct BackendExitPayload {
    code: Option<i32>,
}

fn rpc_entry_path() -> PathBuf {
    if let Some(path) = env::var_os("KLERM_DESKTOP_RPC_ENTRY") {
        return PathBuf::from(path);
    }
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../coding-agent/dist/rpc-entry.js")
}

fn default_working_directory() -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("KLERM_DESKTOP_CWD") {
        return Ok(PathBuf::from(path));
    }
    if cfg!(debug_assertions) {
        return Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../"));
    }
    env::current_dir().map_err(|error| format!("Could not resolve the working directory: {error}"))
}

#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
    cwd: Option<String>,
) -> Result<BackendStartResult, String> {
    let mut process_guard = state
        .process
        .lock()
        .map_err(|_| "Backend process state is unavailable.".to_string())?;

    if let Some(process) = process_guard.as_mut() {
        match process.child.try_wait() {
            Ok(None) => {
                return Ok(BackendStartResult {
                    already_running: true,
                    cwd: cwd.unwrap_or_else(|| ".".to_string()),
                });
            }
            Ok(Some(_)) => {
                process_guard.take();
            }
            Err(error) => return Err(format!("Could not inspect the Klerm backend: {error}")),
        }
    }

    let entry_path = rpc_entry_path();
    if !entry_path.is_file() {
        return Err(format!(
            "Klerm RPC entry was not built at {}. Run the desktop command from the harness workspace.",
            entry_path.display()
        ));
    }

    let working_directory = match cwd {
        Some(path) => PathBuf::from(path),
        None => default_working_directory()?,
    };
    if !working_directory.is_dir() {
        return Err(format!(
            "The Klerm working directory does not exist: {}",
            working_directory.display()
        ));
    }

    let node = env::var_os("KLERM_DESKTOP_NODE").unwrap_or_else(|| "node".into());
    let mut command = Command::new(node);
    command
        .arg(&entry_path)
        .current_dir(&working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    command.creation_flags(CREATE_NO_WINDOW);

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the Klerm backend: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Klerm backend stdin is unavailable.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Klerm backend stdout is unavailable.".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Klerm backend stderr is unavailable.".to_string())?;

    let stdout_app = app.clone();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            match line {
                Ok(line) if !line.trim().is_empty() => match serde_json::from_str::<Value>(&line) {
                    Ok(message) => {
                        let _ = stdout_app.emit("klerm://rpc", message);
                    }
                    Err(_) => {
                        let _ = stdout_app.emit(
                            "klerm://backend-error",
                            BackendErrorPayload {
                                message: "Klerm emitted an invalid RPC record.".to_string(),
                            },
                        );
                    }
                },
                Ok(_) => {}
                Err(error) => {
                    let _ = stdout_app.emit(
                        "klerm://backend-error",
                        BackendErrorPayload {
                            message: format!("Klerm RPC output failed: {error}"),
                        },
                    );
                    break;
                }
            }
        }
        let _ = stdout_app.emit("klerm://backend-exit", BackendExitPayload { code: None });
    });

    let stderr_app = app;
    std::thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            if !line.trim().is_empty() {
                let _ = stderr_app.emit(
                    "klerm://backend-error",
                    BackendErrorPayload { message: line },
                );
            }
        }
    });

    *process_guard = Some(BackendProcess {
        child,
        stdin: Some(stdin),
    });
    Ok(BackendStartResult {
        already_running: false,
        cwd: working_directory.display().to_string(),
    })
}

#[tauri::command]
fn rpc_send(state: State<'_, BackendState>, command: Value) -> Result<(), String> {
    if !command.is_object() {
        return Err("RPC command must be a JSON object.".to_string());
    }
    let mut process_guard = state
        .process
        .lock()
        .map_err(|_| "Backend process state is unavailable.".to_string())?;
    let process = process_guard
        .as_mut()
        .ok_or_else(|| "Klerm backend is not running.".to_string())?;
    let mut line = serde_json::to_vec(&command)
        .map_err(|error| format!("Could not serialize RPC command: {error}"))?;
    line.push(b'\n');
    let stdin = process
        .stdin
        .as_mut()
        .ok_or_else(|| "Klerm backend stdin is unavailable.".to_string())?;
    stdin
        .write_all(&line)
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Could not send command to Klerm: {error}"))
}

#[tauri::command]
fn stop_backend(state: State<'_, BackendState>) {
    state.stop();
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState::default())
        .invoke_handler(tauri::generate_handler![
            start_backend,
            rpc_send,
            stop_backend
        ])
        .build(tauri::generate_context!())
        .expect("failed to build Klerm desktop application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<BackendState>().stop();
        }
    });
}
