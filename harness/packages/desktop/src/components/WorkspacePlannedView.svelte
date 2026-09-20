<script lang="ts">
	import { ArrowLeft, Check, CircleDot, FolderGit2, FolderOpen, Play, Plus, RotateCcw, Square } from "@lucide/svelte";
	import { onMount } from "svelte";
	import type {
		KanbanActivityEvent,
		KanbanBoard,
		KanbanRegistry,
		KanbanTask,
		KanbanTaskKind,
		KanbanTaskStatus,
		SelectOption,
	} from "../lib/model.ts";

	let {
		registry,
		workspaceRoot,
		models,
		activity,
		onclose,
		onsave,
		onpickfolder,
		onrun,
		onstop,
	}: {
		registry: KanbanRegistry;
		workspaceRoot: string;
		models: SelectOption[];
		activity: KanbanActivityEvent[];
		onclose: () => void;
		onsave: (registry: KanbanRegistry) => Promise<void>;
		onpickfolder: (initial?: string) => Promise<string | undefined>;
		onrun: (boardId: string, taskId: string) => void;
		onstop: (boardId: string, taskId: string) => void;
	} = $props();

	const columns: Array<{ id: KanbanTaskStatus; label: string; accent: string }> = [
		{ id: "ideas", label: "Ideas", accent: "bg-[#82919a]" },
		{ id: "planned", label: "Planned", accent: "bg-[#7ca8d7]" },
		{ id: "ready", label: "Ready", accent: "bg-[#d6e878]" },
		{ id: "running", label: "Running", accent: "bg-[#86d58a]" },
		{ id: "waiting", label: "Waiting", accent: "bg-[#e1b967]" },
		{ id: "review", label: "Review", accent: "bg-[#b791df]" },
		{ id: "done", label: "Done", accent: "bg-[#70c891]" },
	];
	const reasoningOptions = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
	const kindOptions: KanbanTaskKind[] = ["build", "fix", "review", "research", "maintenance"];

	let selectedBoardId = $state("");
	let selectedTaskId = $state("");
	let boardName = $state("");
	let taskTitle = $state("");
	let draftPrompt = $state("");
	let draftTaskId = $state("");
	let draftTaskTitle = $state("");
	let draftTaskKind = $state<KanbanTaskKind>("build");
	let draftTaskWorkspaceRoot = $state("");
	let draftTaskModel = $state("");
	let draftTaskReasoning = $state("medium");
	let draftTaskTargetMinutes = $state("");
	let draftTaskScheduledAt = $state("");
	let draftTaskRepeatMinutes = $state("");
	let draggedTaskId = $state("");
	let nowMs = $state(Date.now());

	const board = $derived(registry.boards.find((item) => item.id === selectedBoardId) ?? registry.boards[0]);
	const selectedTask = $derived(board?.tasks.find((task) => task.id === selectedTaskId));
	const taskActivity = $derived(
		selectedTask
			? activity.filter((event) => event.taskId === selectedTask.id).slice(-30)
			: [],
	);

	function sampleTask(
		title: string,
		status: KanbanTaskStatus,
		kind: KanbanTaskKind,
		sequence: number,
		now: string,
		root: string,
	): KanbanTask {
		return {
			id: `task-${crypto.randomUUID()}`,
			title,
			prompt: "",
			workspaceRoot: root,
			kind,
			reasoning: "medium",
			status,
			targetMinutes: status === "ready" ? 25 : undefined,
			createdAt: now,
			updatedAt: now,
			createdSequence: sequence,
		};
	}
	function starterBoard(name: string, root: string): KanbanBoard {
		const now = new Date().toISOString();
		return {
			id: `board-${crypto.randomUUID()}`,
			name,
			workspaceRoot: root,
			createdAt: now,
			updatedAt: now,
			createdSequence: registry.boards.length + 1,
			tasks: [
				sampleTask("Capture the next improvement", "ideas", "research", 1, now, root),
				sampleTask("Define acceptance criteria", "planned", "review", 2, now, root),
				sampleTask("Inspect workspace health", "ready", "maintenance", 3, now, root),
				sampleTask("Choose a review checklist", "review", "review", 4, now, root),
				sampleTask("Open the Kanban board", "done", "build", 5, now, root),
			],
		};
	}
	async function persist(next: KanbanRegistry): Promise<void> {
		await onsave(next);
	}
	onMount(() => {
		if (registry.boards.length === 0) void persist({ version: 1, boards: [starterBoard("Klerm Workspace", workspaceRoot)] });
		const timer = window.setInterval(() => (nowMs = Date.now()), 1000);
		return () => window.clearInterval(timer);
	});
	$effect(() => {
		if (board && selectedBoardId !== board.id) selectedBoardId = board.id;
	});
	$effect(() => {
		if (!selectedTask || selectedTask.id === draftTaskId) return;
		draftTaskId = selectedTask.id;
		draftTaskTitle = selectedTask.title;
		draftPrompt = selectedTask.prompt;
		draftTaskKind = selectedTask.kind;
		draftTaskWorkspaceRoot = selectedTask.workspaceRoot;
		draftTaskModel = selectedTask.model ?? "";
		draftTaskReasoning = selectedTask.reasoning;
		draftTaskTargetMinutes = selectedTask.targetMinutes?.toString() ?? "";
		draftTaskScheduledAt = selectedTask.scheduledAt ? toLocalInput(selectedTask.scheduledAt) : "";
		draftTaskRepeatMinutes = selectedTask.repeatMinutes?.toString() ?? "";
	});
	async function createBoard(): Promise<void> {
		const name = boardName.trim();
		if (!name) return;
		const next = starterBoard(name, workspaceRoot);
		await persist({ ...registry, boards: [...registry.boards, next] });
		selectedBoardId = next.id;
		boardName = "";
	}
	async function addTask(status: KanbanTaskStatus = "ideas"): Promise<void> {
		const title = taskTitle.trim();
		if (!title || !board) return;
		const now = new Date().toISOString();
		const task = sampleTask(title, status, "build", board.tasks.length + 1, now, board.workspaceRoot);
		task.prompt = draftPrompt.trim();
		await persist({
			...registry,
			boards: registry.boards.map((item) =>
				item.id === board.id ? { ...item, updatedAt: now, tasks: [...item.tasks, task] } : item,
			),
		});
		taskTitle = "";
		draftPrompt = "";
	}
	async function moveTask(taskId: string, status: KanbanTaskStatus): Promise<void> {
		if (!board) return;
		const now = new Date().toISOString();
		await persist({
			...registry,
			boards: registry.boards.map((item) =>
				item.id !== board.id
					? item
					: {
							...item,
							updatedAt: now,
							tasks: item.tasks.map((task) => (task.id === taskId ? { ...task, status, updatedAt: now } : task)),
						},
			),
		});
	}
	function toLocalInput(iso: string): string {
		const ms = Date.parse(iso);
		if (!Number.isFinite(ms)) return "";
		const date = new Date(ms);
		const pad = (value: number): string => value.toString().padStart(2, "0");
		return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
	}
	function parseLocalInput(value: string): string | undefined {
		if (!value) return undefined;
		const ms = Date.parse(value);
		return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
	}
	async function saveTask(): Promise<void> {
		if (!board || !selectedTask) return;
		const title = draftTaskTitle.trim();
		const root = draftTaskWorkspaceRoot.trim();
		if (!title || !root) return;
		const now = new Date().toISOString();
		const targetMinutes = Number(draftTaskTargetMinutes);
		const repeatMinutes = Number(draftTaskRepeatMinutes);
		await persist({
			...registry,
			boards: registry.boards.map((item) =>
				item.id !== board.id
					? item
					: {
							...item,
							updatedAt: now,
							tasks: item.tasks.map((task) =>
								task.id !== selectedTask.id
									? task
									: {
											...task,
											title,
											prompt: draftPrompt.trim(),
											kind: draftTaskKind,
											workspaceRoot: root,
											reasoning: draftTaskReasoning,
											model: draftTaskModel.trim() || undefined,
											targetMinutes:
												Number.isFinite(targetMinutes) && targetMinutes > 0 ? Math.round(targetMinutes) : undefined,
											repeatMinutes:
												Number.isFinite(repeatMinutes) && repeatMinutes > 0 ? Math.round(repeatMinutes) : undefined,
											scheduledAt: parseLocalInput(draftTaskScheduledAt),
											updatedAt: now,
										},
							),
						},
			),
		});
		selectedTaskId = "";
		draftTaskId = "";
	}
	async function browseFolder(): Promise<void> {
		const picked = await onpickfolder(draftTaskWorkspaceRoot.trim() || workspaceRoot);
		if (picked) draftTaskWorkspaceRoot = picked;
	}
	function kindLabel(kind: KanbanTaskKind): string {
		return kind === "maintenance" ? "Maintain" : kind[0]!.toUpperCase() + kind.slice(1);
	}
	function providerOf(model?: string): string {
		if (!model) return "Default model";
		const separator = model.indexOf("/");
		return separator > 0 ? model.slice(0, separator) : model;
	}
	function elapsedText(startedAt?: string): string {
		if (!startedAt) return "";
		const ms = nowMs - Date.parse(startedAt);
		if (!Number.isFinite(ms) || ms < 0) return "00:00";
		const totalSeconds = Math.floor(ms / 1000);
		const hours = Math.floor(totalSeconds / 3600);
		const minutes = Math.floor((totalSeconds % 3600) / 60);
		const seconds = totalSeconds % 60;
		const pad = (value: number): string => value.toString().padStart(2, "0");
		return hours > 0 ? `${pad(hours)}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
	}
	function scheduleText(task: KanbanTask): string {
		if (task.runStatus === "running" && task.runStartedAt) return `Running ${elapsedText(task.runStartedAt)}`;
		if (task.scheduledAt) {
			const ms = Date.parse(task.scheduledAt);
			if (Number.isFinite(ms)) {
				const date = new Date(ms);
				return ms > nowMs
					? `Scheduled ${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
					: "Scheduled time reached";
			}
		}
		if (task.lastRunAt) return `Last run ${new Date(task.lastRunAt).toLocaleDateString()}`;
		return "";
	}
	function formatTime(iso?: string): string {
		if (!iso) return "";
		const ms = Date.parse(iso);
		if (!Number.isFinite(ms)) return "";
		const date = new Date(ms);
		return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
	}
