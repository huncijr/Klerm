import { win32 } from "node:path";

/** Git Bash's GNU tar treats drive-letter paths as remote hosts and lacks ZIP
 * support. Windows 10+ ships BSD tar, which handles native paths and Node ZIPs. */
export function nativeTar(platform = process.platform, env = process.env) {
	return platform === "win32" ? win32.join(env.SystemRoot ?? env.SYSTEMROOT ?? "C:\\Windows", "System32", "tar.exe") : "tar";
}
