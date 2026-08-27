import type { Usage } from "@earendil-works/pi-ai";

export function hasKlermResponseUsage(usage: Usage): boolean {
	return usage.input > 0 || usage.output > 0 || usage.cacheRead > 0 || usage.cacheWrite > 0 || usage.totalTokens > 0;
}

function formatCount(value: number): string {
	return value.toLocaleString("en-US");
}

function formatCost(value: number): string {
	if (value > 0 && value < 0.001) return "<$0.001";
	return `$${value.toFixed(3)}`;
}

export function formatKlermResponseUsage(usage: Usage): string {
	if (!hasKlermResponseUsage(usage)) return "Klerm usage: unavailable | cost unavailable";
	const total = usage.totalTokens || usage.input + usage.output + usage.cacheRead + usage.cacheWrite;
	const parts = [`input ${formatCount(usage.input)}`, `output ${formatCount(usage.output)}`];
	if (usage.cacheRead > 0) parts.push(`cache read ${formatCount(usage.cacheRead)}`);
	if (usage.cacheWrite > 0) parts.push(`cache write ${formatCount(usage.cacheWrite)}`);
	if (usage.reasoning !== undefined && usage.reasoning > 0) parts.push(`reasoning ${formatCount(usage.reasoning)}`);
	parts.push(`total ${formatCount(total)}`, `cost ${formatCost(usage.cost.total)}`);
	return `Klerm usage: ${parts.join(" | ")}`;
}
