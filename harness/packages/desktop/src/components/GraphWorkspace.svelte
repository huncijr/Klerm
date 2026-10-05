<script lang="ts">
	import { onMount, tick, untrack } from "svelte";
	import { ArrowLeft, Plus, Save, RefreshCw, Trash2, Check, Maximize2, GitBranch, Search, X, Link } from "@lucide/svelte";
	import type { GraphCatalogItem, GraphCatalogPage, GraphCatalogQuery, GraphSourceDetails, GraphSourceRef, WorkflowDefinition, WorkflowEdgeKind, WorkflowNodeKind, WorkflowValidation } from "../../../coding-agent/src/klerm/workflows.ts";
	import { graphSourceKey, parseGraphSource, WORKFLOW_EDGE_KINDS } from "../../../coding-agent/src/klerm/workflows.ts";
	import type { WorkflowSummary } from "../../../coding-agent/src/klerm/workflow-store.ts";
	import { addGraphNode, blankWorkflow, connectGraphNodes, graphDropPosition, graphNodeColor, GRAPH_NODE_WIDTH, GRAPH_NODE_HEIGHT, removeGraphNode } from "../lib/graph.ts";

	let { workspaceRoot, sourceRevision = 0, request, onclose, onopensource }: {
		workspaceRoot: string; sourceRevision?: number;
		request: <T>(type: string, fields?: Record<string, unknown>) => Promise<T>;
		onclose: () => void; onopensource: (ref: GraphSourceRef) => void;
	} = $props();
	let workflows = $state<WorkflowSummary[]>([]);
	let storageRoot = $state(untrack(() => workspaceRoot));
	let workflow = $state<WorkflowDefinition>();
	let catalog = $state<GraphCatalogItem[]>([]);
	let sourceItems = $state<Record<string, GraphCatalogItem>>({});
	let nextOffset = $state<number>();
	let category = $state<"agents" | "kanban" | "history" | "blocks">("agents");
	let search = $state("");
	let owner = $state("");
	let panel = $state<"add" | "inspect">("add");
	let selectedNodeId = $state("");
	let selectedEdgeId = $state("");
	let connecting = $state("");
	let edgeKind = $state<WorkflowEdgeKind>("depends-on");
	let details = $state<GraphSourceDetails>();
	let validation = $state<WorkflowValidation>();
	let dirty = $state(false);
	let busy = $state(false);
	let error = $state("");
	let notice = $state("");
	let bottomTab = $state<"timeline" | "report" | "changes">("timeline");
	let showBottom = $state(true);
	let confirmDelete = $state(false);
	let mounted = false;
	let canvas: HTMLDivElement;
	let catalogEpoch = 0;
	let detailEpoch = 0;
	let drag: { id?: string; x: number; y: number; originalX: number; originalY: number } | undefined;
	const selectedNode = $derived(workflow?.nodes.find((node) => node.id === selectedNodeId));
	const selectedEdge = $derived(workflow?.edges.find((edge) => edge.id === selectedEdgeId));
	const zoom = $derived(workflow?.viewport.zoom ?? 1);
	const blocks: Array<{ kind: WorkflowNodeKind; title: string; description: string }> = [
		{ kind: "start", title: "Start", description: "Manual trigger design" }, { kind: "task", title: "Task", description: "Brief and expected work" },
		{ kind: "condition", title: "Condition", description: "Outcome-based branch design" }, { kind: "join", title: "Join", description: "Combine required inputs" },
		{ kind: "human-review", title: "Human review", description: "User decision boundary" }, { kind: "end", title: "End", description: "Workflow result design" },
	];

	function mutate(next: WorkflowDefinition): void { workflow = next; dirty = true; validation = undefined; notice = "Unsaved draft"; }
	function nodeItem(id: string): GraphCatalogItem | undefined {
		const ref = workflow?.nodes.find((node) => node.id === id)?.sourceRef;
		return ref ? sourceItems[graphSourceKey(ref)] : undefined;
	}
	async function refreshList(): Promise<void> {
		const result = await request<{ workflows: WorkflowSummary[]; workspaceRoot: string }>("list_workflows"); workflows = result.workflows; storageRoot = result.workspaceRoot;
	}
	async function refreshCatalog(append = false): Promise<void> {
		if (category === "blocks") return;
		const epoch = ++catalogEpoch;
		try {
			const query: GraphCatalogQuery = { category, search, ownerBotId: owner || undefined, offset: append ? nextOffset : 0, limit: 60 };
			const page = await request<GraphCatalogPage>("get_graph_catalog", { query });
			if (epoch !== catalogEpoch) return;
			catalog = append ? [...catalog, ...page.items] : page.items; nextOffset = page.nextOffset;
			sourceItems = { ...sourceItems, ...Object.fromEntries(page.items.map((item) => [item.key, item])) };
		} catch (failure) { if (epoch === catalogEpoch) error = String(failure); }
	}
	async function refreshNodeSources(): Promise<void> {
		const current = workflow;
		if (!current) return;
		const rows = await Promise.all(current.nodes.filter((node) => node.sourceRef).map(async (node) => {
			try { const value = await request<GraphSourceDetails>("get_graph_source_details", { sourceRef: node.sourceRef }); return [graphSourceKey(node.sourceRef!), value.item] as const; }
			catch { return [graphSourceKey(node.sourceRef!), undefined] as const; }
		}));
		if (workflow?.id !== current.id) return;
		const next = { ...sourceItems }; for (const [key, item] of rows) { if (item) next[key] = item; else delete next[key]; } sourceItems = next;
	}
	async function inspect(id: string, reveal = true): Promise<void> {
		selectedNodeId = id; selectedEdgeId = ""; if (reveal) panel = "inspect"; details = undefined;
		const epoch = ++detailEpoch, node = workflow?.nodes.find((node) => node.id === id);
		if (!node?.sourceRef) return;
		try {
			const value = await request<GraphSourceDetails>("get_graph_source_details", { sourceRef: node.sourceRef });
			if (epoch === detailEpoch && selectedNodeId === id) { details = value; sourceItems = { ...sourceItems, [value.item.key]: value.item }; }
		} catch (failure) { if (epoch === detailEpoch) error = String(failure); }
	}
	async function load(id: string): Promise<void> {
		if (busy) return;
		if (dirty) { error = "Save this draft before changing workflows, or use Discard changes."; return; }
		busy = true; error = "";
		try {
			workflow = await request<WorkflowDefinition>("get_workflow", { workflowId: id });
			const savedViewport = { ...workflow.viewport };
			selectedNodeId = ""; selectedEdgeId = ""; details = undefined; validation = undefined; connecting = ""; confirmDelete = false;
			await tick(); if (canvas) { canvas.scrollLeft = savedViewport.x * savedViewport.zoom; canvas.scrollTop = savedViewport.y * savedViewport.zoom; }
			await refreshNodeSources();
		} catch (failure) { error = String(failure); } finally { busy = false; }
	}
	function create(): void {
		if (dirty) { error = "Save or discard the current draft first."; return; }
		workflow = blankWorkflow(storageRoot, `workflow-${crypto.randomUUID()}`); dirty = true;
		selectedNodeId = ""; selectedEdgeId = ""; details = undefined; validation = undefined; notice = "New unsaved workflow"; confirmDelete = false;
	}
	async function save(): Promise<void> {
		if (!workflow || busy) return;
		busy = true; error = "";
		try {
			workflow = await request<WorkflowDefinition>("save_workflow", { workflow, expectedRevision: workflow.revision }); dirty = false; notice = `Saved revision ${workflow.revision}`;
			await refreshList();
		} catch (failure) { error = String(failure); } finally { busy = false; }
	}
	async function discard(): Promise<void> {
		if (!workflow) return;
		const id = workflow.id, saved = workflow.revision > 0; dirty = false;
		if (saved) await load(id); else { workflow = undefined; details = undefined; selectedNodeId = ""; }
		notice = "Draft changes discarded";
	}
	async function deleteWorkflow(): Promise<void> {
		if (!workflow || busy) return;
		if (!workflow.revision) { dirty = false; workflow = undefined; confirmDelete = false; return; }
		busy = true; error = "";
		try {
			await request("delete_workflow", { workflowId: workflow.id, expectedRevision: workflow.revision });
			workflow = undefined; dirty = false; details = undefined; confirmDelete = false; await refreshList(); notice = "Graph deleted; its sources are retained.";
		} catch (failure) { error = String(failure); } finally { busy = false; }
	}
	async function validate(): Promise<void> {
		if (!workflow || busy) return;
		busy = true; error = "";
		try { validation = await request<WorkflowValidation>("validate_workflow", { workflow }); notice = validation.valid ? "Draft structure valid; execution is not enabled." : "Fix the highlighted graph issues."; }
		catch (failure) { error = String(failure); } finally { busy = false; }
	}
	function add(kind: WorkflowNodeKind, item?: GraphCatalogItem, position?: { x: number; y: number }): void {
		if (!workflow) { workflow = blankWorkflow(storageRoot, `workflow-${crypto.randomUUID()}`); dirty = true; }
		try {
			const id = `node-${crypto.randomUUID()}`;
			const point = position ?? { x: (canvas?.scrollLeft ?? 0) / zoom + 50 + workflow.nodes.length % 3 * 250, y: (canvas?.scrollTop ?? 0) / zoom + 50 + Math.floor(workflow.nodes.length / 3) * 170 };
			mutate(addGraphNode(workflow, id, kind, point, item)); if (item) sourceItems = { ...sourceItems, [item.key]: item }; void inspect(id);
		} catch (failure) { error = String(failure); }
	}
	function drop(event: DragEvent): void {
		event.preventDefault();
		try {
			const key = event.dataTransfer?.getData("application/x-klerm-graph-source");
			const item = catalog.find((item) => item.key === key);
			if (!item) throw new Error("Drag a source from this graph's catalog.");
			parseGraphSource(item.sourceRef);
			const box = canvas.getBoundingClientRect();
			add(item.nodeKind, item, graphDropPosition({ x: event.clientX, y: event.clientY }, box, { x: canvas.scrollLeft, y: canvas.scrollTop }, zoom));
		} catch (failure) { error = String(failure); }
	}
	function connect(target: string): void {
		if (!workflow || !connecting) return;
		try { mutate(connectGraphNodes(workflow, `edge-${crypto.randomUUID()}`, edgeKind, connecting, target)); connecting = ""; error = ""; }
		catch (failure) { error = String(failure); }
	}
	function pointerStart(event: PointerEvent, id?: string): void {
		if (!workflow || event.button !== 0) return;
		if (!id && event.target instanceof Element && event.target.closest("article,button,path,input,select,textarea")) return;
		const node = id ? workflow.nodes.find((node) => node.id === id) : undefined;
		drag = { id, x: event.clientX, y: event.clientY, originalX: node?.position.x ?? canvas.scrollLeft, originalY: node?.position.y ?? canvas.scrollTop };
		(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
		if (id) void inspect(id);
	}
	function pointerMove(event: PointerEvent): void {
		if (!drag || !workflow) return;
		if (drag.id) {
			const position = { x: Math.max(20, Math.min(5700, drag.originalX + (event.clientX - drag.x) / zoom)), y: Math.max(20, Math.min(3700, drag.originalY + (event.clientY - drag.y) / zoom)) };
			mutate({ ...workflow, nodes: workflow.nodes.map((node) => node.id === drag!.id ? { ...node, position } : node) });
		} else { canvas.scrollLeft = drag.originalX - (event.clientX - drag.x); canvas.scrollTop = drag.originalY - (event.clientY - drag.y); }
	}
	function captureViewport(): void {
		if (!workflow || !canvas) return;
		workflow = { ...workflow, viewport: { ...workflow.viewport, x: canvas.scrollLeft / zoom, y: canvas.scrollTop / zoom } };
	}
	async function setZoom(value: number): Promise<void> {
		if (!workflow) return;
		const center = { x: (canvas.scrollLeft + canvas.clientWidth / 2) / zoom, y: (canvas.scrollTop + canvas.clientHeight / 2) / zoom };
		mutate({ ...workflow, viewport: { ...workflow.viewport, zoom: Math.max(0.2, Math.min(2.5, value)) } });
		await tick(); canvas.scrollLeft = center.x * zoom - canvas.clientWidth / 2; canvas.scrollTop = center.y * zoom - canvas.clientHeight / 2;
	}
	async function fit(): Promise<void> {
		if (!workflow?.nodes.length) return;
		const left = Math.min(...workflow.nodes.map((node) => node.position.x)), top = Math.min(...workflow.nodes.map((node) => node.position.y));
		const width = Math.max(...workflow.nodes.map((node) => node.position.x + GRAPH_NODE_WIDTH)) - left + 80;
		const height = Math.max(...workflow.nodes.map((node) => node.position.y + GRAPH_NODE_HEIGHT)) - top + 80;
		await setZoom(Math.min(1.2, canvas.clientWidth / width, canvas.clientHeight / height));
		canvas.scrollLeft = Math.max(0, left - 40) * zoom; canvas.scrollTop = Math.max(0, top - 40) * zoom;
	}
	function updateNode(field: "title" | "brief" | "note", value: string): void {
		if (workflow && selectedNode) mutate({ ...workflow, nodes: workflow.nodes.map((node) => node.id === selectedNode.id ? { ...node, [field]: value } : node) });
	}
	function updatePosition(axis: "x" | "y", value: string): void {
		const coordinate = Number(value);
		if (!workflow || !selectedNode || !Number.isFinite(coordinate)) return;
		mutate({ ...workflow, nodes: workflow.nodes.map((node) => node.id === selectedNode.id ? { ...node, position: { ...node.position, [axis]: Math.max(20, Math.min(axis === "x" ? 5700 : 3700, coordinate)) } } : node) });
	}
	function removeSelected(): void {
		if (!workflow) return;
		mutate(selectedNodeId ? removeGraphNode(workflow, selectedNodeId) : { ...workflow, edges: workflow.edges.filter((edge) => edge.id !== selectedEdgeId) });
		selectedNodeId = ""; selectedEdgeId = ""; details = undefined; connecting = "";
	}
	function autoLayout(): void {
		if (!workflow) return;
		mutate({ ...workflow, nodes: workflow.nodes.map((node, index) => ({ ...node, position: { x: 50 + index % 4 * 280, y: 50 + Math.floor(index / 4) * 190 } })) }); void fit();
	}
	function closeGraph(): void {
		if (dirty) { error = "Save or discard the draft before leaving the graph."; return; }
		onclose();
	}
	function openSource(): void {
		if (dirty) { error = "Save or discard the draft before opening another workspace view."; return; }
		if (selectedNode?.sourceRef) onopensource(selectedNode.sourceRef);
	}

	onMount(() => {
		mounted = true;
		void (async () => { try { await refreshList(); if (workflows[0]) await load(workflows[0].id); await refreshCatalog(); } catch (failure) { error = String(failure); } })();
	});
	$effect(() => {
		category; search; owner;
		if (!mounted) return;
		const timer = window.setTimeout(() => { catalog = []; nextOffset = undefined; void untrack(() => refreshCatalog()); }, 250);
		return () => window.clearTimeout(timer);
	});
	$effect(() => {
		sourceRevision;
		if (!mounted) return;
		const timer = window.setTimeout(() => untrack(() => { void refreshCatalog(); void refreshNodeSources(); if (selectedNodeId) void inspect(selectedNodeId, false); }), 500);
		return () => window.clearTimeout(timer);
	});
</script>

<section class="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#080e13] text-[#cad5db]" aria-label="Workflow graph workspace">
	<header class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#293740] px-4 py-3">
		<button type="button" aria-label="Back to workspace" class="graph-icon" onclick={closeGraph}><ArrowLeft size={15} /></button>
		<GitBranch size={18} class="text-[#b9e67f]" /><strong class="text-sm">Workflows / Graph</strong>
		<span class="rounded-full border border-[#43512f] px-2 py-1 text-[9px] text-[#b9e67f]">Draft & history · no execution</span>
		<span class="ml-auto truncate text-[9px] text-[#7d919d]" title={storageRoot}>{storageRoot}</span>
	</header>
	<div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-[#293740] bg-[#10191f] px-4 py-2 text-[10px]">
		<button type="button" class="graph-button" disabled={busy} onclick={create}><Plus size={12} /> New</button>
		<select aria-label="Saved workflow" class="graph-input max-w-[240px]" value={workflow?.revision ? workflow.id : ""} disabled={busy} onchange={(event) => void load(event.currentTarget.value)}><option value="" disabled>Saved workflows ({workflows.length})</option>{#each workflows as item (item.id)}<option value={item.id}>{item.name} · r{item.revision}</option>{/each}</select>
		{#if workflow}<input aria-label="Workflow name" class="graph-input w-44" maxlength="100" value={workflow.name} oninput={(event) => workflow && mutate({ ...workflow, name: event.currentTarget.value })} />{/if}
		<button type="button" class="graph-button" disabled={!workflow || busy} onclick={() => void save()}><Save size={12} /> Save {dirty ? "*" : ""}</button>
		<button type="button" class="graph-button" disabled={!workflow || busy} onclick={() => void validate()}><Check size={12} /> Validate</button>
		{#if dirty}<button type="button" class="graph-button" disabled={busy} onclick={() => void discard()}>Discard changes</button>{/if}
		<button type="button" class="graph-button" disabled={!workflow || busy} onclick={() => (confirmDelete = !confirmDelete)}><Trash2 size={12} /> Delete graph</button>
		<span class="ml-auto text-[9px] text-[#8ca0aa]">{busy ? "Working…" : notice || (workflow ? `Revision ${workflow.revision}` : "Create a workflow or add a catalog item")}</span>
	</div>
	{#if confirmDelete}<div class="flex items-center gap-3 bg-[#321b19] px-4 py-2 text-[10px]">Delete this graph only? Agents, cards, attempts and files remain.<button type="button" class="graph-button" onclick={() => void deleteWorkflow()}>Confirm delete</button><button type="button" class="graph-button" onclick={() => (confirmDelete = false)}>Cancel</button></div>{/if}
	{#if error}<div class="flex items-center gap-2 border-b border-[#6e3a35] bg-[#291713] px-4 py-2 text-[10px] text-[#f0b9ad]">{error}<button type="button" aria-label="Dismiss graph error" class="ml-auto" onclick={() => (error = "")}><X size={13} /></button></div>{/if}
	<div class="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_300px] max-[900px]:grid-cols-[minmax(0,1fr)_230px]">
		<div class="relative flex min-h-0 min-w-0 flex-col">
			<div class="flex shrink-0 flex-wrap items-center gap-2 px-3 py-2 text-[10px]">
				<label class="flex items-center gap-2"><Link size={12} /> Relationship <select class="graph-input" aria-label="Connection relationship" bind:value={edgeKind}>{#each WORKFLOW_EDGE_KINDS as kind}<option value={kind}>{kind}</option>{/each}</select></label>
				<span class="text-[9px] text-[#7c939f]">{connecting ? "Choose a target's In port" : "Drag a title to move · Out → In to connect"}</span>
				{#if connecting}<button type="button" class="graph-button" onclick={() => (connecting = "")}>Cancel connection</button>{/if}
				<button type="button" class="graph-button ml-auto" onclick={() => void fit()}><Maximize2 size={12} /> Fit</button><button type="button" class="graph-button" onclick={autoLayout}>Layout</button>
				<button type="button" class="graph-button" aria-label="Zoom out" onclick={() => void setZoom(zoom - 0.15)}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" class="graph-button" aria-label="Zoom in" onclick={() => void setZoom(zoom + 0.15)}>+</button>
			</div>
			<div bind:this={canvas} role="region" aria-label="Graph canvas" class="relative min-h-0 flex-1 overflow-auto bg-[radial-gradient(#263b46_1px,transparent_1px)] bg-[size:20px_20px]" ondragover={(event) => event.preventDefault()} ondrop={drop} onpointerdown={(event) => pointerStart(event)} onpointermove={pointerMove} onpointerup={() => { drag = undefined; }} onpointercancel={() => { drag = undefined; }} onscroll={captureViewport}>
				<div class="relative" style={`width:${6000 * zoom}px;height:${4000 * zoom}px;`}>
					<div class="absolute top-0 left-0" style={`width:6000px;height:4000px;transform:scale(${zoom});transform-origin:0 0;`}>
						<svg class="pointer-events-none absolute inset-0" width="6000" height="4000" aria-label="Graph connections">
							<defs><marker id="graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#8da9b6" /></marker></defs>
							{#each workflow?.edges ?? [] as edge (edge.id)}
								{@const first = workflow?.nodes.find((node) => node.id === edge.source)}{@const second = workflow?.nodes.find((node) => node.id === edge.target)}
								{#if first && second}
									{@const x1 = first.position.x + GRAPH_NODE_WIDTH}{@const y1 = first.position.y + 75}{@const x2 = second.position.x}{@const y2 = second.position.y + 75}
									<path d={`M${x1},${y1} C${x1 + 80},${y1} ${x2 - 80},${y2} ${x2},${y2}`} fill="none" stroke={selectedEdgeId === edge.id ? "#b9e67f" : edge.kind === "artifact" ? "#b999f1" : "#7297aa"} stroke-width={selectedEdgeId === edge.id ? 4 : 2} stroke-dasharray={edge.kind === "assigned-to" || edge.kind === "membership" ? "5 5" : undefined} marker-end="url(#graph-arrow)" />
									<path role="button" tabindex="0" aria-label={`Inspect ${edge.kind} connection`} d={`M${x1},${y1} C${x1 + 80},${y1} ${x2 - 80},${y2} ${x2},${y2}`} fill="none" stroke="transparent" stroke-width="18" style="pointer-events:stroke;cursor:pointer" onclick={() => { selectedEdgeId = edge.id; selectedNodeId = ""; details = undefined; panel = "inspect"; }} onkeydown={(event) => { if (event.key === "Enter") { selectedEdgeId = edge.id; selectedNodeId = ""; panel = "inspect"; } }} />
									<text x={(x1 + x2) / 2} y={(y1 + y2) / 2 - 10} text-anchor="middle" fill="#a3bac6" font-size="10">{edge.label || edge.kind}</text>
								{/if}
							{/each}
						</svg>
						{#each workflow?.nodes ?? [] as node (node.id)}
							{@const item = nodeItem(node.id)}
							<article class={`absolute overflow-hidden rounded-xl border bg-[#111c24] shadow-lg ${selectedNodeId === node.id ? "ring-2 ring-[#b9e67f]" : ""}`} style={`left:${node.position.x}px;top:${node.position.y}px;width:${GRAPH_NODE_WIDTH}px;height:${GRAPH_NODE_HEIGHT}px;border-color:${graphNodeColor(node.kind)};`} aria-label={`Graph node ${node.title}`}>
								<button type="button" class="flex w-full cursor-grab items-center gap-2 border-b border-[#2c3b45] px-3 py-2 text-left text-[11px] font-semibold touch-none" onpointerdown={(event) => pointerStart(event, node.id)} onclick={() => void inspect(node.id)}><span class="h-2 w-2 rounded-full" style={`background:${graphNodeColor(node.kind)};`}></span><span class="truncate">{node.title}</span></button>
								<button type="button" class="block w-full px-3 py-2 text-left" onclick={() => void inspect(node.id)}>
									<span class="block text-[8px] uppercase tracking-wider text-[#87a1b1]">{node.kind} · {item?.status ?? (node.sourceRef ? "source missing / loading" : "design")}</span>
									<span class="mt-1 block truncate text-[9px] text-[#a7bfca]">{item?.model ?? item?.subtitle ?? "No execution dispatched"}</span>
									<span class="mt-1 block truncate text-[8px] text-[#698594]" title={item?.workspaceRoot}>{item?.workspaceRoot || "Reference / workflow step"}</span>
								</button>
								<div class="absolute inset-x-0 bottom-0 flex justify-between bg-[#0a131a] px-2 py-1 text-[9px]"><button type="button" class="rounded px-2 py-0.5 text-[#9db9cd] hover:bg-[#284150]" aria-label={`Connect into ${node.title}`} onclick={() => connect(node.id)}>● In</button><button type="button" class={`rounded px-2 py-0.5 ${connecting === node.id ? "bg-[#3d5128] text-[#dbfbb6]" : "text-[#9db9cd] hover:bg-[#284150]"}`} aria-label={`Connect from ${node.title}`} onclick={() => { connecting = node.id; selectedNodeId = node.id; }}>Out ●</button></div>
							</article>
						{/each}
					</div>
				</div>
			</div>
			{#if !workflow?.nodes.length}<div class="pointer-events-none absolute top-24 left-8 max-w-sm rounded-xl border border-[#314653] bg-[#101c25]/95 p-5 text-xs text-[#9cb4c3]"><strong class="mb-2 block text-[#dce9f0]">Build a view of your existing work</strong>Add Personal Agents, Kanban cards and past attempts from the right. Drawing a graph does not start or repeat their work.</div>{/if}
			<div class="absolute right-4 bottom-4 overflow-hidden rounded-lg border border-[#3a5262] bg-[#0b141c]/95"><svg role="img" aria-label="Graph minimap" width="140" height="90" viewBox="0 0 6000 4000">{#each workflow?.nodes ?? [] as node (node.id)}<rect x={node.position.x} y={node.position.y} width={GRAPH_NODE_WIDTH} height={GRAPH_NODE_HEIGHT} fill={graphNodeColor(node.kind)} />{/each}</svg></div>
		</div>
		<aside class="flex min-h-0 flex-col border-l border-[#293740] bg-[#0e171e]" aria-label="Graph sources and inspector">
			<div class="flex shrink-0 gap-2 border-b border-[#293740] p-3"><button type="button" class={`graph-button flex-1 ${panel === "add" ? "text-[#b9e67f]" : ""}`} onclick={() => (panel = "add")}>Add existing work</button><button type="button" class={`graph-button flex-1 ${panel === "inspect" ? "text-[#b9e67f]" : ""}`} onclick={() => (panel = "inspect")}>Inspect</button></div>
			<div class="min-h-0 flex-1 overflow-auto p-3">
				{#if panel === "add"}
					<div class="flex flex-wrap gap-1">{#each ["agents", "kanban", "history", "blocks"] as tab}<button type="button" class={`graph-button ${category === tab ? "text-[#b9e67f]" : ""}`} onclick={() => { category = tab as typeof category; owner = ""; }}>{tab}</button>{/each}</div>
					<div class="my-3 flex gap-1"><label class="relative flex-1"><Search size={12} class="absolute top-2.5 left-2 text-[#708d9e]" /><input aria-label="Search graph sources" class="graph-input w-full pl-7" bind:value={search} placeholder="Name, folder, status…" /></label><button type="button" aria-label="Refresh graph sources" class="graph-icon" onclick={() => void refreshCatalog()}><RefreshCw size={13} /></button></div>
					{#if owner}<p class="mb-2 text-[10px] text-[#b9e67f]">Assigned to {owner} <button type="button" class="underline" onclick={() => (owner = "")}>Clear</button></p>{/if}
					{#if category === "blocks"}
						{#each blocks.filter((block) => !search || block.title.toLowerCase().includes(search.toLowerCase())) as block}<button type="button" class="catalog-item" onclick={() => add(block.kind)}><strong>{block.title}</strong><span>{block.description}</span></button>{/each}
					{:else}
						{#each catalog as item (item.key)}
							<div class="catalog-item" draggable="true" ondragstart={(event) => { event.dataTransfer?.setData("application/x-klerm-graph-source", item.key); }} role="group" aria-label={item.title}>
								<strong>{item.title}</strong><span>{item.subtitle}</span><span class="truncate" title={item.workspaceRoot}>{item.status} {item.workspaceRoot ? `· ${item.workspaceRoot}` : ""}</span>
								<div class="mt-2 flex flex-wrap gap-1"><button type="button" class="graph-button" onclick={() => add(item.nodeKind, item)}><Plus size={10} /> Add</button>
								{#if item.sourceRef.kind === "personal-agent"}<button type="button" class="graph-button" onclick={() => { owner = item.sourceRef.botId!; category = "kanban"; search = ""; }}>Bot's cards</button>{/if}
								{#if item.sourceRef.kind === "kanban-card"}<button type="button" class="graph-button" onclick={() => { category = "history"; search = item.sourceRef.taskId!; }}>Attempts</button>{/if}</div>
							</div>
						{:else}<p class="py-4 text-[11px] text-[#6f8a9a]">No matching saved sources. Refresh or change the filter.</p>{/each}
						{#if nextOffset !== undefined}<button type="button" class="graph-button w-full" onclick={() => void refreshCatalog(true)}>Load more</button>{/if}
					{/if}
				{:else if selectedNode}
					<p class="mb-3 text-[9px] uppercase tracking-widest" style={`color:${graphNodeColor(selectedNode.kind)};`}>{selectedNode.kind}</p>
					<label class="graph-label">Node label<input class="graph-input w-full" maxlength="160" value={selectedNode.title} oninput={(event) => updateNode("title", event.currentTarget.value)} /></label>
					<div class="grid grid-cols-2 gap-2"><label class="graph-label">X<input type="number" class="graph-input w-full" min="20" max="5700" value={selectedNode.position.x} onchange={(event) => updatePosition("x", event.currentTarget.value)} /></label><label class="graph-label">Y<input type="number" class="graph-input w-full" min="20" max="3700" value={selectedNode.position.y} onchange={(event) => updatePosition("y", event.currentTarget.value)} /></label></div>
					{#if selectedNode.kind === "task"}<label class="graph-label">Task brief<textarea class="graph-input min-h-32 w-full" maxlength="8000" value={selectedNode.brief} oninput={(event) => updateNode("brief", event.currentTarget.value)}></textarea></label>{/if}
					<label class="graph-label">Workflow note<textarea class="graph-input min-h-20 w-full" maxlength="2000" value={selectedNode.note} oninput={(event) => updateNode("note", event.currentTarget.value)}></textarea></label>
					{#if selectedNode.sourceRef}
						<pre class="my-3 overflow-auto rounded-lg bg-[#081119] p-2 text-[9px] text-[#7895a7]">{JSON.stringify(selectedNode.sourceRef, null, 2)}</pre>
						{#if details}<p class="mb-2 break-all text-[10px] text-[#a9c1cf]">{details.item.status} · {details.item.model ?? ""}<br />{details.item.workspaceRoot}</p>{/if}
						<button type="button" class="graph-button mb-3" onclick={openSource}>Open source view</button>
						<p class="mb-3 text-[9px] text-[#708d9f]">This is a reference. Source settings and history are not copied or changed by moving/deleting this node.</p>
					{/if}
					<button type="button" class="graph-button text-[#e8a79b]" onclick={removeSelected}><Trash2 size={12} /> Remove node from graph</button>
				{:else if selectedEdge}
					<p class="mb-3 text-[11px] text-[#b9e67f]">{selectedEdge.kind}</p><p class="mb-3 break-all text-[9px] text-[#6c899c]">{selectedEdge.source} → {selectedEdge.target}</p>
					<label class="graph-label">Connection label<input class="graph-input w-full" maxlength="120" value={selectedEdge.label} oninput={(event) => workflow && mutate({ ...workflow, edges: workflow.edges.map((edge) => edge.id === selectedEdge!.id ? { ...edge, label: event.currentTarget.value } : edge) })} /></label>
					<button type="button" class="graph-button text-[#e8a79b]" onclick={removeSelected}>Remove connection</button>
				{:else}<p class="text-[11px] text-[#7994a5]">Select a node or connection to inspect it.</p>{/if}
				{#if validation}<div class="mt-5 rounded-lg border border-[#324956] p-3 text-[10px]"><strong>{validation.valid ? "Valid draft structure" : "Invalid graph"}</strong><p class="my-2 text-[#839cab]">No execution dispatched. Flow order: {validation.order.map((id) => workflow?.nodes.find((node) => node.id === id)?.title ?? id).join(" → ")}</p>{#each validation.issues as issue}<p class={`my-2 ${issue.severity === "error" ? "text-[#e6a193]" : "text-[#dfc286]"}`}>{issue.code}: {issue.message}</p>{/each}</div>{/if}
			</div>
		</aside>
	</div>
	<div class="shrink-0 border-t border-[#293740] bg-[#0c151c]">
		<div class="flex items-center gap-2 px-4 py-2 text-[10px]">{#each ["timeline", "report", "changes"] as tab}<button type="button" class={`graph-button ${bottomTab === tab ? "text-[#b9e67f]" : ""}`} onclick={() => { bottomTab = tab as typeof bottomTab; showBottom = true; }}>{tab}</button>{/each}<span class="ml-2 truncate text-[#698799]">{details?.item.title ?? "Select a card, attempt or conversation to see existing evidence"}</span><button type="button" class="ml-auto graph-button" onclick={() => (showBottom = !showBottom)}>{showBottom ? "Hide" : "Show"}</button></div>
		{#if showBottom}<div class="max-h-44 min-h-16 overflow-auto px-4 pb-3 text-[10px]">
			{#if bottomTab === "timeline"}{#each details?.activity ?? [] as event}<p class="my-1"><span class="font-mono text-[#627f92]">{event.timestamp} · {event.kind}</span> <span>{event.text}</span></p>{:else}<p class="text-[#627f92]">No persisted activity recorded for this source.</p>{/each}
			{:else if bottomTab === "report"}<pre class="whitespace-pre-wrap break-words text-[#bacbd7]">{details?.summary || "No saved report selected."}</pre>
			{:else}<pre class="whitespace-pre-wrap text-[#a9c1cf]">Changed files: {details?.changedFiles.join(", ") || "none recorded"}{"\n"}Successful checks: {details?.verification.join("\n") || "none recorded"}</pre>{/if}
		</div>{/if}
	</div>
</section>

<style>
	.graph-button { display:flex;align-items:center;justify-content:center;gap:5px;border:1px solid #334b5b;border-radius:7px;padding:6px 8px;font-size:10px;background:#14212a;cursor:pointer; }
	.graph-button:hover { border-color:#86a5b9; } .graph-button:disabled { opacity:.4;cursor:not-allowed; }
	.graph-icon { display:grid;place-items:center;width:30px;height:30px;border:1px solid #334b5b;border-radius:8px;cursor:pointer; }
	.graph-input { border:1px solid #334b5b;border-radius:7px;padding:7px;background:#09131a;font-size:10px;color:#d2e2eb;outline:none; }
	.graph-input:focus { border-color:#b9e67f; } .graph-label { display:block;margin-bottom:12px;font-size:10px;color:#8faab9; }
	.graph-label .graph-input { display:block;margin-top:5px; }
	.catalog-item { display:block;width:100%;border:1px solid #304757;border-radius:10px;margin-bottom:8px;padding:11px;background:#111f29;text-align:left;font-size:10px; }
	.catalog-item strong { display:block;color:#d2e3ed;font-weight:600; } .catalog-item span { display:block;margin-top:4px;color:#7594a8;font-size:9px; }
</style>
