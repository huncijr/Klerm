import { mount } from "svelte";
import App from "./App.svelte";
import { resolveAppearance } from "./lib/appearance.ts";
import "./app.css";

let appearance: unknown;
try {
	appearance = localStorage.getItem("klerm-appearance");
} catch {
	/* Restricted storage uses the default. */
}
document.documentElement.dataset.theme = resolveAppearance(
	appearance,
	window.matchMedia("(prefers-color-scheme: dark)").matches,
);

const app = mount(App, { target: document.getElementById("app")! });

export default app;
