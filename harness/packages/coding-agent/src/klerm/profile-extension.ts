import { Type } from "typebox";
import type { ExtensionFactory } from "../core/extensions/types.ts";
import type { SettingsManager } from "../core/settings-manager.ts";
import { isKlermProfileFace, type KlermProfile, normalizeProfile } from "./profiles.ts";

const updateProfileSchema = Type.Object({
	id: Type.String({ minLength: 1, maxLength: 80, description: "Existing profile id" }),
	memory: Type.Optional(Type.String({ maxLength: 8000, description: "Replace profile memory" })),
	readme: Type.Optional(Type.String({ maxLength: 8000, description: "Replace profile README" })),
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
				"Update an existing Klerm agent profile's memory, README, name, face, or level. Use this when the user asks to remember something for a profile.",
			promptSnippet: "Update the assigned Klerm profile memory or README.",
			promptGuidelines: [
				"Use update_klerm_profile only for lasting profile memory, not for one-off task notes.",
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
