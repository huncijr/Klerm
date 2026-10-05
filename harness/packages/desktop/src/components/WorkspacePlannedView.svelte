<script lang="ts">
	import {
		ArrowLeft,
		Check,
		CircleDot,
		FolderGit2,
		FolderOpen,
		Lightbulb,
		LoaderCircle,
		Play,
		Plus,
		RotateCcw,
		Square,
		X,
	} from "@lucide/svelte";
	import { onMount } from "svelte";
	import type {
		KanbanActivityEvent,
		KanbanBoard,
		KanbanRegistry,
		KanbanRunAttempt,
		KanbanTask,
		KanbanTaskKind,
		KanbanTaskStatus,
		PersonalBot,
	} from "../lib/model.ts";

	let {
		registry,
		workspaceRoot,
		personalAgents,
		activity,
		onclose,
		onsave,
		onpickfolder,
		onrun,
		onstop,
		ondelete,
		focusBoardId,
		focusTaskId,
	}: {
		registry: KanbanRegistry;
		workspaceRoot: string;
		personalAgents: PersonalBot[];
		activity: KanbanActivityEvent[];
		onclose: () => void;
		onsave: (registry: KanbanRegistry) => Promise<void>;
		onpickfolder: (initial?: string) => Promise<string | undefined>;
		onrun: (boardId: string, taskId: string) => Promise<void>;
		onstop: (boardId: string, taskId: string) => Promise<void>;
		ondelete: (boardId: string) => Promise<void>;
		focusBoardId?: string;
		focusTaskId?: string;
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
	const kindOptions: KanbanTaskKind[] = ["auto", "build", "fix", "review", "research", "maintenance"];

	let selectedBoardId = $state("");
	let appliedGraphFocus = "";
	let selectedTaskId = $state("");
	let boardName = $state("");
	let draftPrompt = $state("");
	let draftTaskId = $state("");
	let draftTaskTitle = $state("");
	let draftTaskKind = $state<KanbanTaskKind>("auto");
	let draftTaskWorkspaceRoot = $state("");
	let draftTaskModel = $state("");
	let draftPersonalBotId = $state("");
	let draftTaskReasoning = $state("");
	let draftTaskTargetMinutes = $state("");
	let draftTargetMode = $state<"auto" | "custom">("auto");
	let draftTaskScheduledAt = $state("");
	let draftTaskRepeatMinutes = $state("");
	let draftScheduleEnabled = $state(false);
	let draggedTaskId = $state("");
	let nowMs = $state(Date.now());
	let detailTab = $state<"execution" | "schedule">("execution");
	let operationBusy = $state(false);
	let pageError = $state("");
	let confirmDelete = $state(false);
	let drawerMessage = $state("");
	let drawerError = $state("");

	const board = $derived(registry.boards.find((item) => item.id === selectedBoardId) ?? registry.boards[0]);
	const selectedTask = $derived(board?.tasks.find((task) => task.id === selectedTaskId));
	const runnableAgents = $derived(
		personalAgents.filter((agent) => agent.enabled && agent.kanbanEnabled && agent.model),
	);
	const taskActivity = $derived(
		selectedTask
			? history(selectedTask).slice(-100)
			: [],
	);
	const upcomingSchedule = $derived(selectedTask ? nextSchedule(selectedTask) : undefined);

	function blankTask(status: KanbanTaskStatus, sequence: number, now: string): KanbanTask {
		return {
			id: `task-${crypto.randomUUID()}`,
			title: "",
			prompt: "",
			workspaceRoot: "",
			kind: "auto",
			reasoning: "",
			status,
			createdAt: now,
			updatedAt: now,
			createdSequence: sequence,
		};
	}
	function emptyBoard(name: string, root: string): KanbanBoard {
		const now = new Date().toISOString();
		return {
			id: `board-${crypto.randomUUID()}`,
			name,
			workspaceRoot: root,
			createdAt: now,
			updatedAt: now,
			createdSequence: registry.boards.length + 1,
			tasks: [],
		};
	}
	async function persist(next: KanbanRegistry): Promise<void> {
		await onsave(next);
	}
	onMount(() => {
		const timer = window.setInterval(() => (nowMs = Date.now()), 1000);
		return () => window.clearInterval(timer);
	});
	$effect(() => {
		if (board && selectedBoardId !== board.id) selectedBoardId = board.id;
	});
	$effect(() => {
		const key = JSON.stringify([focusBoardId, focusTaskId]);
		if (key !== appliedGraphFocus && focusBoardId && registry.boards.some((item) => item.id === focusBoardId)) {
			appliedGraphFocus = key;
			selectedBoardId = focusBoardId;
			if (focusTaskId) selectedTaskId = focusTaskId;
		}
	});
	$effect(() => {
		selectedBoardId;
		confirmDelete = false;
	});
	$effect(() => {
		if (!selectedTask || selectedTask.id === draftTaskId) return;
		draftTaskId = selectedTask.id;
		draftTaskTitle = selectedTask.title;
		draftPrompt = selectedTask.prompt;
		draftTaskKind = selectedTask.kind;
		draftTaskWorkspaceRoot = selectedTask.workspaceRoot;
		draftTaskModel = selectedTask.model ?? "";
		draftPersonalBotId = selectedTask.personalBotId ?? "";
		draftTaskReasoning = selectedTask.reasoning || (selectedTask.model ? "medium" : "");
		draftTaskTargetMinutes = selectedTask.targetMinutes?.toString() ?? "";
		draftTargetMode = selectedTask.targetMinutes ? "custom" : "auto";
		draftTaskScheduledAt = selectedTask.scheduledAt ? toLocalInput(selectedTask.scheduledAt) : "";
		draftTaskRepeatMinutes = selectedTask.repeatMinutes?.toString() ?? "";
		draftScheduleEnabled = Boolean(selectedTask.scheduledAt || selectedTask.repeatMinutes);
		detailTab = selectedTask.scheduledAt || selectedTask.repeatMinutes ? "schedule" : "execution";
		drawerMessage = "";
		drawerError = "";
	});
	$effect(() => {
		if (!selectedTask) return;
		if (!draftPersonalBotId) {
			draftPersonalBotId = runnableAgents[0]?.id ?? "";
		}
	});
	$effect(() => {
		if (draftTaskModel && !draftTaskReasoning) draftTaskReasoning = "medium";
	});
	async function createBoard(): Promise<void> {
		if (operationBusy) return;
		const name = boardName.trim() || `New Kanban ${registry.boards.length + 1}`;
		const next = emptyBoard(name, workspaceRoot);
		operationBusy = true;
		pageError = "";
		try {
			await persist({ ...registry, boards: [...registry.boards, next] });
			selectedBoardId = next.id;
			boardName = "";
		} catch (error) {
			pageError = error instanceof Error ? error.message : String(error);
		} finally {
			operationBusy = false;
		}
	}
	async function deleteBoard(): Promise<void> {
		if (!board || operationBusy) return;
		operationBusy = true;
		pageError = "";
		try {
			await ondelete(board.id);
			selectedTaskId = "";
			confirmDelete = false;
		} catch (error) {
			pageError = error instanceof Error ? error.message : String(error);
		} finally {
			operationBusy = false;
		}
	}
	async function addTask(status: KanbanTaskStatus = "planned"): Promise<void> {
		if (!board || operationBusy) return;
		const now = new Date().toISOString();
		const task = blankTask(status, board.tasks.length + 1, now);
		operationBusy = true;
		pageError = "";
		try {
			await persist({
				...registry,
				boards: registry.boards.map((item) =>
					item.id === board.id ? { ...item, updatedAt: now, tasks: [...item.tasks, task] } : item,
				),
			});
			selectedTaskId = task.id;
			draftTaskId = "";
		} catch (error) {
			pageError = error instanceof Error ? error.message : String(error);
		} finally {
			operationBusy = false;
		}
	}
	async function moveTask(taskId: string, status: KanbanTaskStatus): Promise<void> {
		if (!board) return;
		const now = new Date().toISOString();
		pageError = "";
		try {
			await persist({
				...registry,
				boards: registry.boards.map((item) =>
					item.id !== board.id
						? item
						: {
								...item,
								updatedAt: now,
								tasks: item.tasks.map((task) =>
									task.id === taskId ? { ...task, status, updatedAt: now } : task,
								),
							},
				),
			});
		} catch (error) {
			pageError = error instanceof Error ? error.message : String(error);
		}
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
	function missingRunFields(): string[] {
		const missing: string[] = [];
		if (!draftTaskTitle.trim()) missing.push("title");
		if (!draftPrompt.trim()) missing.push("task brief");
		if (!draftTaskWorkspaceRoot.trim()) missing.push("task folder");
		if (!draftPersonalBotId) missing.push("Personal Agent");
		return missing;
	}
	async function saveTask(closeAfter = false, requireRunnable = false): Promise<boolean> {
		if (!board || !selectedTask || operationBusy || selectedTask.runStatus === "running") return false;
		const title = draftTaskTitle.trim();
		const root = draftTaskWorkspaceRoot.trim();
		const missing = missingRunFields();
		if ((requireRunnable || draftScheduleEnabled) && missing.length > 0) {
			drawerError = `Complete these required fields before ${draftScheduleEnabled && !requireRunnable ? "scheduling" : "running"}: ${missing.join(", ")}.`;
			return false;
		}
		const now = new Date().toISOString();
		const targetMinutes = Number(draftTaskTargetMinutes);
		const repeatMinutes = Number(draftTaskRepeatMinutes);
		drawerMessage = "";
		drawerError = "";
		operationBusy = true;
		let saved = false;
		try {
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
												reasoning: draftTaskModel ? draftTaskReasoning : "",
												model: draftPersonalBotId ? undefined : draftTaskModel || undefined,
												personalBotId: draftPersonalBotId || undefined,
												targetMinutes:
													draftTargetMode === "custom" && Number.isFinite(targetMinutes) && targetMinutes > 0
														? Math.round(targetMinutes)
														: undefined,
												repeatMinutes:
													draftScheduleEnabled && Number.isFinite(repeatMinutes) && repeatMinutes > 0
														? Math.round(repeatMinutes)
														: undefined,
												scheduledAt: draftScheduleEnabled ? parseLocalInput(draftTaskScheduledAt) : undefined,
												updatedAt: now,
											},
								),
							},
				),
			});
			drawerMessage = "Saved";
			saved = true;
		} catch (error) {
			drawerError = error instanceof Error ? error.message : String(error);
		} finally {
			operationBusy = false;
		}
		if (saved && closeAfter) closeDrawer();
		return saved;
	}
	function closeDrawer(): void {
		if (operationBusy) return;
		selectedTaskId = "";
		draftTaskId = "";
		drawerMessage = "";
		drawerError = "";
	}
	async function runTask(): Promise<void> {
		if (!board || !selectedTask || operationBusy) return;
		if (!(await saveTask(false, true))) return;
		operationBusy = true;
		drawerMessage = "Starting...";
		drawerError = "";
		try {
			await onrun(board.id, selectedTask.id);
			drawerMessage = "Run started";
		} catch (error) {
			drawerMessage = "";
			drawerError = error instanceof Error ? error.message : String(error);
		} finally {
			operationBusy = false;
		}
	}
	async function stopTask(): Promise<void> {
		if (!board || !selectedTask || operationBusy) return;
		operationBusy = true;
		drawerMessage = "Stopping...";
		drawerError = "";
		try {
			await onstop(board.id, selectedTask.id);
			drawerMessage = "Stop requested";
		} catch (error) {
			drawerMessage = "";
			drawerError = error instanceof Error ? error.message : String(error);
		} finally {
			operationBusy = false;
		}
	}
	async function browseFolder(): Promise<void> {
		const picked = await onpickfolder(draftTaskWorkspaceRoot.trim() || workspaceRoot);
		if (picked) draftTaskWorkspaceRoot = picked;
	}
	function kindLabel(kind: KanbanTaskKind): string {
		if (kind === "auto") return "Auto";
		return kind === "maintenance" ? "Maintain" : kind[0]!.toUpperCase() + kind.slice(1);
	}
	function providerOf(model?: string): string {
		if (!model) return "Auto model";
		const separator = model.indexOf("/");
		return separator > 0 ? model.slice(0, separator) : model;
	}
	function latestAttempt(task: KanbanTask): KanbanRunAttempt | undefined {
		return task.attempts?.length ? task.attempts[task.attempts.length - 1] : undefined;
	}
	function activeStep(task: KanbanTask): string | undefined {
		return latestAttempt(task)?.steps.find((step) => step.status === "active")?.label;
	}
	function cardActivity(task: KanbanTask): KanbanActivityEvent[] {
		return history(task).slice(-3);
	}
	function history(task: KanbanTask): KanbanActivityEvent[] {
		const events = [...(task.attempts?.flatMap((attempt) => attempt.activity ?? []) ?? []), ...activity.filter((event) => event.boardId === board?.id && event.taskId === task.id)];
		const unique = new Map(events.map((event) => [activityKey(event), event]));
		return [...unique.values()].sort((left, right) => left.timestamp.localeCompare(right.timestamp));
	}
	function activityKey(event: KanbanActivityEvent): string {
		return event.attemptId && event.sequence ? `${event.attemptId}:${event.sequence}` : event.timestamp + event.kind + event.text;
	}
	function runAgentLabel(task: KanbanTask): string {
		const agent = task.personalBotId ? personalAgents.find((candidate) => candidate.id === task.personalBotId) : undefined;
		const attemptModel = latestAttempt(task)?.model;
		if (latestAttempt(task)?.agentName) return `${latestAttempt(task)?.agentName} · ${attemptModel ?? ""}`;
		if (agent) return `${agent.name} · ${attemptModel ?? agent.model ?? ""}`.trim();
		return attemptModel ?? providerOf(task.model);
	}
	function nextSchedule(task: KanbanTask): { label: string; detail: string } | undefined {
		if (task.scheduledAt) {
			const ms = Date.parse(task.scheduledAt);
			if (Number.isFinite(ms)) {
				const date = new Date(ms);
				const when = `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
				if (ms > nowMs)
					return {
						label: `Next run ${when}`,
						detail: task.repeatMinutes
							? `Repeats every ${task.repeatMinutes}m after the first run`
							: "One-time run while the app is open",
					};
				return {
					label: "Scheduled time reached",
					detail: task.repeatMinutes
						? `Repeats every ${task.repeatMinutes}m while the app is open`
						: "Runs once while the app is open",
				};
			}
		}
		if (task.repeatMinutes)
			return {
				label: "Repeating schedule",
				detail: `Every ${task.repeatMinutes}m while the app is open${task.lastRunAt ? ` · last run ${formatTime(task.lastRunAt)}` : ""}`,
			};
		return undefined;
	}
	function stepMarker(status: string): string {
		if (status === "completed") return "x";
		if (status === "active") return ">";
		if (status === "failed") return "!";
		if (status === "skipped") return "-";
		return "o";
	}
	function displayTitle(task: KanbanTask): string {
		return task.title.trim() || "Untitled task";
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

<svelte:window onkeydown={(event) => { if (event.key === "Escape" && selectedTask) closeDrawer(); }} />

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
					disabled={operationBusy}
					aria-label="Create Kanban"
					title={boardName.trim() ? "Create Kanban" : "Create a new Kanban with an automatic name"}
					class="grid h-9 w-9 place-items-center rounded-xl border border-[rgba(190,241,117,.43)] bg-[#3d5b2b] text-[#efffd9] transition hover:brightness-110 disabled:cursor-wait disabled:opacity-50"
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
							>{#if item.tasks.some((task) => task.runStatus === "running")}<LoaderCircle size={9} class="mr-1 inline animate-spin" />{/if}{item.tasks.filter((task) => task.runStatus === "running").length} running · {item.tasks.length} cards</span
						>
					</button>
				{/each}
			</div>
		</aside>
		<section class="min-h-0 overflow-auto p-4 sm:p-5">
			{#if pageError}
				<p class="mx-auto mb-3 max-w-[1680px] rounded-xl border border-[#71453c] bg-[#2b1713] p-2.5 text-[9px] text-[#efb2a3]">
					{pageError}
				</p>
			{/if}
			{#if board}
				<div class="mx-auto flex min-w-[980px] max-w-[1680px] flex-col gap-4">
					<div class="flex items-end justify-between gap-4">
						<div>
							<h2 class="m-0 text-[18px] font-semibold tracking-[-.025em] text-[#ecf3f4]">{board.name}</h2>
							<p class="mt-1 mb-0 flex items-center gap-1.5 font-mono text-[8px] text-[#74868c]">
								<FolderGit2 size={10} /> {board.workspaceRoot}
							</p>
						</div>
						<div class="flex gap-2">
							{#if confirmDelete}
								<span class="self-center text-[9px] text-[#d99a8c]">Delete this board and its {board.tasks.length} cards?</span>
								<button type="button" disabled={operationBusy} class="rounded-xl border border-[#71453c] px-3 text-[9px] text-[#efb2a3]" onclick={() => void deleteBoard()}>Confirm delete</button>
								<button type="button" class="px-2 text-[9px] text-[#a7b4b9]" onclick={() => (confirmDelete = false)}>Cancel</button>
							{:else}
								<button type="button" disabled={operationBusy || board.tasks.some((task) => task.runStatus === "running")} class="rounded-xl border border-[#71453c] px-3 text-[9px] text-[#efb2a3] disabled:opacity-40" onclick={() => (confirmDelete = true)}>Delete board</button>
							{/if}
							<button
								type="button"
								disabled={operationBusy}
								title="Capture a lightweight idea"
								class="flex h-10 items-center gap-1.5 rounded-xl border border-[#5d5540] bg-[#211d14] px-3.5 font-mono text-[9px] font-semibold text-[#e4cc8a] transition hover:-translate-y-0.5 hover:border-[#8d7c50] disabled:cursor-wait disabled:opacity-50"
								onclick={() => void addTask("ideas")}
								><Lightbulb size={12} /> Add idea</button
							>
							<button
								type="button"
								disabled={operationBusy}
								title="Add a planned task and open its details"
								class="flex h-10 items-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] px-3.5 font-mono text-[9px] font-semibold text-[#f0ffdf] shadow-[0_10px_24px_rgba(93,139,54,.18)] transition hover:-translate-y-0.5 disabled:cursor-wait disabled:opacity-50"
								onclick={() => void addTask("planned")}
								><Plus size={12} /> Add task</button
							>
						</div>
					</div>
					<div class="grid grid-cols-7 gap-2.5">
						{#each columns as column (column.id)}
							<div
								role="list"
								aria-label={column.label}
								class={`min-h-[460px] rounded-2xl border p-2.5 ${column.id === "ideas" ? "border-dashed border-[#554d39] bg-[linear-gradient(180deg,rgba(48,41,24,.48),rgba(10,17,21,.72))]" : column.id === "running" ? "border-[#31513a] bg-[linear-gradient(180deg,rgba(20,45,28,.34),rgba(10,17,21,.76))]" : "border-[#27363d] bg-[rgba(10,17,21,.76)]"}`}
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
									<div
										draggable="true"
										role="button"
										tabindex="0"
										ondragstart={() => (draggedTaskId = task.id)}
										ondragend={() => (draggedTaskId = "")}
										onclick={() => (selectedTaskId = task.id)}
										onkeydown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												selectedTaskId = task.id;
											}
										}}
										class={`group relative w-full cursor-pointer overflow-hidden rounded-xl border p-2.5 text-left outline-none transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_10px_24px_rgba(0,0,0,.24)] focus-visible:ring-1 focus-visible:ring-[#a9d873] ${selectedTaskId === task.id ? "border-[#9ac369] bg-[#17221a] shadow-[0_0_0_1px_rgba(169,216,115,.12)]" : task.runStatus === "running" ? "border-[rgba(134,213,138,.55)] bg-[linear-gradient(135deg,rgba(31,62,37,.72),rgba(15,29,21,.8))] hover:border-[#9be19f]" : "border-[#31424a] bg-[#0e161b] hover:border-[#647e87] hover:bg-[#121d22]"}`}
									>
										<span class="flex items-start gap-1.5">
											{#if task.runStatus === "running"}<LoaderCircle size={11} class="mt-0.5 shrink-0 animate-spin text-[#9be19f]" />{/if}
											<span class="block min-w-0 text-[10px] leading-snug font-semibold text-[#e6eeee]">{displayTitle(task)}</span>
										</span>
											<span class="mt-1.5 flex flex-wrap items-center gap-1">
												<span
													class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#93a8ad]"
													>{kindLabel(task.kind)}</span
												>
												<span
													class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#93a8ad]"
													>{task.personalBotId ? personalAgents.find((agent) => agent.id === task.personalBotId)?.name ?? "Agent unavailable" : providerOf(task.model)}</span
												>
											{#if task.targetMinutes}
												<span
													class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#93a8ad]"
													>Target {task.targetMinutes}m</span
												>
											{:else}
												<span
													class="rounded-full bg-[#1a272d] px-1.5 py-0.5 font-mono text-[7px] text-[#93a8ad]"
													>Auto time</span
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
										{#if task.runStatus === "running"}
											<span class="mt-1.5 block font-mono text-[7px] leading-snug">
												<span class="flex items-center gap-1 text-[#b9ea78]"><span class="h-1 w-1 shrink-0 animate-pulse rounded-full bg-[#b9ea78]"></span><span class="truncate">{runAgentLabel(task)}</span></span>
												<span class="block truncate pl-2 text-[#8fa3b0]">{activeStep(task) ?? `Run #${task.runCount ?? 1} · ${elapsedText(task.runStartedAt)}`}</span>
											</span>
										{/if}
										{#if task.prompt}
											<span class="mt-0 max-h-0 overflow-hidden text-[8px] leading-snug text-[#91a3a8] opacity-0 transition-all duration-200 group-hover:mt-2 group-hover:max-h-12 group-hover:opacity-100 group-focus-visible:mt-2 group-focus-visible:max-h-12 group-focus-visible:opacity-100"><span class="line-clamp-3">{task.prompt}</span></span>
										{/if}
											{#if task.lastResult && task.runStatus !== "running"}
												<span class="mt-1.5 max-h-8 overflow-hidden line-clamp-2 text-[8px] leading-snug text-[#9fb0b4]"
													>{task.lastResult}</span
												>
											{/if}
											{#if task.runError}
												<span class="mt-1.5 max-h-8 overflow-hidden line-clamp-2 text-[8px] leading-snug text-[#d99a8c]"
													>{task.runError}</span
												>
											{/if}
										<span class="mt-2 flex gap-2 border-t border-[#26363d] pt-1.5 font-mono text-[8px] text-[#9bbc79]">
											{#if task.runStatus === "running"}<button type="button" class="rounded px-2 py-1 text-[#e7aaa4] hover:bg-[#301a1a]" onclick={(event) => { event.stopPropagation(); void onstop(board.id, task.id); }}>Stop</button>
											{:else}<button type="button" class="rounded px-2 py-1 hover:bg-[#26391c]" onclick={(event) => { event.stopPropagation(); void onrun(board.id, task.id).catch((error) => { pageError = String(error); }); }}>{task.runCount ? "Retry" : "Run"}</button>{/if}
											<span class="px-1 py-1">{task.runStatus || task.status}</span>
										</span>
									</div>
									{#if latestAttempt(task)}
										<div class="rounded-lg border border-[#26363d] bg-[#0a1115] p-2 font-mono text-[7px] leading-snug" aria-label={`Run history for ${displayTitle(task)}`}>
											<p class="m-0 text-[#9bbc79]">{latestAttempt(task)?.mode ?? "Mode not recorded"} · {latestAttempt(task)?.evidence?.outcome ?? task.runStatus}</p>
											<p class="my-1 line-clamp-2 text-[#8fa3b0]" title={runAgentLabel(task)}>{runAgentLabel(task)}</p>
											<p class="my-1 break-all text-[#8fa3b0]">Folder: {latestAttempt(task)?.workspaceRoot}</p>
											{#each cardActivity(task) as event (activityKey(event))}
												<p class="my-0.5 line-clamp-2 text-[#7f9298]" title={event.text}>{event.text}</p>
											{/each}
										</div>
									{/if}
									{/each}
								</div>
							</div>
						{/each}
					</div>
					{#if board.tasks.length === 0}
						<p class="rounded-2xl border border-dashed border-[#31424a] bg-[#0b1217] p-4 text-center text-[10px] text-[#74868c]">
							This board is empty. Capture a lightweight idea or add a planned task to begin.
						</p>
					{/if}
				</div>
			{:else}
				<div class="mx-auto max-w-[1680px]">
					<p class="rounded-2xl border border-dashed border-[#31424a] bg-[#0b1217] p-4 text-center text-[10px] text-[#74868c]">
						No Kanban boards yet. Create one from the sidebar.
					</p>
				</div>
			{/if}
		</section>
	</div>
	{#if selectedTask}
		<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 backdrop-blur-sm" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) closeDrawer(); }}>
			<div class="max-h-[94vh] w-full max-w-[1350px] overflow-y-auto rounded-2xl bg-[#080d11] p-3 shadow-2xl">{@render taskDetails()}</div>
		</div>
	{/if}
	{#snippet taskDetails()}
		{#if selectedTask && board}
		<section class="rounded-2xl border border-[#34444b] bg-[linear-gradient(145deg,rgba(14,24,29,.98),rgba(8,15,19,.98))] p-4" aria-label="Selected task workspace">
			<div
				class="grid min-w-0 grid-cols-[minmax(0,1.1fr)_minmax(340px,.9fr)] gap-4 max-[1100px]:grid-cols-1"
			>
				<form
					class="min-w-0 rounded-2xl border border-[#2b3a40] bg-[#0a1115] p-4"
					onsubmit={(event) => {
						event.preventDefault();
						void saveTask(true);
					}}
				>
					<div class="flex items-center gap-2">
						<div class="min-w-0">
							<p class="m-0 font-mono text-[8px] tracking-[.14em] text-[#89ad71] uppercase">Task workspace</p>
							<h3 class="mt-1 mb-0 truncate text-[14px] font-semibold text-[#edf3f4]">{displayTitle(selectedTask)}</h3>
						</div>
						<button
							type="button"
							aria-label="Close task"
							title="Close task (Escape)"
							class="ml-auto grid h-9 w-9 place-items-center rounded-xl border border-[#34444b] bg-[#11191e] text-[#a8b7ba] transition hover:border-[#71838d] hover:text-white"
							onclick={closeDrawer}><X size={15} /></button
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
					<label class="mt-3 block">
						<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Task type</span>
						<select
							bind:value={draftTaskKind}
							disabled={selectedTask.runStatus === "running"}
							class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-2 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d] disabled:opacity-50"
						>
							{#each kindOptions as kind (kind)}
								<option value={kind}>{kindLabel(kind)}</option>
							{/each}
						</select>
					</label>
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
						<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Personal Agent</span>
						<select
							bind:value={draftPersonalBotId}
							disabled={selectedTask.runStatus === "running"}
							class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-2 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d] disabled:opacity-50"
						>
							{#if runnableAgents.length === 0}<option value="" disabled>No runnable Personal Agent available</option>{/if}
							{#each personalAgents as agent (agent.id)}
								<option value={agent.id} disabled={!agent.enabled || !agent.kanbanEnabled}>{agent.name} · {agent.model || "No model"}{!agent.kanbanEnabled ? " · Kanban disabled" : ""}</option>
							{/each}
						</select>
					</label>
					{#if draftPersonalBotId}
						<p class="mt-2 text-[9px] text-[#83959b]">Model and reasoning are configured in Personal Agents: {personalAgents.find((agent) => agent.id === draftPersonalBotId)?.model} · {personalAgents.find((agent) => agent.id === draftPersonalBotId)?.effort}</p>
					{/if}
					<div class="mt-3 grid grid-cols-2 gap-2">
						<label>
							<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Task time</span>
							<select
								bind:value={draftTargetMode}
								disabled={selectedTask.runStatus === "running"}
								class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-2 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d] disabled:opacity-50"
							>
								<option value="auto">Auto (elapsed only)</option>
								<option value="custom">Custom target</option>
							</select>
						</label>
						{#if draftTargetMode === "custom"}
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
						{/if}
					</div>
					<label class="mt-3 flex items-center gap-2 rounded-xl border border-[#34444b] bg-[#080e12] px-3 py-2.5">
						<input bind:checked={draftScheduleEnabled} type="checkbox" disabled={selectedTask.runStatus === "running"} />
						<span class="font-mono text-[8px] text-[#a9b8bb] uppercase">Schedule this task</span>
					</label>
					{#if draftScheduleEnabled}
						<div class="mt-3 grid grid-cols-2 gap-2">
							<label>
								<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">First run</span>
								<input
									bind:value={draftTaskScheduledAt}
									type="datetime-local"
									class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-3 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
								/>
							</label>
							<label>
								<span class="mb-1.5 block font-mono text-[8px] text-[#83959b] uppercase">Repeat minutes</span>
								<input
									bind:value={draftTaskRepeatMinutes}
									min="1"
									type="number"
									placeholder="One time"
									class="h-10 w-full rounded-xl border border-[#34444b] bg-[#080e12] px-3 text-[10px] text-[#dce6e8] outline-none focus:border-[#73905d]"
								/>
							</label>
						</div>
					{/if}
					<p
						class="mt-3 mb-0 rounded-xl border border-[#344737] bg-[#10190f] p-3 text-[9px] leading-[1.6] text-[#b9cd9d]"
					>
						Auto time has no deadline and only tracks elapsed time. A custom target is advisory and never
						marks the card complete. Scheduled and repeating runs are backend-owned and survive app restarts.
					</p>
					{#if drawerError}
						<p class="mt-3 mb-0 rounded-xl border border-[#71453c] bg-[#2b1713] p-2.5 text-[9px] text-[#efb2a3]">
							{drawerError}
						</p>
					{:else if drawerMessage}
						<p class="mt-3 mb-0 rounded-xl border border-[#405b38] bg-[#142113] p-2.5 text-[9px] text-[#bfe2a4]">
							{drawerMessage}
						</p>
					{/if}
					<button
						type="submit"
						disabled={operationBusy || selectedTask.runStatus === "running"}
						class="mt-4 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] font-mono text-[9px] font-semibold text-[#f0ffdf] disabled:cursor-not-allowed disabled:opacity-50"
						><Check size={12} /> {operationBusy ? "Working..." : selectedTask.runStatus === "running" ? "Locked while running" : "Save task card"}</button
					>
				</form>
				<div class="min-w-0 space-y-3">
				<div class="flex gap-1" role="tablist" aria-label="Task detail tabs">
					<button type="button" role="tab" aria-selected={detailTab === "execution"} class={`h-8 flex-1 rounded-lg font-mono text-[8px] uppercase ${detailTab === "execution" ? "border border-[rgba(79,140,202,.35)] bg-[rgba(44,91,137,.28)] text-[#aed0ef]" : "border border-transparent text-[#788994] hover:text-[#cbd3d7]"}`} onclick={() => (detailTab = "execution")}>Execution</button>
					<button type="button" role="tab" aria-selected={detailTab === "schedule"} class={`h-8 flex-1 rounded-lg font-mono text-[8px] uppercase ${detailTab === "schedule" ? "border border-[rgba(79,140,202,.35)] bg-[rgba(44,91,137,.28)] text-[#aed0ef]" : "border border-transparent text-[#788994] hover:text-[#cbd3d7]"}`} onclick={() => (detailTab = "schedule")}>Schedule</button>
				</div>
				{#if detailTab === "schedule"}
					<div class="rounded-2xl border border-[#2f4046] bg-[#091116] p-3">
						<p class="m-0 font-mono text-[8px] tracking-[.12em] text-[#71858a] uppercase">Next schedule</p>
						{#if upcomingSchedule}
							<p class="mt-1.5 mb-0 font-mono text-[10px] text-[#d6e1e3]">{upcomingSchedule.label}</p>
							<p class="mt-1 mb-0 text-[9px] leading-snug text-[#8ca0a3]">{upcomingSchedule.detail}</p>
							{#if selectedTask.targetMinutes}<p class="mt-1 mb-0 text-[9px] text-[#8ca0a3]">Target {selectedTask.targetMinutes}m (advisory only)</p>{/if}
						{:else}
							<p class="mt-1.5 mb-0 text-[9px] leading-snug text-[#8ca0a3]">No schedule set. Enable “Schedule this task” in the form and add a first run or repeat interval.</p>
						{/if}
					</div>
				{:else}
				<div class="rounded-2xl border border-[#2f4046] bg-[#091116] p-3">
					<p class="m-0 font-mono text-[8px] tracking-[.12em] text-[#71858a] uppercase">Execution</p>
					{#if selectedTask.runStatus === "running"}
						<p class="mt-2 mb-0 flex items-center gap-2 font-mono text-[11px] text-[#86d58a]">
							<LoaderCircle size={14} class="animate-spin" /> Run #{selectedTask.runCount ?? 1} · {elapsedText(selectedTask.runStartedAt)}
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
						<p class="mt-1.5 mb-0 text-[9px] text-[#8ca0a3]">Never run. Fill in title, brief, and folder first.</p>
					{/if}
					{#if selectedTask.runStatus !== "running" && missingRunFields().length > 0}
						<p class="mt-2 mb-0 rounded-xl border border-[#5a4a2f] bg-[#1d160c] p-2 text-[8px] leading-snug text-[#d8bd8a]">
							Required before running: {missingRunFields().join(", ")}.
						</p>
					{/if}
					{#if selectedTask.attempts?.length}
						<ul class="mt-2 mb-0 list-none space-y-1.5 p-0">
							{#each [...selectedTask.attempts].reverse() as attempt (attempt.id)}
								<li class="rounded-xl bg-[#0c1419] p-2">
									<span class="block font-mono text-[8px] text-[#9fb0b4]">
										Attempt {attempt.sequence} · {attempt.status} · {attempt.agentName ?? "Klerm"} · {attempt.model}
									</span>
									<p class="my-1 break-all text-[8px] text-[#8fa3b0]">{attempt.mode ?? "Mode not recorded"} · {attempt.workspaceRoot}</p>
									{#if attempt.evidence}
										<p class="my-1 text-[9px] text-[#b9cd9d]">Evidence: {attempt.evidence.outcome}</p>
										<pre class="max-h-48 overflow-auto text-[8px] whitespace-pre-wrap text-[#a7b4b9]">Changed files: {attempt.evidence.changedFiles.join(", ") || "none"}{"\n"}Successful checks: {attempt.evidence.verification.join("\n") || "none"}</pre>
									{/if}
									<span class="mt-1 block">
										{#each attempt.steps as step (step.id)}
											<span
												class={`block font-mono text-[8px] leading-snug ${step.status === "completed" ? "text-[#6f8577] line-through" : step.status === "active" ? "text-[#b9ea78]" : step.status === "failed" ? "text-[#d99a8c]" : "text-[#74868c]"}`}
												>[{stepMarker(step.status)}] {step.label}</span
											>
										{/each}
									</span>
									{#if attempt.error}
										<span class="mt-1 block text-[8px] leading-snug text-[#d99a8c]">{attempt.error}</span>
									{/if}
									{#if attempt.result}
										<details class="mt-1 text-[9px] text-[#c4d2d5]"><summary class="cursor-pointer">Full attempt report</summary><p class="max-h-96 overflow-auto whitespace-pre-wrap">{attempt.result}</p></details>
									{/if}
								</li>
							{/each}
						</ul>
					{/if}
					<div class="mt-2.5 flex gap-1.5">
						{#if selectedTask.runStatus === "running"}
							<button
								type="button"
								disabled={operationBusy}
								class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(217,154,140,.5)] bg-[#3a2119] font-mono text-[9px] font-semibold text-[#f3c9bd]"
								onclick={() => void stopTask()}><Square size={12} /> {operationBusy ? "Stopping..." : "Stop"}</button
							>
						{:else if (selectedTask.runCount ?? 0) > 0}
							<button
								type="button"
								disabled={operationBusy}
								class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] font-mono text-[9px] font-semibold text-[#f0ffdf] disabled:cursor-wait disabled:opacity-50"
								onclick={() => void runTask()}><RotateCcw size={12} /> {operationBusy ? "Starting..." : "Retry"}</button
							>
						{:else}
							<button
								type="button"
								disabled={operationBusy}
								class="flex h-9 flex-1 items-center justify-center gap-1.5 rounded-xl border border-[rgba(199,246,125,.45)] bg-[linear-gradient(135deg,#648a3f,#3f5f2d)] font-mono text-[9px] font-semibold text-[#f0ffdf] disabled:cursor-wait disabled:opacity-50"
								onclick={() => void runTask()}><Play size={12} /> {operationBusy ? "Starting..." : "Run"}</button
							>
						{/if}
					</div>
				</div>
				{#if selectedTask.lastResult}
					<div class="rounded-2xl border border-[#2f4046] bg-[#091116] p-3">
						<p class="m-0 font-mono text-[8px] tracking-[.12em] text-[#71858a] uppercase">Final result</p>
						<p class="mt-1.5 mb-0 text-[9px] leading-relaxed whitespace-pre-wrap text-[#c4d2d5]">
							{selectedTask.lastResult}
						</p>
					</div>
				{/if}
				<div class="rounded-2xl border border-[#2f4046] bg-[#091116] p-3">
					<p class="m-0 font-mono text-[8px] tracking-[.12em] text-[#71858a] uppercase">
						Activity · {taskActivity.length}
					</p>
					{#if taskActivity.length === 0}
						<p class="mt-1.5 mb-0 text-[9px] text-[#8ca0a3]">
							No backend activity yet. Runs stream tool and completion events here.
						</p>
					{:else}
						<ul class="mt-2 mb-0 list-none space-y-1.5 p-0">
							{#each taskActivity as event (activityKey(event))}
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
				{/if}
				</div>
			</div>
		</section>
		{/if}
	{/snippet}
</div>
