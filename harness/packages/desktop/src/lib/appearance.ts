/** Validate persisted preferences and resolve System without depending on the DOM. */
export function resolveAppearance(value: unknown, systemPrefersDark: boolean): "dark" | "light" {
	if (value === "light" || value === "dark") return value;
	if (value === "system") return systemPrefersDark ? "dark" : "light";
	return "dark";
}
