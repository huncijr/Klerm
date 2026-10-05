use serde::Serialize;
use serde_json::Value;
#[cfg(target_os = "linux")]
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Listener, Manager, State};
mod runtime;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

struct BackendProcess {
    child: Child,
    stdin: Option<ChildStdin>,
    cwd: PathBuf,
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

#[cfg(target_os = "linux")]
struct BrowserHost {
    child: Child,
    stdin: ChildStdin,
    port: u16,
}

#[cfg(target_os = "linux")]
impl Drop for BrowserHost {
    fn drop(&mut self) {
        let _ = self.stdin.write_all(b"{\"type\":\"close\"}\n");
        let _ = self.stdin.flush();
        let deadline = Instant::now() + Duration::from_secs(2);
        while Instant::now() < deadline {
            if matches!(self.child.try_wait(), Ok(Some(_))) {
                return;
            }
            std::thread::sleep(Duration::from_millis(25));
        }
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(target_os = "linux")]
#[derive(Default)]
struct BrowserHostState {
    hosts: Mutex<HashMap<String, BrowserHost>>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserHostEvent {
    session_id: String,
    event: Value,
}

#[cfg(target_os = "linux")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserHostStartResult {
    cdp_url: String,
}

#[cfg(target_os = "linux")]
fn valid_browser_session_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn start_browser_host(
    app: AppHandle,
    state: State<'_, BrowserHostState>,
    session_id: String,
) -> Result<BrowserHostStartResult, String> {
    if !valid_browser_session_id(&session_id) {
        return Err("Invalid browser session id.".into());
    }
    let mut hosts = state
        .hosts
        .lock()
        .map_err(|_| "Browser host state is unavailable.")?;
    if let Some(host) = hosts.get_mut(&session_id) {
        if matches!(host.child.try_wait(), Ok(None)) {
            return Ok(BrowserHostStartResult {
                cdp_url: format!("http://127.0.0.1:{}", host.port),
            });
        }
    }
    hosts.remove(&session_id);
    let executable = env::current_exe()
        .map_err(|error| format!("Browser host path unavailable: {error}"))?
        .with_file_name("klerm-browser-host");
    if !executable.is_file() {
        return Err(
            "CEF browser host has not been built. Build the Klerm desktop browser host first."
                .into(),
        );
    }
    let cef_dir = executable
        .parent()
        .ok_or("CEF runtime directory is unavailable.")?;
    let mut libraries = vec![cef_dir.to_path_buf()];
    if let Some(existing) = env::var_os("LD_LIBRARY_PATH") {
        libraries.extend(env::split_paths(&existing));
    }
    let library_path = env::join_paths(libraries).map_err(|_| "CEF runtime path is invalid.")?;
    let mut child = Command::new(executable)
        .env("LD_LIBRARY_PATH", library_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("CEF browser host did not start: {error}"))?;
    let stdin = child.stdin.take().ok_or("CEF browser input unavailable.")?;
    let stdout = child
        .stdout
        .take()
        .ok_or("CEF browser output unavailable.")?;
    let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
    let reader_session = session_id.clone();
    std::thread::spawn(move || {
        let mut ready = Some(ready_tx);
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let Ok(event) = serde_json::from_str::<Value>(&line) else {
                continue;
            };
            if event.get("type").and_then(Value::as_str) == Some("ready") {
                if let Some(tx) = ready.take() {
                    let port = event
                        .get("port")
                        .and_then(Value::as_u64)
                        .filter(|port| (1..=65535).contains(port));
                    let _ = tx.send(port.map(|port| port as u16));
                }
            }
            let _ = app.emit(
                "klerm://browser-host",
                BrowserHostEvent {
                    session_id: reader_session.clone(),
                    event,
                },
            );
        }
        if let Some(tx) = ready {
            let _ = tx.send(None);
        }
        let _ = app.emit(
            "klerm://browser-host",
            BrowserHostEvent {
                session_id: reader_session,
                event: serde_json::json!({"type":"crash"}),
            },
        );
    });
    let Some(port) = ready_rx
        .recv_timeout(Duration::from_secs(20))
        .ok()
        .flatten()
    else {
        let _ = child.kill();
        let _ = child.wait();
        return Err("CEF browser did not report readiness.".into());
    };
    hosts.insert(session_id, BrowserHost { child, stdin, port });
    Ok(BrowserHostStartResult {
        cdp_url: format!("http://127.0.0.1:{port}"),
    })
}

#[cfg(target_os = "linux")]
#[tauri::command]
fn browser_host_command(
    state: State<'_, BrowserHostState>,
    session_id: String,
    command: Value,
) -> Result<(), String> {
    if !valid_browser_session_id(&session_id) {
        return Err("Invalid browser session id.".into());
    }
    let kind = command.get("type").and_then(Value::as_str).unwrap_or("");
    if ![
        "resize", "navigate", "back", "forward", "reload", "visible", "mouse", "key",
    ]
    .contains(&kind)
    {
        return Err("Invalid browser host command.".into());
    }
    let mut data = serde_json::to_vec(&command).map_err(|_| "Invalid browser host command.")?;
    if data.len() > 4096 {
        return Err("Browser host command is too large.".into());
    }
    data.push(b'\n');
    let mut hosts = state
        .hosts
        .lock()
        .map_err(|_| "Browser host state is unavailable.")?;
    let host = hosts
        .get_mut(&session_id)
        .ok_or("Browser host is not running.")?;
    host.stdin
        .write_all(&data)
        .and_then(|_| host.stdin.flush())
        .map_err(|error| format!("CEF browser input failed: {error}"))
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

fn default_working_directory(app: &AppHandle) -> Result<PathBuf, String> {
    if let Some(path) = env::var_os("KLERM_DESKTOP_CWD") {
        return Ok(PathBuf::from(path));
    }
    if cfg!(debug_assertions) {
        return Ok(Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../"));
    }
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Could not resolve the workspace directory: {error}"))?
        .join("workspace");
    std::fs::create_dir_all(&directory)
        .map_err(|error| format!("Could not create the workspace directory: {error}"))?;
    Ok(directory)
}

fn workspace_store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("Could not resolve the Klerm config directory: {error}"))?;
    Ok(config_dir.join("workspace.txt"))
}

fn read_stored_workspace(app: &AppHandle) -> Option<PathBuf> {
    let path = workspace_store_path(app).ok()?;
    let stored = std::fs::read_to_string(path).ok()?;
    let trimmed = stored.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(PathBuf::from(trimmed))
    }
}

