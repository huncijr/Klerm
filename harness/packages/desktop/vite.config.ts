import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
	plugins: [svelte(), tailwindcss()],
	publicDir: resolve(import.meta.dirname, "../../../Logo"),
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
	},
	build: {
		target: "es2022",
		minify: process.env.TAURI_DEBUG ? false : "esbuild",
		sourcemap: Boolean(process.env.TAURI_DEBUG),
	},
});
