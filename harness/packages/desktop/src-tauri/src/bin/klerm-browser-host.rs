//! Windowless CEF surface owned by the Klerm desktop process.
//! JSONL commands arrive on stdin; compressed paint frames are sent on stdout.
#![cfg(target_os = "linux")]

use base64::{engine::general_purpose::STANDARD, Engine as _};
use cef::{args::Args, *};
use serde::Deserialize;
use serde_json::json;
use std::cell::Cell;
use std::io::{BufRead, Write};
use std::net::TcpListener;
use std::rc::Rc;
use std::sync::mpsc;
use std::time::{Duration, Instant};

wrap_app! {
    struct BrowserApp {}
    impl App {}
}

struct Surface {
    width: Cell<i32>,
    height: Cell<i32>,
    visible: Cell<bool>,
    last_paint: Cell<Instant>,
}

wrap_render_handler! {
    struct SurfaceRenderHandler { surface: Rc<Surface> }
    impl RenderHandler {
        fn view_rect(&self, _browser: Option<&mut Browser>, rect: Option<&mut Rect>) {
            if let Some(rect) = rect {
                rect.width = self.surface.width.get();
                rect.height = self.surface.height.get();
            }
        }

        fn on_paint(&self, _browser: Option<&mut Browser>, kind: PaintElementType,
                    _dirty_rects: Option<&[Rect]>, buffer: *const u8,
                    width: ::std::os::raw::c_int, height: ::std::os::raw::c_int) {
            if kind != PaintElementType::default() || buffer.is_null() || !self.surface.visible.get()
                || width < 1 || height < 1 || width > 4096 || height > 4096
                || self.surface.last_paint.get().elapsed() < Duration::from_millis(120) {
                return;
            }
            self.surface.last_paint.set(Instant::now());
            let source = unsafe { std::slice::from_raw_parts(buffer, width as usize * height as usize * 4) };
            let mut rgba = source.to_vec();
            for pixel in rgba.chunks_exact_mut(4) { pixel.swap(0, 2); }
            let mut compressed = Vec::new();
            let result = (|| -> Result<(), png::EncodingError> {
                let mut encoder = png::Encoder::new(&mut compressed, width as u32, height as u32);
                encoder.set_color(png::ColorType::Rgba);
                encoder.set_depth(png::BitDepth::Eight);
                encoder.set_compression(png::Compression::Fast);
                encoder.write_header()?.write_image_data(&rgba)
            })();
            if result.is_ok() {
                emit(json!({"type":"frame", "width":width, "height":height,
                    "data":STANDARD.encode(compressed)}));
            }
        }
    }
}

wrap_client! {
    struct SurfaceClient { render_handler: RenderHandler }
    impl Client {
        fn render_handler(&self) -> Option<RenderHandler> { Some(self.render_handler.clone()) }
    }
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum Command {
    Resize {
        width: i32,
        height: i32,
    },
    Navigate {
        url: String,
    },
    Back,
    Forward,
    Reload,
    Visible {
        visible: bool,
    },
    Mouse {
        x: i32,
        y: i32,
        kind: String,
        button: Option<String>,
        delta_y: Option<i32>,
    },
    Key {
        key: String,
        kind: String,
    },
    Close,
}

fn emit(event: serde_json::Value) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{event}");
    let _ = out.flush();
}