</script>

<div
	class="flex min-h-0 flex-col overflow-hidden bg-[radial-gradient(circle_at_45%_-20%,rgba(161,205,94,.11),transparent_36%),#080d11]"
>
	<header
		class="flex shrink-0 items-center gap-3 border-b border-[#26323a] bg-[rgba(8,13,17,.8)] px-5 py-3.5 backdrop-blur-xl"
	>
		<button
			type="button"
			aria-label="Back to workspace"
			class="grid h-9 w-9 place-items-center rounded-xl border border-[#314049] bg-[#11191e] text-[#a7b4b9] transition hover:-translate-x-0.5 hover:border-[#71838d] hover:text-white"
			onclick={onclose}><ArrowLeft size={15} /></button
		>
		<div class="min-w-0">
			<p class="m-0 font-mono text-[8px] tracking-[.16em] text-[#6e8087] uppercase">Work orchestration</p>
			<h1 class="mt-0.5 mb-0 text-[16px] font-semibold tracking-[-.02em] text-[#edf2f3]">Kanban</h1>
		</div>
		<div
			class="ml-auto flex items-center gap-2 rounded-full border border-[#2d3b42] bg-[#0c1419] px-3 py-1.5"
		>
			<CircleDot size={11} class="text-[#b9ea78]" />
			<span class="font-mono text-[8px] text-[#8ca0a3]"
				>{registry.boards.length} saved board{registry.boards.length === 1 ? "" : "s"}</span
			>
		</div>
	</header>
	<div class="grid min-h-0 flex-1 grid-cols-[238px_minmax(0,1fr)] max-[780px]:grid-cols-1">
		<aside class="min-h-0 border-r border-[#26323a] bg-[#0a1014]/70 p-3 max-[780px]:hidden">
			<p class="px-1 pt-1 pb-2 font-mono text-[8px] tracking-[.14em] text-[#667980] uppercase">Your Kanbans</p>
			<form
				class="flex gap-1.5"
				onsubmit={(event) => {
					event.preventDefault();
					void createBoard();
				}}
			>
				<input
					bind:value={boardName}
					maxlength="100"
					placeholder="New Kanban..."
					class="h-9 min-w-0 flex-1 rounded-xl border border-[#34434a] bg-[#0d151a] px-2.5 text-[10px] text-[#e7edef] outline-none placeholder:text-[#64767d] focus:border-[#78905f]"
				/>
				<button
					type="submit"
					aria-label="Create Kanban"
					class="grid h-9 w-9 place-items-center rounded-xl border border-[rgba(190,241,117,.43)] bg-[#3d5b2b] text-[#efffd9] transition hover:brightness-110"
					><Plus size={14} /></button
				>
			</form>
			<div class="mt-3 space-y-1">
				{#each registry.boards as item (item.id)}
					<button
						type="button"
						class={`w-full rounded-xl border p-2.5 text-left transition ${board?.id === item.id ? "border-[rgba(188,237,116,.33)] bg-[linear-gradient(120deg,rgba(90,130,55,.23),rgba(17,29,32,.9))]" : "border-transparent text-[#91a2a8] hover:border-[#2f4148] hover:bg-[#111a1f]"}`}
						onclick={() => (selectedBoardId = item.id)}
					>
						<span class="block truncate text-[10px] font-semibold text-[#dbe5e7]">{item.name}</span>
						<span class="mt-1 flex items-center gap-1 truncate font-mono text-[7px] text-[#6f8389]"
							><FolderGit2 size={9} /> {item.workspaceRoot}</span
						>
						<span class="mt-1.5 block font-mono text-[7px] text-[#9bbc79]"
							>{item.tasks.filter((task) => task.runStatus === "running").length} running · {item.tasks.length}
							cards</span
						>
					</button>
				{/each}
			</div>
		</aside>
		<section class="min-h-0 overflow-auto p-4 sm:p-5">
			{#if board}
				<div class="mx-auto flex min-w-[980px] max-w-[1680px] flex-col gap-4">
					<div class="flex items-end justify-between gap-4">
						<div>
							<h2 class="m-0 text-[18px] font-semibold tracking-[-.025em] text-[#ecf3f4]">{board.name}</h2>
							<p class="mt-1 mb-0 flex items-center gap-1.5 font-mono text-[8px] text-[#74868c]">
								<FolderGit2 size={10} /> {board.workspaceRoot}
							</p>
						</div>
						<form
							class="flex items-center gap-2"
							onsubmit={(event) => {
								event.preventDefault();
								void addTask();
							}}
						>
							<input
								bind:value={taskTitle}
								maxlength="160"
								placeholder="Capture a task..."
								class="h-10 w-60 rounded-xl border border-[#34444c] bg-[#0b1217] px-3 text-[10px] text-white outline-none placeholder:text-[#5e7077] focus:border-[#839d66]"
							/>
							<button
								type="submit"
								class="flex h-10 items-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] px-3.5 font-mono text-[9px] font-semibold text-[#f0ffdf] shadow-[0_10px_24px_rgba(93,139,54,.18)] transition hover:-translate-y-0.5"
								><Plus size={12} /> Add task</button
							>
						</form>
					</div>
					<div class="grid grid-cols-7 gap-2.5">
						{#each columns as column (column.id)}
							<div
								role="list"
								aria-label={column.label}
								class="min-h-[460px] rounded-2xl border border-[#27363d] bg-[rgba(10,17,21,.76)] p-2.5"
								ondragover={(event) => event.preventDefault()}
								ondrop={() => {
									if (draggedTaskId) void moveTask(draggedTaskId, column.id);
									draggedTaskId = "";
								}}
							>
								<div class="mb-3 flex items-center gap-2 px-1">
									<span class={`h-1.5 w-1.5 rounded-full ${column.accent}`}></span>
									<span class="font-mono text-[8px] tracking-[.11em] text-[#a6b4b7] uppercase">{column.label}</span>
									<span class="ml-auto rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#70848a]"
										>{board.tasks.filter((task) => task.status === column.id).length}</span
									>
								</div>
								<div class="space-y-2">
									{#each board.tasks.filter((task) => task.status === column.id) as task (task.id)}
										<button
											draggable="true"
											type="button"
											ondragstart={() => (draggedTaskId = task.id)}
											ondragend={() => (draggedTaskId = "")}
											onclick={() => (selectedTaskId = task.id)}
											class={`group relative w-full rounded-xl border p-2.5 text-left transition ${task.runStatus === "running" ? "border-[rgba(134,213,138,.55)] bg-[rgba(24,44,28,.55)]" : "border-[#31424a] bg-[#0e161b] hover:border-[#5c747d]"}`}
										>
											<span class="block text-[10px] leading-snug font-semibold text-[#e6eeee]">{task.title}</span>
											<span class="mt-1.5 flex flex-wrap items-center gap-1">
												<span
													class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#93a8ad]"
													>{kindLabel(task.kind)}</span
												>
												<span
													class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#93a8ad]"
													>{providerOf(task.model)}</span
												>
												{#if task.targetMinutes}
													<span
														class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#93a8ad]"
														>Target {task.targetMinutes}m</span
													>
												{/if}
												{#if task.repeatMinutes}
													<span
														class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#9bbc79]"
														>Repeat {task.repeatMinutes}m</span
													>
												{/if}
											</span>
											{#if scheduleText(task)}
												<span class="mt-1.5 block font-mono text-[7px] text-[#7f9298]">{scheduleText(task)}</span>
											{/if}
											{#if task.lastResult && task.runStatus !== "running"}
												<span class="mt-1.5 line-clamp-2 block text-[8px] leading-snug text-[#9fb0b4]"
													>{task.lastResult}</span
												>
											{/if}
											{#if task.runError}
												<span class="mt-1.5 line-clamp-2 block text-[8px] leading-snug text-[#d99a8c]"
													>{task.runError}</span
												>
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</div>
			{/if}
		</section>
	</div>
	{#if selectedTask && board}
		<div class="fixed inset-0 z-50 flex justify-end bg-black/55 backdrop-blur-[2px]">
			<div
				class="h-full w-[min(520px,94vw)] overflow-y-auto border-l border-[#34444b] bg-[#0c1419] p-5 shadow-[-24px_0_70px_rgba(0,0,0,.42)]"
				role="dialog"
				aria-modal="true"
				aria-label="Task details"
			>
				<form
					onsubmit={(event) => {
						event.preventDefault();
						void saveTask();
					}}
				>
					<div class="flex items-center gap-2">
						<p class="m-0 font-mono text-[8px] tracking-[.14em] text-[#89ad71] uppercase">Task card</p>
						<button
							type="button"
							class="ml-auto rounded-lg border border-[#34444b] px-2 py-1 font-mono text-[8px] text-[#a8b7ba] hover:text-white"
							onclick={() => (selectedTaskId = "")}>Close</button
						>
					</div>
					<label class="mt-4 block">
						<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Title</span>
						<input
							bind:value={draftTaskTitle}
							maxlength="160"
							class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-3 text-[11px] text-white outline-none focus:border-[#73905d]"
						/>
					</label>
					<label class="mt-3 block">
						<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Task brief</span>
						<textarea
							bind:value={draftPrompt}
							rows="7"
							placeholder="Describe the work, expected result, and verification..."
							class="w-full rounded-xl border border-[#34444b] bg-[#080e12] p-3 text-[10px] leading-[1.55] text-[#dce6e8] outline-none focus:border-[#73905d]"
						></textarea>
					</label>
					<div class="mt-3 grid grid-cols-2 gap-2">
						<label>
							<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Task type</span>
							<select
								bind:value={draftTaskKind}
								class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-2 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
							>
								{#each kindOptions as kind (kind)}
									<option value={kind}>{kindLabel(kind)}</option>
								{/each}
							</select>
						</label>
						<label>
							<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Reasoning</span>
							<select
								bind:value={draftTaskReasoning}
								class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-2 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
							>
								{#each reasoningOptions as level (level)}
									<option value={level}>{level}</option>
								{/each}
							</select>
						</label>
					</div>
					<div class="mt-3">
						<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Task folder</span>
						<div class="flex gap-1.5">
							<input
								bind:value={draftTaskWorkspaceRoot}
								placeholder="/workspace/folder"
								class="h-10 min-w-0 flex-1 rounded-xl border border-[#34444b] bg-[#080e12] px-3 font-mono text-[9px] text-[#dce6e8] outline-none focus:border-[#73905d]"
							/>
							<button
								type="button"
								title="Browse for a folder"
								aria-label="Browse for a folder"
								class="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-[#34444b] bg-[#11191e] text-[#a7b4b9] transition hover:border-[#71838d] hover:text-white"
								onclick={() => void browseFolder()}><FolderOpen size={14} /></button
							>
						</div>
					</div>
					<label class="mt-3 block">
						<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase"
							>AI model (provider/id, empty = default)</span
						>
						<input
							bind:value={draftTaskModel}
							maxlength="200"
							list="kanban-model-options"
							placeholder="Default model"
							class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-3 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
						/>
						<datalist id="kanban-model-options">
							{#each models as model (model.value)}
								<option value={model.value}>{model.label}</option>
							{/each}
						</datalist>
					</label>
					<div class="mt-3 grid grid-cols-2 gap-2">
						<label>
							<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Target minutes</span>
							<input
								bind:value={draftTaskTargetMinutes}
								min="1"
								type="number"
								placeholder="25"
								class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-3 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
							/>
						</label>
						<label>
							<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Repeat minutes</span>
							<input
								bind:value={draftTaskRepeatMinutes}
								min="1"
								type="number"
								placeholder="Off"
								class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-3 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
							/>
						</label>
					</div>
					<label class="mt-3 block">
						<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">First run</span>
						<input
							bind:value={draftTaskScheduledAt}
							type="datetime-local"
							class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-3 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
						/>
					</label>
					<p
						class="mt-3 mb-0 rounded-xl border border-[#344737] bg-[#10190f] p-3 text-[9px] leading-[1.6] text-[#b9cd9d]"
					>
						Target time tracks the expected duration. It does not mark the card complete. A set first run
						starts once through the backend scheduler; a repeat interval reschedules the task after every
						finished run and survives app restarts.
					</p>
					<button
						type="submit"
						class="mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] font-mono text-[9px] font-semibold text-[#f0ffdf]"
						><Check size={12} /> Save task card</button
					>
				</form>
				<div class="mt-4 rounded-2xl border border-[#2f4046] bg-[#091116] p-3">
					<p class="m-0 font-mono text-[8px] tracking-[.12em] text-[#71858a] uppercase">Execution</p>
					{#if selectedTask.runStatus === "running"}
						<p class="mt-1.5 mb-0 font-mono text-[11px] text-[#86d58a]">
							Run #{selectedTask.runCount ?? 1} · {elapsedText(selectedTask.runStartedAt)}
						</p>
						<p class="mt-1 mb-0 text-[9px] text-[#8ca0a3]">
							Started {formatTime(selectedTask.runStartedAt)}. Target is advisory only.
						</p>
					{:else if (selectedTask.runCount ?? 0) > 0}
						<p class="mt-1.5 mb-0 font-mono text-[10px] text-[#d6e1e3]">
							Run #{selectedTask.runCount} · {selectedTask.runStatus ?? "idle"}
							{#if selectedTask.lastRunAt}· {formatTime(selectedTask.lastRunAt)}{/if}
						</p>
						{#if selectedTask.runError}
							<p class="mt-1 mb-0 text-[9px] leading-snug text-[#d99a8c]">{selectedTask.runError}</p>
						{/if}
					{:else}
						<p class="mt-1.5 mb-0 text-[9px] text-[#8ca0a3]">Never run. Save a task brief first.</p>
					{/if}
					<div class="mt-2.5 flex gap-1.5">
						{#if selectedTask.runStatus === "running"}
							<button
								type="button"
								class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(217,154,140,.5)] bg-[#3a2119] font-mono text-[9px] font-semibold text-[#f3c9bd]"
								onclick={() => onstop(board.id, selectedTask.id)}><Square size={12} /> Stop</button
							>
						{:else if (selectedTask.runCount ?? 0) > 0}
							<button
								type="button"
								class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] font-mono text-[9px] font-semibold text-[#f0ffdf]"
								onclick={() => onrun(board.id, selectedTask.id)}><RotateCcw size={12} /> Retry</button
							>
						{:else}
							<button
								type="button"
								class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] font-mono text-[9px] font-semibold text-[#f0ffdf]"
								onclick={() => onrun(board.id, selectedTask.id)}><Play size={12} /> Run</button
							>
						{/if}
					</div>
				</div>
				{#if selectedTask.lastResult}
					<div class="mt-3 rounded-2xl border border-[#2f4046] bg-[#091116] p-3">
						<p class="m-0 font-mono text-[8px] tracking-[.12em] text-[#71858a] uppercase">Final result</p>
						<p class="mt-1.5 mb-0 text-[9px] leading-relaxed whitespace-pre-wrap text-[#c4d2d5]">
							{selectedTask.lastResult}
						</p>
					</div>
				{/if}
				<div class="mt-3 rounded-2xl border border-[#2f4046] bg-[#091116] p-3">
					<p class="m-0 font-mono text-[8px] tracking-[.12em] text-[#71858a] uppercase">
						Activity · {taskActivity.length}
					</p>
					{#if taskActivity.length === 0}
						<p class="mt-1.5 mb-0 text-[9px] text-[#8ca0a3]">
							No backend activity yet. Runs stream tool and completion events here.
						</p>
					{:else}
						<ul class="mt-2 mb-0 list-none space-y-1.5 p-0">
							{#each taskActivity as event (event.timestamp + event.kind + event.text)}
								<li class="rounded-lg bg-[#0c1419] px-2 py-1.5">
									<span class="block font-mono text-[7px] text-[#667980]"
										>{event.kind} · {formatTime(event.timestamp)}</span
									>
									<span class="mt-0.5 block text-[9px] leading-snug text-[#c4d2d5]">{event.text}</span>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</div>
		</div>
	{/if}
</div>