fn store_workspace(app: &AppHandle, working_directory: &Path) {
    let Ok(path) = workspace_store_path(app) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(path, working_directory.display().to_string());
}

#[tauri::command]
fn start_backend(
    app: AppHandle,
    state: State<'_, BackendState>,
    cwd: Option<String>,
    trusted: Option<bool>,
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
                    cwd: process.cwd.display().to_string(),
                });
            }
            Ok(Some(_)) => {
                process_guard.take();
            }
            Err(error) => return Err(format!("Could not inspect the Klerm backend: {error}")),
        }
    }

    let resources = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not resolve packaged resources: {error}"))?;
    let launch = runtime::backend_launch(
        &resources,
        Path::new(env!("CARGO_MANIFEST_DIR")),
        cfg!(debug_assertions),
        env::var_os("KLERM_DESKTOP_NODE").map(PathBuf::from),
        env::var_os("KLERM_DESKTOP_RPC_ENTRY").map(PathBuf::from),
    )?;

    let working_directory = match cwd {
        Some(path) => PathBuf::from(path),
        None => match read_stored_workspace(&app) {
            Some(directory) if directory.is_dir() => directory,
            _ => default_working_directory(&app)?,
        },
    };
    if !working_directory.is_dir() {
        return Err(format!(
            "The Klerm working directory does not exist: {}",
            working_directory.display()
        ));
    }
    store_workspace(&app, &working_directory);

    let mut command = Command::new(&launch.node);
    command
        .arg(&launch.entry)
        .env(
            "PATH",
            runtime::node_search_path(&launch.node, env::var_os("PATH"))?,
        )
        .current_dir(&working_directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(trusted) = trusted {
        command.arg(if trusted { "--approve" } else { "--no-approve" });
    }
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
        cwd: working_directory.clone(),
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

#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn start_browser_host() -> Result<(), String> {
    Err("The embedded CEF Browser currently requires Linux. Coding, Personal Agents and Kanban are available on this platform.".into())
}