fn main() {
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = Args::new();
    let mut app = BrowserApp::new();
    let ret = execute_process(
        Some(args.as_main_args()),
        Some(&mut app),
        std::ptr::null_mut(),
    );
    if ret >= 0 {
        return;
    }

    let port = TcpListener::bind("127.0.0.1:0")
        .expect("reserve CDP port")
        .local_addr()
        .expect("CDP address")
        .port();
    let root = std::env::temp_dir().join(format!("klerm-cef-{}", std::process::id()));
    std::fs::create_dir_all(&root).expect("create isolated CEF cache");
    let settings = Settings {
        windowless_rendering_enabled: 1,
        external_message_pump: 1,
        remote_debugging_port: i32::from(port),
        root_cache_path: root.to_string_lossy().as_ref().into(),
        cache_path: root.to_string_lossy().as_ref().into(),
        ..Default::default()
    };
    if initialize(
        Some(args.as_main_args()),
        Some(&settings),
        Some(&mut app),
        std::ptr::null_mut(),
    ) != 1
    {
        emit(json!({"type":"error","message":"CEF initialization failed"}));
        return;
    }

    let surface = Rc::new(Surface {
        width: Cell::new(800),
        height: Cell::new(600),
        visible: Cell::new(true),
        last_paint: Cell::new(Instant::now() - Duration::from_secs(1)),
    });
    let info = WindowInfo {
        windowless_rendering_enabled: 1,
        ..Default::default()
    };
    let mut context =
        request_context_create_context(Some(&RequestContextSettings::default()), None);
    let mut client = SurfaceClient::new(SurfaceRenderHandler::new(surface.clone()));
    let browser = browser_host_create_browser_sync(
        Some(&info),
        Some(&mut client),
        Some(&"about:blank".into()),
        Some(&BrowserSettings {
            windowless_frame_rate: 15,
            ..Default::default()
        }),
        None,
        context.as_mut(),
    )
    .expect("CEF browser startup");
    emit(json!({"type":"ready","port":port}));

    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::stdin().lock().lines() {
            let Ok(line) = line else { break };
            if let Ok(command) = serde_json::from_str::<Command>(&line) {
                let _ = tx.send(command);
            }
        }
        let _ = tx.send(Command::Close);
    });

    let mut current_url = String::new();
    let mut closing = false;
    let mut closed_at = Instant::now();
    loop {
        do_message_loop_work();
        while let Ok(command) = rx.try_recv() {
            let Some(host) = browser.host() else { continue };
            match command {
                Command::Resize { width, height }
                    if (1..=4096).contains(&width) && (1..=4096).contains(&height) =>
                {
                    surface.width.set(width);
                    surface.height.set(height);
                    host.was_resized();
                }
                Command::Visible { visible } => {
                    surface.visible.set(visible);
                    if visible {
                        host.invalidate(PaintElementType::default());
                    }
                }
                Command::Navigate { url }
                    if url.len() < 2048
                        && (url.starts_with("https://") || url.starts_with("http://")) =>
                {
                    if let Some(frame) = browser.main_frame() {
                        frame.load_url(Some(&url.as_str().into()));
                    }
                }
                Command::Back => {
                    if browser.can_go_back() != 0 {
                        browser.go_back();
                    }
                }
                Command::Forward => {
                    if browser.can_go_forward() != 0 {
                        browser.go_forward();
                    }
                }
                Command::Reload => browser.reload(),
                Command::Mouse {
                    x,
                    y,
                    kind,
                    button,
                    delta_y,
                } => {
                    let event = MouseEvent { x, y, modifiers: 0 };
                    match kind.as_str() {
                        "move" => host.send_mouse_move_event(Some(&event), 0),
                        "wheel" => {
                            host.send_mouse_wheel_event(Some(&event), 0, delta_y.unwrap_or(0))
                        }
                        "down" | "up" => {
                            let mouse_button = if button.as_deref() == Some("right") {
                                MouseButtonType::RIGHT
                            } else {
                                MouseButtonType::LEFT
                            };
                            host.send_mouse_click_event(
                                Some(&event),
                                mouse_button,
                                i32::from(kind == "up"),
                                1,
                            );
                        }
                        _ => {}
                    }
                }
                Command::Key { key, kind } => {
                    let code = match key.as_str() {
                        "Backspace" => 8,
                        "Tab" => 9,
                        "Enter" => 13,
                        "Escape" => 27,
                        " " => 32,
                        "ArrowLeft" => 37,
                        "ArrowUp" => 38,
                        "ArrowRight" => 39,
                        "ArrowDown" => 40,
                        "Delete" => 46,
                        _ => key.chars().next().unwrap_or('\0') as u32,
                    };
                    let character = if key.chars().count() == 1 {
                        code as u16
                    } else {
                        0
                    };
                    let event = KeyEvent {
                        size: std::mem::size_of::<KeyEvent>(),
                        type_: if kind == "up" {
                            KeyEventType::KEYUP
                        } else if kind == "char" {
                            KeyEventType::CHAR
                        } else {
                            KeyEventType::RAWKEYDOWN
                        },
                        windows_key_code: code as i32,
                        character,
                        unmodified_character: character,
                        ..Default::default()
                    };
                    host.send_key_event(Some(&event));
                }
                Command::Close => {
                    closing = true;
                    closed_at = Instant::now();
                    host.close_browser(1);
                }
                _ => {}
            }
        }
        if !closing {
            if let Some(frame) = browser.main_frame() {
                let url = CefStringUtf8::from(&CefStringUtf16::from(&frame.url())).to_string();
                if url != current_url {
                    current_url = url.clone();
                    emit(json!({"type":"url","url":url}));
                }
            }
        } else if closed_at.elapsed() >= Duration::from_millis(600) {
            break;
        }
        std::thread::sleep(Duration::from_millis(12));
    }
    drop(browser);
    shutdown();
    let _ = std::fs::remove_dir_all(root);
}
