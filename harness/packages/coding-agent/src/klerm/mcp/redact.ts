export function redactMcpSecretText(value: string): string {
	return value
		.replace(/\b((?:https?|postgres(?:ql)?):\/\/)[^\s/@:]+:[^\s/@]+@/gi, "$1********:********@")
		.replace(/\b(authorization|token|api[_-]?key|password|secret)\s*[:=]\s*[^\s,;]+/gi, "$1=********");
}

export function redactMcpSecretValue(value: unknown): string {
	return redactMcpSecretText(value instanceof Error ? value.message : String(value));
}
