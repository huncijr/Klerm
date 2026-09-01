<script lang="ts">
	let { text }: { text: string } = $props();

	type InlineToken = { type: "text" | "bold" | "code"; text: string };
	type MarkdownBlock =
		| { type: "heading"; level: number; text: string }
		| { type: "paragraph"; text: string }
		| { type: "list"; ordered: boolean; items: string[] }
		| { type: "code"; language: string; text: string };

	function isBlockStart(line: string): boolean {
		return /^```/.test(line) || /^#{1,3}\s+/.test(line) || /^\s*(?:[-*]|\d+\.)\s+/.test(line);
	}

	function parseMarkdown(source: string): MarkdownBlock[] {
		const lines = source.replaceAll("\r\n", "\n").split("\n");
		const blocks: MarkdownBlock[] = [];
		let index = 0;
		while (index < lines.length) {
			const line = lines[index] ?? "";
			if (!line.trim()) {
				index += 1;
				continue;
			}
			const fence = line.match(/^```\s*([^\s`]*)/);
			if (fence) {
				const code: string[] = [];
				index += 1;
				while (index < lines.length && !/^```\s*$/.test(lines[index] ?? "")) {
					code.push(lines[index] ?? "");
					index += 1;
				}
				if (index < lines.length) index += 1;
				blocks.push({ type: "code", language: fence[1] ?? "", text: code.join("\n") });
				continue;
			}
			const heading = line.match(/^(#{1,3})\s+(.+)$/);
			if (heading) {
				blocks.push({ type: "heading", level: heading[1]?.length ?? 1, text: heading[2] ?? "" });
				index += 1;
				continue;
			}
			const listItem = line.match(/^\s*([-*]|\d+\.)\s+(.+)$/);
			if (listItem) {
				const ordered = /\d+\./.test(listItem[1] ?? "");
				const items: string[] = [];
				while (index < lines.length) {
					const candidate = (lines[index] ?? "").match(/^\s*([-*]|\d+\.)\s+(.+)$/);
					if (!candidate || /\d+\./.test(candidate[1] ?? "") !== ordered) break;
					items.push(candidate[2] ?? "");
					index += 1;
				}
				blocks.push({ type: "list", ordered, items });
				continue;
			}
			const paragraph = [line.trim()];
			index += 1;
			while (index < lines.length && (lines[index] ?? "").trim() && !isBlockStart(lines[index] ?? "")) {
				paragraph.push((lines[index] ?? "").trim());
				index += 1;
			}
			blocks.push({ type: "paragraph", text: paragraph.join(" ") });
		}
		return blocks;
	}

	function inlineTokens(source: string): InlineToken[] {
		const tokens: InlineToken[] = [];
		const pattern = /(\*\*[^*]+\*\*|`[^`\n]+`)/g;
		let cursor = 0;
		for (const match of source.matchAll(pattern)) {
			const start = match.index ?? cursor;
			if (start > cursor) tokens.push({ type: "text", text: source.slice(cursor, start) });
			const value = match[0];
			if (value.startsWith("**")) tokens.push({ type: "bold", text: value.slice(2, -2) });
			else tokens.push({ type: "code", text: value.slice(1, -1) });
			cursor = start + value.length;
		}
		if (cursor < source.length) tokens.push({ type: "text", text: source.slice(cursor) });
		return tokens;
	}

	const blocks = $derived(parseMarkdown(text));
</script>

<div class="space-y-3 break-words">
	{#each blocks as block, blockIndex (`${blockIndex}-${block.type}`)}
		{#if block.type === "heading"}
			{#if block.level === 1}
				<h1 class="pt-1 text-[19px] font-bold leading-[1.3] text-[#f0f3f4] narrow-520:text-[17px]">
					{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong>{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-[#1a2127] px-1 py-0.5 font-mono text-[.88em] text-[#d8e0e4]">{token.text}</code>{:else}{token.text}{/if}{/each}
				</h1>
			{:else if block.level === 2}
				<h2 class="pt-1 text-[16px] font-bold leading-[1.35] text-[#edf1f3] narrow-520:text-[15px]">
					{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong>{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-[#1a2127] px-1 py-0.5 font-mono text-[.88em] text-[#d8e0e4]">{token.text}</code>{:else}{token.text}{/if}{/each}
				</h2>
			{:else}
				<h3 class="pt-1 text-[14px] font-bold leading-[1.4] text-[#e5eaed]">
					{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong>{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-[#1a2127] px-1 py-0.5 font-mono text-[.88em] text-[#d8e0e4]">{token.text}</code>{:else}{token.text}{/if}{/each}
				</h3>
			{/if}
		{:else if block.type === "paragraph"}
			<p>
				{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-[#eef2f3]">{token.text}</strong>{:else if token.type === "code"}<code class="rounded border border-[#2a333a] bg-[#151b20] px-1.5 py-0.5 font-mono text-[.88em] text-[#d9e1e4]">{token.text}</code>{:else}{token.text}{/if}{/each}
			</p>
		{:else if block.type === "list"}
			{#if block.ordered}
				<ol class="list-decimal space-y-1 pl-5 marker:text-[#77838b]">
					{#each block.items as item, itemIndex (itemIndex)}<li>{#each inlineTokens(item) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-[#eef2f3]">{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-[#151b20] px-1 py-0.5 font-mono text-[.88em]">{token.text}</code>{:else}{token.text}{/if}{/each}</li>{/each}
				</ol>
			{:else}
				<ul class="list-disc space-y-1 pl-5 marker:text-[#77838b]">
					{#each block.items as item, itemIndex (itemIndex)}<li>{#each inlineTokens(item) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-[#eef2f3]">{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-[#151b20] px-1 py-0.5 font-mono text-[.88em]">{token.text}</code>{:else}{token.text}{/if}{/each}</li>{/each}
				</ul>
			{/if}
		{:else}
			<div class="overflow-hidden rounded-lg border border-[#29323a] bg-[#090d11]">
				{#if block.language}<div class="border-b border-[#222a31] px-3 py-1.5 font-mono text-[8px] tracking-[.08em] text-[#71808a] uppercase">{block.language}</div>{/if}
				<pre class="m-0 overflow-x-auto p-3 font-mono text-[11px]/[1.6] whitespace-pre text-[#d2dade]"><code>{block.text}</code></pre>
			</div>
		{/if}
	{/each}
</div>
