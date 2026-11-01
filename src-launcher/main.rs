#![windows_subsystem = "windows"]

use std::env;
use std::net::{SocketAddr, TcpStream};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::thread;
use std::time::Duration;

const CREATE_NO_WINDOW: u32 = 0x08000000;
const APP_URL: &str = "http://127.0.0.1:3847";

fn is_server_running() -> bool {
    let addr: SocketAddr = "127.0.0.1:3847".parse().unwrap();
    TcpStream::connect_timeout(&addr, Duration::from_millis(200)).is_ok()
}

fn find_app_dir() -> PathBuf {
    if let Ok(exe_path) = env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            if parent.join("server.js").exists() {
                return parent.to_path_buf();
            }
        }
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from(r"d:\Cooking App"))
}

fn start_node_server(app_dir: &Path) {
    let server_js = app_dir.join("server.js");
    let _ = Command::new("node")
        .arg(&server_js)
        .current_dir(app_dir)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn launch_desktop_window() {
    let candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ];

    for browser_path in candidates.iter() {
        let p = Path::new(browser_path);
        if p.exists() {
            let app_arg = format!("--app={}", APP_URL);
            if Command::new(p)
                .arg(&app_arg)
                .arg("--window-size=1460,940")
                .spawn()
                .is_ok()
            {
                return;
            }
        }
    }

    let _ = Command::new("cmd")
        .args(["/C", "start", "", APP_URL])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

fn main() {
    let app_dir = find_app_dir();

    if !is_server_running() {
        start_node_server(&app_dir);
        for _ in 0..35 {
            if is_server_running() {
                break;
            }
            thread::sleep(Duration::from_millis(100));
        }
    }

    launch_desktop_window();
}
