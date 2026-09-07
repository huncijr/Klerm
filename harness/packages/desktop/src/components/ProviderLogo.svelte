<script lang="ts">
	let { id, size = 36 }: { id: string; size?: number } = $props();
	const box = $derived(`0 0 24 24`);
</script>

<svg width={size} height={size} viewBox={box} aria-hidden="true" class="shrink-0">
	{#if id === "anthropic"}
		<rect width="24" height="24" rx="6" fill="#d4a27f" />
		<path fill="#1a120c" d="M12 4.2 13.7 9h5.1l-4.1 3 1.6 4.9L12 13.9 7.7 16.9 9.3 12 5.2 9h5.1z" />
	{:else if id === "openai" || id === "openai-codex"}
		<rect width="24" height="24" rx="6" fill={id === "openai-codex" ? "#1a1a1a" : "#10a37f"} />
		<path
			fill="#fff"
			d="M12.7 4.1c.9-.5 2-.5 2.9 0 1.3.7 1.9 2.2 1.5 3.6 1.3.3 2.4 1.3 2.8 2.6.5 1.5 0 3.1-1.2 4.1.3 1.3-.2 2.7-1.3 3.5-.9.6-2.1.7-3.1.3-.6 1.1-1.8 1.8-3.1 1.8-1.4 0-2.6-.8-3.2-2-1.3.3-2.7-.2-3.5-1.3C3.6 16 3.5 14.4 4.2 13c-1-.8-1.5-2.1-1.2-3.4.3-1.4 1.4-2.4 2.8-2.7C5.4 5.6 6 4.1 7.3 3.4c.9-.5 2-.5 2.9 0 .8-1 2.1-1.5 3.4-1.2 1.2.3 2.1 1.2 2.5 2.4h.1c-.8-.2-1.6-.1-2.3.3-.5-.8-1.4-1.3-2.4-1.3s-1.9.5-2.4 1.3c-.9-.4-1.9-.4-2.8 0-.8.5-1.3 1.4-1.3 2.4 0 .3 0 .5.1.8-1 .4-1.7 1.3-1.8 2.4 0 1.1.6 2.1 1.5 2.6-.2.9 0 1.9.6 2.6.6.7 1.6 1.1 2.5 1 .3 1 1.2 1.7 2.3 1.8 1.1 0 2-.6 2.4-1.5.9.3 1.9.2 2.7-.3.8-.5 1.2-1.4 1.2-2.4 0-.3 0-.5-.1-.8 1-.4 1.7-1.3 1.8-2.4 0-1.1-.6-2.1-1.5-2.6.2-.9 0-1.9-.6-2.6-.4-.5-1-.8-1.6-.9Z"
		/>
	{:else if id === "google" || id === "google-vertex"}
		<rect width="24" height="24" rx="6" fill="#fff" />
		<path fill="#4285F4" d="M21.6 12.2c0-.7-.1-1.4-.2-2H12v3.8h5.4a4.6 4.6 0 0 1-2 3v2.5h3.2c1.9-1.7 3-4.3 3-7.3Z" />
		<path fill="#34A853" d="M12 22c2.7 0 5-.9 6.6-2.4l-3.2-2.5c-.9.6-2 1-3.4 1-2.6 0-4.8-1.8-5.6-4.1H3.1v2.6A10 10 0 0 0 12 22Z" />
		<path fill="#FBBC05" d="M6.4 13.9A6 6 0 0 1 6.1 12c0-.7.1-1.3.3-1.9V7.5H3.1A10 10 0 0 0 2 12c0 1.6.4 3.1 1.1 4.5l3.3-2.6Z" />
		<path fill="#EA4335" d="M12 5.9c1.5 0 2.8.5 3.8 1.5l2.9-2.9C17 2.9 14.7 2 12 2A10 10 0 0 0 3.1 7.5l3.3 2.6C8 7.7 10 5.9 12 5.9Z" />
	{:else if id === "ollama"}
		<rect width="24" height="24" rx="6" fill="#fff" />
		<path fill="#111" d="M7 16.5c0-2.2 1.3-3.6 3.2-4.1-.6-.4-1-1.1-1-1.9 0-1.3 1.1-2.3 2.8-2.3s2.8 1 2.8 2.3c0 .8-.4 1.5-1 1.9 1.9.5 3.2 1.9 3.2 4.1v1.2H7v-1.2Zm-1.8-1.2c-.7-1.2-1.2-2.2-1.2-3.5 0-1.6.8-2.6 2-2.6.7 0 1.2.4 1.5 1C7.1 9.4 7 8.7 7 8c0-2.2 1.8-3.6 5-3.6s5 1.4 5 3.6c0 .7-.1 1.4-.5 2 .3-.6.8-1 1.5-1 1.2 0 2 1 2 2.6 0 1.3-.5 2.3-1.2 3.5-.2.4-.6.6-1 .4s-.6-.6-.4-1c.5-.9.8-1.6.8-2.5 0-.7-.2-1.1-.6-1.1s-.7.5-.7 1.4v.4c0 .5-.4.8-.8.8-.5 0-.8-.4-.8-.8V9.2c0-1.3-.8-2.1-2.3-2.1S10.2 7.9 10.2 9.2v2.3c0 .4-.3.8-.8.8-.4 0-.8-.3-.8-.8v-.4c0-.9-.3-1.4-.7-1.4s-.6.4-.6 1.1c0 .9.3 1.6.8 2.5.2.4 0 .8-.4 1s-.8 0-1-.4Z" />
	{:else if id === "qwen-token-plan" || id === "qwen-token-plan-cn" || id === "qwen-token-plan-individual" || id === "qwen"}
		<rect width="24" height="24" rx="6" fill="#6A3CF7" />
		<path fill="#fff" d="M7.2 6.5h3.1l1.7 4.2 1.7-4.2h3.1L13.6 14v3.6h-3.2V14L7.2 6.5Z" />
		<circle cx="17.4" cy="16.8" r="1.5" fill="#9AE66E" />
	{:else if id === "groq"}
		<rect width="24" height="24" rx="6" fill="#f55036" />
		<path fill="#fff" d="M7 7h6.2c2.8 0 4.6 1.7 4.6 4.3S16 15.6 13.2 15.6H10.4V17H7V7Zm3.4 2.6v3.4h2.5c1.2 0 1.9-.7 1.9-1.7s-.7-1.7-1.9-1.7H10.4Z" />
	{:else if id === "xai"}
		<rect width="24" height="24" rx="6" fill="#000" />
		<path fill="#fff" d="M6.4 6.2h3.2l2.4 3.7 2.4-3.7h3.2l-4.1 5.9 4.4 5.7h-3.3l-2.6-3.9-2.6 3.9H6.2l4.4-5.7-4.2-5.9Z" />
	{:else if id === "openrouter"}
		<rect width="24" height="24" rx="6" fill="#6566F1" />
		<path fill="#fff" d="M8 7h8v2.2h-8V7Zm0 4h8v2.2h-8V11Zm0 4h5.2V17.2H8V15Z" />
		<circle cx="17.2" cy="16.2" r="1.6" fill="#fff" />
	{:else if id === "deepseek"}
		<rect width="24" height="24" rx="6" fill="#4D6BFE" />
		<path fill="#fff" d="M6.5 16.8 12 5.8l5.5 11H14l-2-4.2-2 4.2H6.5Z" />
	{:else if id === "mistral"}
		<rect width="24" height="24" rx="6" fill="#fa520f" />
		<path fill="#fff" d="M5 18V6h3.2l3.8 6.4L15.8 6H19v12h-3.1V11l-2.9 4.8h-.8L9.3 11V18H5Z" />
	{:else if id === "huggingface"}
		<rect width="24" height="24" rx="6" fill="#ffd21e" />
		<circle cx="9" cy="11" r="1.2" fill="#1a1a1a" />
		<circle cx="15" cy="11" r="1.2" fill="#1a1a1a" />
		<path fill="none" stroke="#1a1a1a" stroke-width="1.4" d="M8.2 15c1.1 1.2 2.4 1.8 3.8 1.8S14.7 16.2 15.8 15" />
	{:else if id === "github-copilot"}
		<rect width="24" height="24" rx="6" fill="#24292f" />
		<path fill="#fff" d="M12 5.2c2.4 0 4.2 1.4 4.2 3.6v2.1c1.3.4 2.2 1.5 2.2 2.9 0 1.7-1.4 3-3.3 3.4-.5 1.4-1.7 2.4-3.1 2.4s-2.6-1-3.1-2.4c-1.9-.4-3.3-1.7-3.3-3.4 0-1.4.9-2.5 2.2-2.9V8.8c0-2.2 1.8-3.6 4.2-3.6Zm-2.4 6.4c-.8.3-1.3 1-1.3 1.8 0 1 .9 1.8 2.1 1.8h.3V11.4c-.4 0-.8.1-1.1.2Zm4.8.2c-.3-.1-.7-.2-1.1-.2v4.8h.3c1.2 0 2.1-.8 2.1-1.8 0-.8-.5-1.5-1.3-1.8Z" />
	{:else if id === "fireworks"}
		<rect width="24" height="24" rx="6" fill="#7c3aed" />
		<path fill="#fff" d="M12 4.5s3.2 3.4 3.2 6.2c0 1.8-1.4 3.2-3.2 3.2S8.8 12.5 8.8 10.7C8.8 7.9 12 4.5 12 4.5Zm0 10.4c2.4 0 4.4 1.2 4.4 3.1S14.4 21 12 21s-4.4-1.2-4.4-3s2-3.1 4.4-3.1Z" />
	{:else if id === "together"}
		<rect width="24" height="24" rx="6" fill="#0f6fff" />
		<circle cx="8" cy="12" r="2.2" fill="#fff" />
		<circle cx="16" cy="12" r="2.2" fill="#fff" />
		<path fill="#fff" d="M9.4 12h5.2v1.4H9.4z" />
	{:else if id === "amazon-bedrock"}
		<rect width="24" height="24" rx="6" fill="#232f3e" />
		<path fill="#ff9900" d="M6 15.6c2.2 1.6 6.1 2.6 9.7 1.4.8-.3 1.5-.7 2.1-1.2.2-.1.4 0 .2.2-1.1 1.3-3.6 2.2-6.1 2.2-3.6 0-6.5-1.4-6.5-2.2 0-.2.3 0 .6-.4Z" />
		<path fill="#fff" d="M8.2 8.2h2.1l1.7 4.4 1.7-4.4h2.1L13.3 16h-2.2L8.2 8.2Z" />
	{:else if id === "moonshotai" || id === "kimi-coding"}
		<rect width="24" height="24" rx="6" fill="#1a1a1a" />
		<circle cx="12" cy="12" r="5.5" fill="none" stroke="#fff" stroke-width="1.6" />
		<circle cx="14.4" cy="9.4" r="1.3" fill="#fff" />
	{:else if id === "minimax" || id === "minimax-cn"}
		<rect width="24" height="24" rx="6" fill="#ff2d55" />
		<path fill="#fff" d="M5.5 16.8 9.2 7h3.1l-3.7 9.8H5.5Zm7.2 0L16.4 7h3.1l-3.7 9.8h-3.1Z" />
	{:else if id === "nvidia"}
		<rect width="24" height="24" rx="6" fill="#76b900" />
		<path fill="#fff" d="M5 15.4c2.8 2 6.7 2.6 10.3 1.8 1.3-.3 2.5-.8 3.5-1.5v1.7c-1 .7-2.3 1.2-3.6 1.5-3.8.8-8 .1-11-2.2v-1.3Zm.8-2.2c.3.2.6.3.8.2 2.2-1.3 4.6-2 8.1-2.2 1.8-.1 3.6.1 5.3.6v1.8c-1.6-.7-3.4-1.1-5.3-1-3.3.2-5.6.9-7.6 2.1-.5.3-1.1.2-1.5 0-.4-.2-.6-.6-.6-1 0-.5.3-.9.8-1.2.7-.4 1.5-.4 2.3 0 1.3.6 2.6.9 4.1.9s2.8-.3 4-1c.4-.2.6-.6.6-1s-.3-.8-.7-1c-1.4-.7-3-1-4.6-1-2.4 0-4.6.6-6.5 1.7-.8.5-1.3 1.3-1.3 2.2 0 1 .6 1.8 1.5 2.2Z" />
	{:else if id === "zai" || id === "zai-coding-cn"}
		<rect width="24" height="24" rx="6" fill="#105eff" />
		<path fill="#fff" d="M6.4 7h11.2v2.3L10.6 15H18v2.3H6.4V15l7.1-5.7H6.4V7Z" />
	{:else if id === "cerebras"}
		<rect width="24" height="24" rx="6" fill="#f15a24" />
		<path fill="#fff" d="M7 7h10v3.1h-3.4V17H10.4V10.1H7V7Z" />
	{:else if id === "custom"}
		<rect width="24" height="24" rx="6" fill="#2a333b" />
		<path fill="#d7e7ff" d="M11 6h2v5h5v2h-5v5h-2v-5H6v-2h5V6Z" />
		<circle cx="18" cy="18" r="2" fill="#8fb7e8" />
	{:else}
		<rect width="24" height="24" rx="6" fill="#1b2329" />
		<text x="12" y="16" text-anchor="middle" fill="#d7e7ff" font-size="11" font-family="ui-sans-serif, system-ui">{id.slice(0, 1).toUpperCase()}</text>
	{/if}
</svg>
