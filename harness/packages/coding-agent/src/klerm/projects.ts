import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionInfo } from "../core/session-manager.ts";
import { loadEntriesFromFile } from "../core/session-manager.ts";

export const PROJECT_REGISTRY_VERSION = 1;
export const DEFAULT_PROJECT_ID = "project-default";
export const DEFAULT_PROJECT_NAME = "My New Project";

const MAX_PROJECT_EXTRACTS = 24;
const MAX_EXTRACT_CHARS = 500;
const MAX_PROJECT_CONTEXT_CHARS = 12_000;

export interface KlermProject {
	id: string;
	name: string;
	summary?: string;
}

export interface KlermProjectRegistry {
	version: typeof PROJECT_REGISTRY_VERSION;
	defaultProjectId: string;
	projects: KlermProject[];
	sessionProjects: Record<string, string>;
	legacyDesktopImportCompleted?: true;
}

export interface ProjectSessionExtract {
	sessionId: string;
	sessionName: string;
	role: "user" | "assistant";
	timestamp: string;
	label: string;
	text: string;
}

export function createDefaultProjectRegistry(): KlermProjectRegistry {
	return {
		version: PROJECT_REGISTRY_VERSION,
		defaultProjectId: DEFAULT_PROJECT_ID,
		projects: [{ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME }],
		sessionProjects: {},
	};
}

function normalizeProject(value: unknown): KlermProject | undefined {
	if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
	const project = value as Record<string, unknown>;
	if (typeof project.id !== "string" || !project.id.trim()) return undefined;
	if (typeof project.name !== "string" || !project.name.trim()) return undefined;
	return {
		id: project.id.trim().slice(0, 128),
		name: project.name.trim().slice(0, 100),
		...(typeof project.summary === "string" ? { summary: project.summary.slice(0, MAX_PROJECT_CONTEXT_CHARS) } : {}),
	};
}

export function normalizeProjectRegistry(value: unknown): KlermProjectRegistry {
	if (!value || typeof value !== "object" || Array.isArray(value)) return createDefaultProjectRegistry();
	const input = value as Record<string, unknown>;
	const projects: KlermProject[] = [];
	const ids = new Set<string>();
	if (Array.isArray(input.projects)) {
		for (const candidate of input.projects) {
			const project = normalizeProject(candidate);
			if (project && !ids.has(project.id)) {
				ids.add(project.id);
				projects.push(project);
			}
		}
	}
	if (!ids.has(DEFAULT_PROJECT_ID)) {
		projects.unshift({ id: DEFAULT_PROJECT_ID, name: DEFAULT_PROJECT_NAME });
		ids.add(DEFAULT_PROJECT_ID);
	}

	const sessionProjects: Record<string, string> = {};
	if (input.sessionProjects && typeof input.sessionProjects === "object" && !Array.isArray(input.sessionProjects)) {
		for (const [sessionId, projectId] of Object.entries(input.sessionProjects)) {
			if (sessionId && typeof projectId === "string" && ids.has(projectId)) sessionProjects[sessionId] = projectId;
		}
	}
	return {
		version: PROJECT_REGISTRY_VERSION,
		defaultProjectId: DEFAULT_PROJECT_ID,
		projects,
		sessionProjects,
		...(input.legacyDesktopImportCompleted === true ? { legacyDesktopImportCompleted: true as const } : {}),
	};
}

function messageText(message: AgentMessage): string {
	if (!("content" in message)) return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.filter((part): part is { type: "text"; text: string } => part.type === "text" && typeof part.text === "string")
		.map((part) => part.text)
		.join("\n");
}

function boundedText(value: string): string {
	const normalized = value.replace(/\s+/g, " ").trim();
	return normalized.length <= MAX_EXTRACT_CHARS ? normalized : `${normalized.slice(0, MAX_EXTRACT_CHARS - 3)}...`;
}

export function extractProjectSessions(
	projectId: string,
	registry: KlermProjectRegistry,
	sessions: SessionInfo[],
): ProjectSessionExtract[] {
	const assigned = sessions
		.filter((session) => registry.sessionProjects[session.id] === projectId)
		.sort((left, right) => left.id.localeCompare(right.id));
	const sessionExtracts = assigned.map((session) => {
		const sessionName = boundedText(session.name?.trim() || session.firstMessage || session.id).slice(0, 100);
		return loadEntriesFromFile(session.path)
			.flatMap((entry): ProjectSessionExtract[] => {
				if (entry.type !== "message" || (entry.message.role !== "user" && entry.message.role !== "assistant")) {
					return [];
				}
				const text = boundedText(messageText(entry.message));
				if (!text) return [];
				const role = entry.message.role;
				return [
					{
						sessionId: session.id,
						sessionName,
						role,
						timestamp: entry.timestamp,
						label: `[Session: ${sessionName} | ${session.id} | ${role}]`,
						text,
					},
				];
			})
			.slice(-MAX_PROJECT_EXTRACTS);
	});
	const selected: ProjectSessionExtract[] = [];
	let totalChars = 0;
	for (let recentOffset = 1; selected.length < MAX_PROJECT_EXTRACTS; recentOffset++) {
		let added = false;
		for (const extracts of sessionExtracts) {
			const extract = extracts.at(-recentOffset);
			if (!extract) continue;
			if (totalChars + extract.label.length + extract.text.length > MAX_PROJECT_CONTEXT_CHARS) continue;
			selected.push(extract);
			totalChars += extract.label.length + extract.text.length;
			added = true;
			if (selected.length >= MAX_PROJECT_EXTRACTS) break;
		}
		if (!added) break;
	}
	return selected.sort(
		(left, right) =>
			left.timestamp.localeCompare(right.timestamp) ||
			left.sessionId.localeCompare(right.sessionId) ||
			left.role.localeCompare(right.role),
	);
}

export function formatProjectExtracts(extracts: ProjectSessionExtract[]): string {
	return extracts.map((extract) => `${extract.label}\n${extract.text}`).join("\n\n");
}

export function summarizeProjectExtracts(projectName: string, extracts: ProjectSessionExtract[]): string {
	if (extracts.length === 0) return `Project: ${projectName}\nNo readable assigned session messages.`;
	const grouped = new Map<string, ProjectSessionExtract[]>();
	for (const extract of extracts) {
		const sessionExtracts = grouped.get(extract.sessionId) ?? [];
		sessionExtracts.push(extract);
		grouped.set(extract.sessionId, sessionExtracts);
	}
	const lines = [`Project: ${projectName}`, `Assigned sessions: ${grouped.size}`];
	for (const sessionExtracts of grouped.values()) {
		const sessionName = sessionExtracts[0]?.sessionName ?? "Untitled session";
		const recent = sessionExtracts.slice(-2).map((extract) => `${extract.role}: ${extract.text.slice(0, 240)}`);
		lines.push(`\n${sessionName}`, ...recent);
	}
	return lines.join("\n").slice(0, MAX_PROJECT_CONTEXT_CHARS);
}
