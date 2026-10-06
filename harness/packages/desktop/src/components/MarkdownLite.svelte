<script lang="ts">
	let { text }: { text: string } = $props();

	type InlineToken = { type: "text" | "bold" | "code"; text: string };
	type MarkdownBlock =
		| { type: "heading"; level: number; text: string }
		| { type: "paragraph"; text: string }
		| { type: "list"; ordered: boolean; items: string[] }
		| { type: "table"; headers: string[]; rows: string[][]; fileSummary: boolean }
		| { type: "code"; language: string; text: string };

	function isBlockStart(line: string): boolean {
		return /^```/.test(line) || /^#{1,3}\s+/.test(line) || /^\s*(?:[-*]|\d+\.)\s+/.test(line) || isTableStart(line);
	}

	function splitTableRow(line: string): string[] {
		return line
			.trim()
			.replace(/^\|/, "")
			.replace(/\|$/, "")
			.split("|")
			.map((cell) => cell.trim());
	}

	function isTableSeparator(line: string): boolean {
		return /^\s*\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
	}

	function isTableStart(line: string, nextLine?: string): boolean {
		return line.includes("|") && (nextLine === undefined || isTableSeparator(nextLine));
	}

	function isFilePath(value: string): boolean {
		return /(?:^|[\s`])(?:[\w.-]+\/)*[\w.-]+\.(?:html|css|js|ts|tsx|jsx|json|md|svelte|rs|go|py|txt)(?:`|\s|$)/i.test(
			value,
		);
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
			if (isTableStart(line, lines[index + 1])) {
				const headers = splitTableRow(line);
				const rows: string[][] = [];
				index += 2;
				while (index < lines.length && (lines[index] ?? "").includes("|") && (lines[index] ?? "").trim()) {
					rows.push(splitTableRow(lines[index] ?? ""));
					index += 1;
				}
				blocks.push({
					type: "table",
					headers,
					rows,
					fileSummary: headers.some((header) => /file|path/i.test(header)) || rows.some((row) => row.some(isFilePath)),
				});
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

	function cellAt(row: string[], index: number): string {
		return row[index] ?? "";
	}

	const blocks = $derived(parseMarkdown(text));
</script>

<div class="space-y-3 break-words">
	{#each blocks as block, blockIndex (`${blockIndex}-${block.type}`)}
		{#if block.type === "heading"}
			{#if block.level === 1}
				<h1 class="pt-1 text-[19px] font-bold leading-[1.3] text-ink narrow-520:text-[17px]">
					{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong>{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-raised px-1 py-0.5 font-mono text-[.88em] text-ink">{token.text}</code>{:else}{token.text}{/if}{/each}
				</h1>
			{:else if block.level === 2}
				<h2 class="pt-1 text-[16px] font-bold leading-[1.35] text-ink narrow-520:text-[15px]">
					{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong>{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-raised px-1 py-0.5 font-mono text-[.88em] text-ink">{token.text}</code>{:else}{token.text}{/if}{/each}
				</h2>
			{:else}
				<h3 class="pt-1 text-[14px] font-bold leading-[1.4] text-ink">
					{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong>{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-raised px-1 py-0.5 font-mono text-[.88em] text-ink">{token.text}</code>{:else}{token.text}{/if}{/each}
				</h3>
			{/if}
		{:else if block.type === "paragraph"}
			<p>
				{#each inlineTokens(block.text) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-ink">{token.text}</strong>{:else if token.type === "code"}<code class="rounded border border-line bg-panel px-1.5 py-0.5 font-mono text-[.88em] text-ink">{token.text}</code>{:else}{token.text}{/if}{/each}
			</p>
		{:else if block.type === "list"}
			{#if block.ordered}
				<ol class="list-decimal space-y-1 pl-5 marker:text-muted">
					{#each block.items as item, itemIndex (itemIndex)}<li>{#each inlineTokens(item) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-ink">{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-panel px-1 py-0.5 font-mono text-[.88em]">{token.text}</code>{:else}{token.text}{/if}{/each}</li>{/each}
				</ol>
			{:else}
				<ul class="list-disc space-y-1 pl-5 marker:text-muted">
					{#each block.items as item, itemIndex (itemIndex)}<li>{#each inlineTokens(item) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-ink">{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-panel px-1 py-0.5 font-mono text-[.88em]">{token.text}</code>{:else}{token.text}{/if}{/each}</li>{/each}
				</ul>
			{/if}
		{:else if block.type === "table"}
			{#if block.fileSummary}
				<div class="grid gap-2">
					{#each block.rows as row, rowIndex (rowIndex)}
						<div class="rounded-lg border border-line bg-panel p-3 shadow-sm">
							<div class="mb-2 flex flex-wrap items-center gap-2">
								<code class="rounded-md border border-info bg-raised px-2 py-1 font-mono text-[12px] text-info">{cellAt(row, 0).replaceAll("`", "")}</code>
								{#if block.headers[1]}<span class="font-sans text-[11px] tracking-[.12em] text-muted uppercase">{block.headers[1]}</span>{/if}
							</div>
							{#if row.length > 1}
								<p class="m-0 text-[13px]/[1.55] text-ink">
									{#each inlineTokens(row.slice(1).join(" / ")) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-ink">{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-panel px-1 py-0.5 font-mono text-[.88em]">{token.text}</code>{:else}{token.text}{/if}{/each}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="overflow-x-auto rounded-lg border border-line bg-bg">
					<table class="w-full border-collapse text-left text-[13px]/[1.45]">
						<thead class="bg-panel font-sans text-[11px] tracking-[.1em] text-muted uppercase">
							<tr>{#each block.headers as header, headerIndex (headerIndex)}<th class="border-b border-line px-3 py-2 font-medium">{header}</th>{/each}</tr>
						</thead>
						<tbody>
							{#each block.rows as row, rowIndex (rowIndex)}
								<tr class="border-b border-line-soft last:border-b-0">
									{#each block.headers as _header, cellIndex (cellIndex)}<td class="px-3 py-2 text-ink">{#each inlineTokens(cellAt(row, cellIndex)) as token, tokenIndex (tokenIndex)}{#if token.type === "bold"}<strong class="font-semibold text-ink">{token.text}</strong>{:else if token.type === "code"}<code class="rounded bg-panel px-1 py-0.5 font-mono text-[.88em]">{token.text}</code>{:else}{token.text}{/if}{/each}</td>{/each}
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{:else}
			<div class="overflow-hidden rounded-lg border border-line bg-bg">
				{#if block.language}<div class="border-b border-line px-3 py-1.5 font-sans text-[11px] tracking-[.08em] text-muted uppercase">{block.language}</div>{/if}
				<pre class="m-0 overflow-x-auto p-3 font-mono text-[13px]/[1.6] whitespace-pre text-ink"><code>{block.text}</code></pre>
			</div>
		{/if}
	{/each}
</div>
