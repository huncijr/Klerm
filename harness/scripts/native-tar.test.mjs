import assert from "node:assert/strict";
import { test } from "node:test";
import { nativeTar } from "./native-tar.mjs";

test("Windows archiving bypasses Git Bash GNU tar for native paths and ZIPs", () => {
	assert.equal(nativeTar("win32", { SystemRoot: "D:\\Windows" }), "D:\\Windows\\System32\\tar.exe");
	assert.equal(nativeTar("win32", { SYSTEMROOT: "C:\\Windows" }), "C:\\Windows\\System32\\tar.exe");
	assert.equal(nativeTar("win32", {}), "C:\\Windows\\System32\\tar.exe");
});
test("macOS and Linux retain their native archivers", () => {
	assert.equal(nativeTar("darwin", {}), "tar");
	assert.equal(nativeTar("linux", {}), "tar");
});
