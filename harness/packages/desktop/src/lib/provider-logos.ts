/**
 * Real provider logo files live in `Logo/providers/` (served by the desktop
 * app at `/providers/...`). Drop an official SVG/PNG/WebP there and map the
 * provider id below. Unmapped ids fall back to an initial letter.
 */
const PROVIDER_LOGO_FILES: Record<string, string> = {
	klerm: "/K_Klerm_no_background.png",
	anthropic: "anthropic.webp",
	"claude-code": "claude-code.webp",
	codex: "codex-mark.png",
	"openai-codex": "openai.webp",
	openai: "openai.webp",
	google: "google.webp",
	"google-vertex": "google.webp",
	ollama: "ollama.webp",
	"qwen-token-plan": "qwen-token-plan.webp",
	"qwen-token-plan-cn": "qwen-token-plan.webp",
	"qwen-token-plan-individual": "qwen-token-plan.webp",
	groq: "groq.webp",
	xai: "xai.webp",
	openrouter: "openrouter.webp",
	deepseek: "deepseek.webp",
	mistral: "mistral.png",
	huggingface: "huggingface.webp",
	"github-copilot": "github-copilot.webp",
	nvidia: "nvidia.webp",
	minimax: "minimax.webp",
	"minimax-cn": "minimax.webp",
	zai: "zai.webp",
	"zai-coding-cn": "zai.webp",
	custom: "custom.svg",
};

export function providerLogoSrc(id: string): string | undefined {
	const file = PROVIDER_LOGO_FILES[id];
	return file ? (file.startsWith("/") ? file : `/providers/${file}`) : undefined;
}

export function providerLogoAlt(id: string, label: string): string {
	return providerLogoSrc(id) ? `${label} logo` : label;
}
