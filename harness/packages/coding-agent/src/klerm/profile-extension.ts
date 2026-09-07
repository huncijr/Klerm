import { Type } from "typebox";
import type { ExtensionFactory } from "../core/extensions/types.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { isKlermProfileFace, isKlermProfileMemoryFormat, type KlermProfile, normalizeProfile } from "./profiles.ts";

const updateProfileSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 80, description: "Existing profile id" }),
	behaviour: Type.Optional(Type.String({ maxLength: 8000, description: "Replace profile behaviour" })),
	workPlan: Type.Optional(Type.String({ maxLength: 8000, description: "Replace profile work plan" })),
	planMode: Type.Optional(Type.String({ maxLength: 8000, description: "Replace profile plan-mode prompt" })),
	buildMode: Type.Optional(Type.String({ maxLength: 8000, description: "Replace profile build-mode prompt" })),
	memoryFormat: Type.Optional(Type.String({ description: "Profile text format: md or html" })),
	memory: Type.Optional(Type.String({ maxLength: 8000, description: "Legacy alias for behaviour" })),
	readme: Type.Optional(Type.String({ maxLength: 8000, description: "Legacy alias for work plan" })),
	name: Type.Optional(Type.String({ minLength: 1, maxLength: 40 })),
	face: Type.Optional(Type.String({ description: "Built-in face id" })),
	level: Type.Optional(Type.Integer({ minimum: 1, maximum: 5 })),
});

export function createProfileExtension(settingsManager: SettingsManager): ExtensionFactory {
	return (pi) => {
		pi.registerTool({
			name: "update_klerm_profile",
			label: "Update Klerm profile",
			description:
				"Update an existing Klerm agent profile's behaviour, work plan, plan/build mode prompts, name, face, or level. Use this when the user asks to remember something for a profile.",
			promptSnippet: "Update the assigned Klerm profile behaviour or work plan.",
			promptGuidelines: [
				"Use update_klerm_profile only for lasting profile text, not for one-off task notes.",
				"Never create a new profile id with this tool; only update an existing id.",
			],
			parameters: updateProfileSchema,
			executionMode: "sequential",
			execute: async (_toolCallId, params) => {
				const state = settingsManager.getKlermProfiles();
				const existing = state.profiles.find((profile) => profile.id === params.id);
				if (!existing) throw new Error(`Unknown Klerm profile: ${params.id}`);
				const next: KlermProfile = {
					...existing,
					name: params.name?.trim() || existing.name,
					face: params.face && isKlermProfileFace(params.face) ? params.face : existing.face,
					level: params.level ?? existing.level,
					behaviour: params.behaviour ?? params.memory ?? existing.behaviour,
					workPlan: params.workPlan ?? params.readme ?? existing.workPlan,
					planMode: params.planMode ?? existing.planMode,
					buildMode: params.buildMode ?? existing.buildMode,
					memoryFormat:
						params.memoryFormat && isKlermProfileMemoryFormat(params.memoryFormat)
							? params.memoryFormat
							: existing.memoryFormat,
					memory: params.memory ?? existing.memory,
					readme: params.readme ?? existing.readme,
				};
				const saved = normalizeProfile(next);
				if (!saved) throw new Error("Invalid Klerm profile update.");
				settingsManager.upsertKlermProfile(saved);
				await settingsManager.flush();
				return {
					content: [{ type: "text", text: `Updated profile ${saved.name} (${saved.id}).` }],
					details: { id: saved.id, name: saved.name },
				};
			},
		});
	};
}
