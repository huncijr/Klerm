<script lang="ts">
	import { Braces, ChevronDown, Code2, ExternalLink, FileCode2, RefreshCw, Save, X } from "@lucide/svelte";
	import { onMount } from "svelte";
	import type { EditorInfo, WorkspaceFileStatus, WorkspaceStatus } from "../lib/model.ts";

	let {
		workspace,
		editors,
		selectedPath,
		diff,
		content,
		loading,
		saving,
		onclose,
		onrefresh,
		onselect,
		onsave,
		onopeneditor,
	}: {
		workspace: WorkspaceStatus | undefined;
		editors: EditorInfo[];
		selectedPath: string | undefined;
		diff: string;
		content: string | undefined;
		loading: boolean;
		saving: boolean;
		onclose: () => void;
		onrefresh: () => void;
		onselect: (path: string) => void;
		onsave: (path: string, content: string) => Promise<boolean>;
		onopeneditor: (editor: EditorInfo["id"]) => void;
	} = $props();

	let tab = $state<"diff" | "edit">("diff");
	let editContent = $state("");
	let originalContent = $state("");
	let editorMenuOpen = $state(false);
	let editorRoot: HTMLElement | undefined = $state();
	let panelEl: HTMLElement | undefined = $state();
	let listHeight = $state(180);

	$effect(() => {
		selectedPath;
		const next = content ?? "";
		editContent = next;
		originalContent = next;
		if (content === undefined && tab === "edit") tab = "diff";
	});

	onMount(() => {
		const closeMenu = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !editorRoot?.contains(event.target)) editorMenuOpen = false;
		};
		document.addEventListener("pointerdown", closeMenu);
		return () => document.removeEventListener("pointerdown", closeMenu);
	});

	function statusBadgeClass(status: WorkspaceFileStatus["status"]): string {
		if (status === "added" || status === "untracked") return "text-[#81c995]";
		if (status === "deleted") return "text-[#f09b93]";
		if (status === "renamed") return "text-[#8fb7e8]";
		return "text-[#9aa3aa]";
	}

	function actorLabel(file: WorkspaceFileStatus): string {
		const actor = file.attribution;
		if (actor.source === "manual" || actor.source === "external") return actor.source;
		const lane = actor.lane === "local" ? "Agent 1" : actor.lane === "frontier" ? "Agent 2" : actor.lane;
		const source = actor.source === "local" ? "Agent 1" : actor.source === "frontier" ? "Agent 2" : actor.source;
		const model = actor.provider && actor.model ? `${actor.provider}/${actor.model}` : actor.model;
		return [lane ?? source, model].filter(Boolean).join(" / ");
	}

	function actorClass(file: WorkspaceFileStatus): string {
		if (file.attribution.source === "local") return "border-[rgba(100,169,119,.35)] bg-[rgba(38,77,48,.22)] text-[#8bc89b]";
		if (file.attribution.source === "frontier") return "border-[rgba(87,132,194,.38)] bg-[rgba(34,58,90,.24)] text-[#91b6e5]";
		if (file.attribution.source === "manual") return "border-[rgba(214,166,63,.35)] bg-[rgba(76,58,24,.22)] text-[#d6b16e]";
		return "border-[#303941] bg-[#13191e] text-[#717d85]";
	}

	function stageLabel(file: WorkspaceFileStatus): string {
		if (file.staged && file.worktreeStatus !== " ") return "staged + unstaged";
		return file.staged ? "staged" : "unstaged";
	}

	function diffLineClass(line: string): string {
		if (line.startsWith("+") && !line.startsWith("+++")) return "bg-[rgba(30,83,46,.28)] text-[#9bd6aa]";
		if (line.startsWith("-") && !line.startsWith("---")) return "bg-[rgba(93,31,31,.3)] text-[#f0aaa3]";
		if (line.startsWith("@@")) return "bg-[rgba(47,67,92,.25)] text-[#91b4df]";
		return "text-[#7f8991]";
	}

	async function save(): Promise<void> {
		if (!selectedPath || editContent === originalContent) return;
		if (await onsave(selectedPath, editContent)) originalContent = editContent;
	}

	function startListResize(event: PointerEvent): void {
		event.preventDefault();
		const origin = event.clientY;
		const start = listHeight;
		const onMove = (move: PointerEvent) => {
			const max = Math.max(90, (panelEl?.clientHeight ?? 640) - 58 - 8 - 140);
			listHeight = Math.max(90, Math.min(max, start + move.clientY - origin));
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	}
</script>

<aside bind:this={panelEl} class="flex h-full min-h-0 min-w-0 flex-col border-l border-[#33414c] bg-[#10171d] shadow-[-16px_0_45px_rgba(0,0,0,.2)] narrow-900:fixed narrow-900:inset-y-0 narrow-900:right-0 narrow-900:z-[18] narrow-900:w-[min(460px,92vw)] narrow-900:shadow-[-24px_0_70px_rgba(0,0,0,.55)]">
	<header class="flex h-[58px] shrink-0 items-center gap-2 border-b border-[#34424d] bg-[linear-gradient(110deg,rgba(38,70,96,.42),rgba(18,26,32,.96))] px-3">
		<FileCode2 size={15} class="text-[#8fc4ed]" />
		<div class="min-w-0 flex-1">
			<strong class="block text-[11px] text-[#d6dde1]">File changes</strong>
			<small class="block truncate font-mono text-[8px] text-[#59656d]" title={workspace?.projectRoot}>{workspace?.isGit ? `${workspace.files.length} changed / Git` : "No Git repository"}</small>
		</div>
		<div bind:this={editorRoot} class="relative">
			<button type="button" aria-expanded={editorMenuOpen} class="flex h-8 items-center gap-1.5 rounded-md border border-[#2c353c] bg-[#10161b] px-2 text-[9px] text-[#b6c0c6] hover:border-[#4a565f]" onclick={() => (editorMenuOpen = !editorMenuOpen)}><ExternalLink size={11} /> Open <ChevronDown size={10} /></button>
			{#if editorMenuOpen}
				<div class="absolute top-[36px] right-0 z-30 w-[150px] rounded-md border border-[#303941] bg-[#0b0f13] p-1 shadow-[0_14px_36px_rgba(0,0,0,.55)]">
					{#each editors as editor (editor.id)}
						<button type="button" disabled={!editor.available} class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[9px] text-[#c8d0d4] hover:bg-[#171d22] disabled:cursor-not-allowed disabled:text-[#4e5961]" onclick={() => { editorMenuOpen = false; onopeneditor(editor.id); }}><Code2 size={11} /> {editor.label}<span class="ml-auto font-mono text-[7px]">{editor.available ? "" : "missing"}</span></button>
					{/each}
				</div>
			{/if}
		</div>
		<button type="button" aria-label="Refresh file changes" class="grid h-8 w-8 place-items-center rounded text-[#6f7b83] hover:bg-[#171d22] hover:text-[#d7dee2]" onclick={onrefresh}><RefreshCw size={13} /></button>
		<button type="button" aria-label="Close file panel" class="grid h-8 w-8 place-items-center rounded text-[#6f7b83] hover:bg-[#171d22] hover:text-[#d7dee2]" onclick={onclose}><X size={14} /></button>
	</header>

	<div class="shrink-0 overflow-y-auto bg-[#131c23] p-2" style={`height: ${listHeight}px;`}>
		{#if !workspace?.isGit}
			<p class="px-2 py-3 text-[10px]/[1.5] text-[#68747c]">The selected root is not inside a Git repository. Klerm tool changes still appear in the activity feed.</p>
		{:else if workspace.files.length === 0}
			<p class="px-2 py-3 text-[10px] text-[#68747c]">Working tree clean.</p>
		{:else}
			{#each workspace.files as file (file.path)}
				<button type="button" class={`mb-1 flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-2 text-left ${selectedPath === file.path ? "border-[#46525b] bg-[#151b20]" : "border-transparent hover:bg-[#11171c]"}`} onclick={() => onselect(file.path)}>
					<span class={`w-4 shrink-0 text-center font-mono text-[9px] font-bold ${statusBadgeClass(file.status)}`}>{file.status === "untracked" ? "?" : file.status[0]?.toUpperCase()}</span>
					<span class="min-w-0 flex-1">
						<strong class="block truncate font-mono text-[9px] font-medium text-[#bdc6cb]" title={file.path}>{file.path}</strong>
						<small class="mt-1 flex min-w-0 items-center gap-1 font-mono text-[7px]"><span class={`max-w-full truncate rounded border px-1 py-0.5 ${actorClass(file)}`} title={actorLabel(file)}>{actorLabel(file)}</span><span class="shrink-0 text-[#7b878f]">{stageLabel(file)}</span></small>
					</span>
				</button>
			{/each}
		{/if}
	</div>
	<button
		type="button"
		aria-label="Resize file list"
		class="flex h-2 shrink-0 cursor-row-resize items-center justify-center border-0 bg-[#131c23] hover:bg-[#1b252c]"
		onpointerdown={startListResize}
	>
		<span class="block h-0.5 w-8 rounded-full bg-[#4a5861]"></span>
	</button>

	<div class="flex min-h-0 flex-1 flex-col bg-[#0e151b]">
		{#if selectedPath}
			<div class="flex h-10 shrink-0 items-center border-b border-line-soft px-2">
				<button type="button" class={`flex h-8 items-center gap-1.5 rounded px-2 text-[9px] ${tab === "diff" ? "border border-[rgba(79,140,202,.35)] bg-[rgba(44,91,137,.28)] text-[#aed0ef]" : "text-[#788994] hover:text-[#cbd3d7]"}`} onclick={() => (tab = "diff")}><Braces size={11} /> Diff</button>
				<button type="button" disabled={content === undefined} class={`flex h-8 items-center gap-1.5 rounded px-2 text-[9px] ${tab === "edit" ? "border border-[rgba(65,159,96,.35)] bg-[rgba(34,101,55,.28)] text-[#a8d9b5]" : "text-[#788994] hover:text-[#cbd3d7]"} disabled:cursor-not-allowed disabled:opacity-35`} onclick={() => (tab = "edit")}><FileCode2 size={11} /> Edit</button>
				<span class="ml-2 min-w-0 flex-1 truncate font-mono text-[8px] text-[#77838b]" title={selectedPath}>{selectedPath}</span>
				{#if tab === "edit"}<button type="button" disabled={saving || editContent === originalContent} class="flex h-7 items-center gap-1 rounded border border-[#5fae74] bg-[#2f7d48] px-2 text-[8px] font-semibold text-white hover:bg-[#3d9158] disabled:cursor-not-allowed disabled:border-[#2d3a32] disabled:bg-[#202b24] disabled:text-[#596b60]" onclick={() => void save()}><Save size={10} /> Save</button>{/if}
			</div>
			{#if loading}
				<div class="grid flex-1 place-items-center font-mono text-[9px] text-[#65717a]">Loading file...</div>
			{:else if tab === "edit" && content !== undefined}
				<textarea bind:value={editContent} aria-label={`Edit ${selectedPath}`} class="min-h-0 flex-1 resize-none border-0 bg-[#101a20] p-4 font-mono text-[11px]/[1.6] text-[#d2dce1] outline-none [tab-size:2] [scrollbar-width:thin] focus:bg-[#132028]"></textarea>
			{:else}
				<pre class="m-0 min-h-0 flex-1 overflow-auto bg-[#101820] py-2 font-mono text-[9px]/[1.55] whitespace-pre [scrollbar-width:thin]">{#each (diff || "No textual diff available.").split("\n") as line, index (`${index}-${line}`)}<span class={`block min-w-fit px-3 ${diffLineClass(line)}`}>{line || " "}</span>{/each}</pre>
			{/if}
		{:else}
			<div class="grid flex-1 place-items-center px-8 text-center"><div><FileCode2 size={24} class="mx-auto mb-3 text-[#38434b]" /><p class="text-[10px]/[1.55] text-[#68747c]">Select a changed file to inspect its diff or edit the current text.</p></div></div>
		{/if}
	</div>
</aside>
