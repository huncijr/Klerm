use std::path::{Path, PathBuf};

pub const RPC_ENTRY: &str =
    "backend/node_modules/@earendil-works/pi-coding-agent/dist/rpc-entry.js";

#[derive(Debug)]
pub struct BackendLaunch {
    pub node: PathBuf,
    pub entry: PathBuf,
}

pub fn backend_launch(
    resources: &Path,
    manifest: &Path,
    development: bool,
    node_override: Option<PathBuf>,
    entry_override: Option<PathBuf>,
) -> Result<BackendLaunch, String> {
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let packaged_node = resources.join("runtime").join(node_name);
    let entry = entry_override.unwrap_or_else(|| {
        if development {
            manifest.join("../../coding-agent/dist/rpc-entry.js")
        } else {
            resources.join(RPC_ENTRY)
        }
    });
    if !entry.is_file() {
        return Err(format!(
            "Klerm backend is missing at {}. Rebuild or reinstall the desktop package.",
            entry.display()
        ));
    }
    let node = match node_override {
        Some(node) => node,
        None if development => PathBuf::from("node"),
        None if packaged_node.is_file() => packaged_node,
        None => return Err(
            "The packaged Klerm Node runtime is missing. Rebuild or reinstall the desktop package."
                .into(),
        ),
    };
    Ok(BackendLaunch { node, entry })
}

pub fn node_search_path(
    node: &Path,
    existing: Option<std::ffi::OsString>,
) -> Result<std::ffi::OsString, String> {
    let mut paths = Vec::new();
    if node.is_absolute() {
        if let Some(parent) = node.parent() {
            paths.push(parent.to_path_buf());
        }
    }
    if let Some(existing) = existing {
        paths.extend(std::env::split_paths(&existing));
    }
    std::env::join_paths(paths)
        .map_err(|error| format!("Invalid backend executable search path: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static NEXT: AtomicUsize = AtomicUsize::new(0);

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let root = std::env::temp_dir().join(format!(
                "klerm desktop test {} {}",
                std::process::id(),
                NEXT.fetch_add(1, Ordering::Relaxed)
            ));
            std::fs::create_dir_all(&root).unwrap();
            Self(root)
        }
        fn file(&self, path: &str) -> PathBuf {
            let path = self.0.join(path);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, "fixture").unwrap();
            path
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn release_uses_resources_without_a_checkout_or_system_node() {
        let fixture = Fixture::new();
        let entry = fixture.file(RPC_ENTRY);
        let node = fixture.file(if cfg!(windows) {
            "runtime/node.exe"
        } else {
            "runtime/node"
        });
        let launch = backend_launch(
            &fixture.0,
            Path::new("missing-source-tree"),
            false,
            None,
            None,
        )
        .unwrap();
        assert_eq!(launch.entry, entry);
        assert_eq!(launch.node, node);
    }
    #[test]
    fn release_does_not_silently_fall_back_to_development_paths() {
        let fixture = Fixture::new();
        assert!(backend_launch(&fixture.0, &fixture.0, false, None, None).is_err());
        fixture.file(RPC_ENTRY);
        assert!(backend_launch(&fixture.0, &fixture.0, false, None, None)
            .unwrap_err()
            .contains("runtime is missing"));
    }
    #[test]
    fn explicit_overrides_support_spaces_and_non_ascii_paths() {
        let fixture = Fixture::new();
        let entry = fixture.file("munkamappa ékezet/backend.js");
        let node = fixture.file("node tools/node");
        let launch = backend_launch(
            &fixture.0,
            &fixture.0,
            false,
            Some(node.clone()),
            Some(entry.clone()),
        )
        .unwrap();
        assert_eq!(launch.node, node);
        assert_eq!(launch.entry, entry);
    }
    #[test]
    fn child_tools_can_find_the_packaged_node_without_a_gui_path() {
        let fixture = Fixture::new();
        let node = fixture.file("runtime/node");
        let path = node_search_path(&node, None).unwrap();
        assert_eq!(
            std::env::split_paths(&path).collect::<Vec<_>>(),
            vec![fixture.0.join("runtime")]
        );
    }
}
