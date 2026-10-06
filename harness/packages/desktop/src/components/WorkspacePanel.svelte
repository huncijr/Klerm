<script lang="ts">
	import { Braces, ChevronDown, Code2, ExternalLink, FileCode2, FolderTree, GitBranch, RefreshCw, RotateCcw, Save, X } from "@lucide/svelte";
	import { onMount } from "svelte";
	import { useDesktopShortcuts } from "../lib/shortcuts.ts";
	import WebActivityView from "./WebActivityView.svelte";
	import {
		resolveWorkspaceEditDraft,
		setWorkspaceEditDraft,
		type WorkspaceEditDraft,
		workspaceEditDraftKey,
	} from "../lib/agent-workspace.ts";
	import type { EditorInfo, GitHubStatus, WorkspaceFileStatus, WorkspaceStatus } from "../lib/model.ts";

	let {
		workspace,
		webUrl,
		webSources,
		webOpenRequest,
		webSessionId,
		editors,
		selectedPath,
		diff,
		content,
		loading,
		saving,
		projectFiles,
		projectFilesTruncated,
		projectFilesLoading,
		editDrafts = $bindable<Record<string, WorkspaceEditDraft>>({}),
		onclose,
		onrefresh,
		onselect,
		onsave,
		onopeneditor,
		onviewprojectfiles,
		github,
		gitBusy,
		oninitializegit,
		onlogingithub,
	}: {
		workspace: WorkspaceStatus | undefined;
		webUrl: string;
		webSources: string[];
		webOpenRequest: number;
		webSessionId: string;
		editors: EditorInfo[];
		selectedPath: string | undefined;
		diff: string;
		content: string | undefined;
		loading: boolean;
		saving: boolean;
		projectFiles: string[] | undefined;
		projectFilesTruncated: boolean;
		projectFilesLoading: boolean;
		editDrafts?: Record<string, WorkspaceEditDraft>;
		onclose: () => void;
		onrefresh: () => void;
		onselect: (path: string) => void;
		onsave: (path: string, content: string) => Promise<boolean>;
		onopeneditor: (editor: EditorInfo["id"]) => void;
		onviewprojectfiles: () => void;
		github: GitHubStatus | undefined;
		gitBusy: boolean;
		oninitializegit: () => void;
		onlogingithub: () => void;
	} = $props();

	let tab = $state<"diff" | "edit">("diff");
	const shortcuts = useDesktopShortcuts();
	let listTab = $state<"changes" | "files" | "web">("changes");
	let lastWebUrl = "";
	let lastWebOpenRequest = 0;
	$effect(() => {
		if (webUrl && (webUrl !== lastWebUrl || webOpenRequest !== lastWebOpenRequest)) {
			lastWebUrl = webUrl;
			lastWebOpenRequest = webOpenRequest;
			listTab = "web";
		}
	});
	let collapsedPaths = $state<string[]>([]);
	let editContent = $state("");
	let originalContent = $state("");
	let editorMenuOpen = $state(false);
	let editorRoot: HTMLElement | undefined = $state();
	let panelEl: HTMLElement | undefined = $state();
	let listHeight = $state(180);

	$effect(() => {
		const path = selectedPath;
		const loaded = content;
		if (!path || loaded === undefined) return;
		const key = workspaceEditDraftKey(workspace?.projectRoot ?? "", path);
		const next = resolveWorkspaceEditDraft(editDrafts, key, loaded);
		if (editDrafts[key] !== next) editDrafts = setWorkspaceEditDraft(editDrafts, key, next.content, next.original);
		editContent = next.content;
		originalContent = next.original;
	});

	onMount(() => {
		const remove = [shortcuts?.register("save", save, () => tab === "edit" && listTab !== "web" && Boolean(selectedPath) && !saving && !loading && workspace?.trusted === true, 5)];
		const closeMenu = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !editorRoot?.contains(event.target)) editorMenuOpen = false;
		};
		document.addEventListener("pointerdown", closeMenu);
		return () => { document.removeEventListener("pointerdown", closeMenu); for (const cleanup of remove) cleanup?.(); };
	});

	function statusBadgeClass(status: WorkspaceFileStatus["status"]): string {
		if (status === "added" || status === "untracked") return "text-success";
		if (status === "deleted") return "text-danger";
		if (status === "renamed") return "text-info";
		return "text-muted";
	}

	interface ProjectFileNode {
		name: string;
		path: string;
		isFile: boolean;
		children: ProjectFileNode[];
	}

	function buildFileTree(paths: string[]): ProjectFileNode[] {
		const root: ProjectFileNode = { name: "", path: "", isFile: false, children: [] };
		for (const path of paths) {
			let current = root;
			const parts = path.split("/").filter(Boolean);
			parts.forEach((part, index) => {
				const isFile = index === parts.length - 1;
				const nodePath = current.path ? `${current.path}/${part}` : part;
				let child = current.children.find((candidate) => candidate.name === part);
				if (!child) {
					child = { name: part, path: nodePath, isFile, children: [] };
					current.children.push(child);
				}
				current = child;
			});
		}
		const sortNodes = (nodes: ProjectFileNode[]): ProjectFileNode[] =>
			nodes
				.map((node) => ({ ...node, children: sortNodes(node.children) }))
				.sort((a, b) => (a.isFile === b.isFile ? a.name.localeCompare(b.name) : a.isFile ? 1 : -1));
		return sortNodes(root.children);
	}

	const projectFileTree = $derived(buildFileTree(projectFiles ?? []));

	function actorLabel(file: WorkspaceFileStatus): string {
		const actor = file.attribution;
		if (actor.source === "manual" || actor.source === "external") return actor.source;
		const lane = actor.lane === "local" ? "Agent 1" : actor.lane === "frontier" ? "Agent 2" : actor.lane;
		const source = actor.source === "local" ? "Agent 1" : actor.source === "frontier" ? "Agent 2" : actor.source;
		const model = actor.provider && actor.model ? `${actor.provider}/${actor.model}` : actor.model;
		return [lane ?? source, model].filter(Boolean).join(" / ");
	}

	function actorClass(file: WorkspaceFileStatus): string {
		if (file.attribution.source === "local") return "border-success bg-raised text-success";
		if (file.attribution.source === "frontier") return "border-info bg-info-soft text-info";
		if (file.attribution.source === "manual") return "border-warning bg-danger-soft text-warning";
		return "border-line bg-panel text-muted";
	}

	function stageLabel(file: WorkspaceFileStatus): string {
		if (file.staged && file.worktreeStatus !== " ") return "staged + unstaged";
		return file.staged ? "staged" : "unstaged";
	}

	function diffLineClass(line: string): string {
		if (line.startsWith("+") && !line.startsWith("+++")) return "bg-success-soft text-success";
		if (line.startsWith("-") && !line.startsWith("---")) return "bg-danger-soft text-danger";
		if (line.startsWith("@@")) return "bg-info-soft text-info";
		return "text-muted";
	}

	function showListTab(next: "changes" | "files" | "web"): void {
		listTab = next;
		if (next === "files") onviewprojectfiles();
	}

	function toggleTreeFolder(path: string): void {
		collapsedPaths = collapsedPaths.includes(path)
			? collapsedPaths.filter((candidate) => candidate !== path)
			: [...collapsedPaths, path];
	}

	async function save(): Promise<void> {
		if (!selectedPath || editContent === originalContent) return;
		if (await onsave(selectedPath, editContent)) {
			originalContent = editContent;
			const key = workspaceEditDraftKey(workspace?.projectRoot ?? "", selectedPath);
			editDrafts = setWorkspaceEditDraft(editDrafts, key, editContent, editContent);
		}
	}

	function updateDraft(): void {
		if (!selectedPath) return;
		const key = workspaceEditDraftKey(workspace?.projectRoot ?? "", selectedPath);
		editDrafts = setWorkspaceEditDraft(editDrafts, key, editContent, originalContent);
	}

	function discardDraft(): void {
		if (!selectedPath) return;
		editContent = originalContent;
		const key = workspaceEditDraftKey(workspace?.projectRoot ?? "", selectedPath);
		editDrafts = setWorkspaceEditDraft(editDrafts, key, originalContent, originalContent);
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

<aside bind:this={panelEl} class="flex h-full min-h-0 min-w-0 flex-col border-l border-line bg-panel shadow-sm narrow-900:fixed narrow-900:inset-y-0 narrow-900:right-0 narrow-900:z-[18] narrow-900:w-[min(460px,92vw)] narrow-900:shadow-sm">
	<header class="flex h-[58px] shrink-0 items-center gap-2 border-b border-line bg-panel px-3">
		<FileCode2 size={15} class="text-info" />
		<div class="min-w-0 flex-1">
			<strong class="block text-[13px] text-ink">File changes</strong>
			<small class="block truncate font-sans text-[11px] text-dim" title={workspace?.projectRoot}>{workspace?.isGit ? `${workspace.files.length} changed / Git` : "No Git repository"}</small>
		</div>
		<div bind:this={editorRoot} class="relative">
			<button type="button" disabled={!workspace?.trusted} aria-expanded={editorMenuOpen} class="flex h-8 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-[12px] text-ink hover:border-line disabled:cursor-not-allowed disabled:opacity-45" onclick={() => (editorMenuOpen = !editorMenuOpen)}><ExternalLink size={11} /> Open <ChevronDown size={10} /></button>
			{#if editorMenuOpen}
				<div class="absolute top-[36px] right-0 z-30 w-[150px] rounded-md border border-line bg-bg p-1 shadow-sm">
					{#each editors as editor (editor.id)}
						<button type="button" disabled={!editor.available} class="flex w-full items-center gap-2 rounded px-2 py-2 text-left text-[12px] text-ink hover:bg-raised disabled:cursor-not-allowed disabled:text-dim" onclick={() => { editorMenuOpen = false; onopeneditor(editor.id); }}><Code2 size={11} /> {editor.label}<span class="ml-auto font-sans text-[11px]">{editor.available ? "" : "missing"}</span></button>
					{/each}
				</div>
			{/if}
		</div>
		<button type="button" aria-label="Refresh file changes" class="grid h-8 w-8 place-items-center rounded text-muted hover:bg-raised hover:text-ink" onclick={onrefresh}><RefreshCw size={13} /></button>
		<button type="button" aria-label="Close file panel" class="grid h-8 w-8 place-items-center rounded text-muted hover:bg-raised hover:text-ink" onclick={onclose}><X size={14} /></button>
	</header>

	<div class="flex shrink-0 items-center justify-end gap-1 bg-raised px-2 pt-2">
		<button
			type="button"
			class={`flex h-6 items-center gap-1 rounded px-2 text-[11px] ${listTab === "changes" ? "border border-info bg-info-soft text-info" : "border border-transparent text-muted hover:text-ink"}`}
			onclick={() => showListTab("changes")}
		>Changes</button>
		<button type="button" class={`flex h-6 items-center gap-1 rounded px-2 text-[11px] ${listTab === "web" ? "border border-info bg-info-soft text-info" : "border border-transparent text-muted hover:text-ink"}`} onclick={() => showListTab("web")}>External browser</button>
		<button
			type="button"
			class={`flex h-6 items-center gap-1 rounded px-2 text-[11px] ${listTab === "files" ? "border border-info bg-info-soft text-info" : "border border-transparent text-muted hover:text-ink"}`}
			onclick={() => showListTab("files")}
		><FolderTree size={10} /> View project files</button>
	</div>
	{#if listTab !== "web"}
	<div class="shrink-0 overflow-y-auto bg-raised p-2" style={`height: ${listHeight}px;`}>
		{#if listTab === "files"}
			{#if projectFilesLoading}
				<p class="px-2 py-3 text-[12px] text-muted">Loading project files...</p>
			{:else if !projectFiles || projectFiles.length === 0}
				<p class="px-2 py-3 text-[12px] text-muted">No files found in the project root.</p>
			{:else}
				{#snippet fileNode(node: ProjectFileNode, depth: number)}
					{#if node.isFile}
						<button type="button" class={`flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 pr-2 text-left ${selectedPath === node.path ? "bg-panel" : "hover:bg-panel"}`} style={`padding-left: ${8 + depth * 14}px;`} onclick={() => onselect(node.path)}>
							<span class="min-w-0 flex-1 truncate font-sans text-[12px] text-ink" title={node.path}>{node.name}</span>
						</button>
					{:else}
						<button type="button" class="flex w-full min-w-0 items-center gap-1 rounded py-1 pr-2 text-left font-sans text-[12px] text-muted hover:bg-panel" style={`padding-left: ${8 + depth * 14}px;`} onclick={() => toggleTreeFolder(node.path)}>
							<ChevronDown size={10} class={`shrink-0 transition-transform ${collapsedPaths.includes(node.path) ? "-rotate-90" : ""}`} />
							<span class="min-w-0 truncate">{node.name}/</span>
						</button>
						{#if !collapsedPaths.includes(node.path)}
							{#each node.children as child (child.path)}
								{@render fileNode(child, depth + 1)}
							{/each}
						{/if}
					{/if}
				{/snippet}
				{#if projectFilesTruncated}
					<p class="px-2 pb-1 text-[11px] text-warning">List truncated — showing the first {projectFiles.length} files.</p>
				{/if}
				{#each projectFileTree as node (node.path)}
					{@render fileNode(node, 0)}
				{/each}
			{/if}
		{:else if !workspace?.isGit}
			<div class="px-2 py-3 text-[12px]/[1.5] text-muted">
				<p class="m-0">The selected root is not inside a Git repository. Klerm tool changes still appear in the activity feed.</p>
				{#if workspace?.gitInitializationRecommendation}
					<p class="mt-2 mb-0 rounded border border-warning bg-danger-soft px-2 py-1.5 text-warning">{workspace.gitInitializationRecommendation}</p>
				{/if}
				<div class="mt-3 flex flex-wrap gap-2">
					<button type="button" disabled={gitBusy || !workspace?.trusted} class="flex items-center gap-1.5 rounded border border-info bg-info-soft px-2 py-1.5 font-sans text-[11px] text-info hover:bg-info-soft disabled:opacity-45" onclick={oninitializegit}><GitBranch size={11} /> Initialize Git</button>
					{#if github?.available && !github.authenticated}
						<button type="button" disabled={gitBusy} class="flex items-center gap-1.5 rounded border border-line bg-panel px-2 py-1.5 font-sans text-[11px] text-ink hover:bg-raised disabled:opacity-45" onclick={onlogingithub}><GitBranch size={11} /> Connect GitHub</button>
					{:else if github?.authenticated}
						<span class="flex items-center gap-1.5 px-2 py-1.5 font-sans text-[11px] text-success"><GitBranch size={11} /> GitHub connected</span>
					{/if}
				</div>
			</div>
		{:else if workspace.files.length === 0}
			<p class="px-2 py-3 text-[12px] text-muted">Working tree clean.</p>
		{:else}
			{#each workspace.files as file (file.path)}
				<button type="button" class={`mb-1 flex w-full min-w-0 items-center gap-2 rounded-md border px-2 py-2 text-left ${selectedPath === file.path ? "border-line bg-panel" : "border-transparent hover:bg-panel"}`} onclick={() => onselect(file.path)}>
					<span class={`w-4 shrink-0 text-center font-sans text-[12px] font-bold ${statusBadgeClass(file.status)}`}>{file.status === "untracked" ? "?" : file.status[0]?.toUpperCase()}</span>
					<span class="min-w-0 flex-1">
						<strong class="block truncate font-sans text-[12px] font-medium text-ink" title={file.path}>{file.path}</strong>
						<small class="mt-1 flex min-w-0 items-center gap-1 font-sans text-[11px]"><span class={`max-w-full truncate rounded border px-1 py-0.5 ${actorClass(file)}`} title={actorLabel(file)}>{actorLabel(file)}</span><span class="shrink-0 text-muted">{stageLabel(file)}</span></small>
					</span>
				</button>
			{/each}
		{/if}
	</div>
	<button
		type="button"
		aria-label="Resize file list"
		class="flex h-2 shrink-0 cursor-row-resize items-center justify-center border-0 bg-raised hover:bg-raised"
		onpointerdown={startListResize}
	>
		<span class="block h-0.5 w-8 rounded-full bg-raised"></span>
	</button>
	{/if}

	{#if listTab === "web"}
		{#if webUrl && webSessionId}
			{#key webSessionId}<WebActivityView sessionId={webSessionId} url={webUrl} sources={webSources} openRequest={webOpenRequest} onclose={() => (listTab = "changes")} />{/key}
		{:else}
			<div class="grid min-h-0 flex-1 place-items-center px-6 text-center text-[12px] text-muted">No web fetch has run yet. The latest AI web-tool page will appear here.</div>
		{/if}
	{:else}
	<div class="flex min-h-0 flex-1 flex-col bg-panel">
		{#if selectedPath}
			<div class="flex h-10 shrink-0 items-center border-b border-line-soft px-2">
				<button
					type="button"
					class={`flex h-8 items-center gap-1.5 rounded px-2 text-[12px] ${tab === "diff" ? "border border-info bg-info-soft text-info" : "text-muted hover:text-ink"}`}
					onclick={() => (tab = "diff")}
				><Braces size={11} /> Diff</button>
						<button
							type="button"
							disabled={content === undefined || !workspace?.trusted}
					class={`flex h-8 items-center gap-1.5 rounded px-2 text-[12px] disabled:cursor-not-allowed disabled:opacity-35 ${tab === "edit" ? "border border-success bg-success-soft text-success" : "text-muted hover:text-ink"}`}
					onclick={() => (tab = "edit")}
				><FileCode2 size={11} /> Edit</button>
				<span class="ml-2 min-w-0 flex-1 truncate font-sans text-[11px] text-muted" title={selectedPath}
					>{selectedPath}</span
				>
				{#if tab === "edit"}
					<button
						type="button"
						disabled={saving || editContent === originalContent}
						class="mr-1 flex h-7 items-center gap-1 rounded px-2 text-[11px] text-muted hover:bg-raised hover:text-ink disabled:cursor-not-allowed disabled:opacity-35"
						onclick={discardDraft}
					><RotateCcw size={10} /> Discard</button>
					<button
						type="button"
						disabled={saving || editContent === originalContent}
						class="flex h-7 items-center gap-1 rounded border border-success bg-success-soft px-2 text-[11px] font-semibold text-ink hover:bg-success-soft disabled:cursor-not-allowed disabled:border-line disabled:bg-raised disabled:text-dim"
						onclick={() => void save()}
					><Save size={10} /> Save</button>
				{/if}
			</div>
			{#if loading}
				<div class="grid flex-1 place-items-center font-sans text-[12px] text-muted">Loading file...</div>
			{:else if tab === "edit" && content !== undefined}
				<textarea
					bind:value={editContent}
					aria-label={`Edit ${selectedPath}`}
					class="min-h-0 flex-1 resize-none border-0 bg-panel p-4 font-sans text-[13px]/[1.6] text-ink outline-none [tab-size:2] [scrollbar-width:thin] focus:bg-raised"
					oninput={updateDraft}
				></textarea>
			{:else}
				<pre class="m-0 min-h-0 flex-1 overflow-auto bg-panel py-2 font-mono text-[12px]/[1.55] whitespace-pre [scrollbar-width:thin]">{#each (diff || "No textual diff available.").split("\n") as line}<span class={`block min-w-fit px-3 ${diffLineClass(line)}`}>{line || " "}</span>{/each}</pre>
			{/if}
		{:else}
			<div class="grid flex-1 place-items-center px-8 text-center"><div><FileCode2 size={24} class="mx-auto mb-3 text-dim" /><p class="text-[12px]/[1.55] text-muted">Select a changed file to inspect its diff or edit the current text.</p></div></div>
		{/if}
	</div>
	{/if}
</aside>