#[cfg(not(target_os = "linux"))]
#[tauri::command]
fn browser_host_command() -> Result<(), String> {
    Err("The embedded CEF Browser currently requires Linux.".into())
}

pub fn run() {
    let smoke_report = if env::args().any(|arg| arg == "--startup-smoke") {
        Some(PathBuf::from(
            env::var_os("KLERM_DESKTOP_SMOKE_REPORT")
                .expect("startup smoke requires a report path"),
        ))
    } else {
        None
    };
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(BackendState::default())
        .setup(move |app| {
            if let Some(report) = smoke_report.clone() {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    let result = startup_smoke(&handle);
                    let code = if result.is_ok() { 0 } else { 1 };
                    let payload = match result {
                        Ok(value) => value,
                        Err(error) => serde_json::json!({"ready":false,"error":error}),
                    };
                    if std::fs::write(report, payload.to_string()).is_err() {
                        handle.exit(1);
                    } else {
                        handle.exit(code);
                    }
                });
            }
            Ok(())
        });
    #[cfg(target_os = "linux")]
    let builder =
        builder
            .manage(BrowserHostState::default())
            .invoke_handler(tauri::generate_handler![
                start_backend,
                rpc_send,
                stop_backend,
                start_browser_host,
                browser_host_command,
            ]);
    #[cfg(not(target_os = "linux"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        start_backend,
        rpc_send,
        stop_backend,
        start_browser_host,
        browser_host_command
    ]);
    let app = builder
        .build(tauri::generate_context!())
        .expect("failed to build Klerm desktop application");

    app.run(|app_handle, event| {
        if matches!(event, tauri::RunEvent::Exit) {
            app_handle.state::<BackendState>().stop();
            #[cfg(target_os = "linux")]
            app_handle
                .state::<BrowserHostState>()
                .hosts
                .lock()
                .ok()
                .map(|mut hosts| hosts.clear());
        }
    });
}

fn startup_smoke(app: &AppHandle) -> Result<Value, String> {
    if app.get_webview_window("main").is_none() {
        return Err("The native Klerm window was not created.".into());
    }
    let (sender, receiver) = std::sync::mpsc::sync_channel(1);
    let listener = app.listen("klerm://rpc", move |event| {
        if let Ok(value) = serde_json::from_str::<Value>(event.payload()) {
            if value.get("id").and_then(Value::as_str) == Some("desktop-startup-smoke") {
                let _ = sender.try_send(value);
            }
        }
    });
    let result = (|| {
        let started = start_backend(app.clone(), app.state::<BackendState>(), None, Some(false))?;
        rpc_send(
            app.state::<BackendState>(),
            serde_json::json!({"id":"desktop-startup-smoke","type":"desktop_handshake"}),
        )?;
        let response = receiver
            .recv_timeout(Duration::from_secs(30))
            .map_err(|_| "The packaged backend handshake timed out.")?;
        if response.get("success").and_then(Value::as_bool) != Some(true)
            || response
                .pointer("/data/protocolVersion")
                .and_then(Value::as_u64)
                != Some(1)
        {
            return Err("The packaged backend did not return desktop protocol version 1.".into());
        }
        Ok(
            serde_json::json!({"ready":true,"protocolVersion":1,"platform":env::consts::OS,"cwd":started.cwd,"nativeWindow":true}),
        )
    })();
    app.unlisten(listener);
    result
}
