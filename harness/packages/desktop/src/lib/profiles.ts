import type { KlermProfile, KlermProfileFace } from "./model.ts";

export const PROFILE_FACE_ICON: Record<KlermProfileFace, string> = {
	fox: "🦊",
	owl: "🦉",
	wolf: "🐺",
	cat: "🐱",
	bear: "🐻",
	otter: "🦦",
};

export function profileIcon(face: KlermProfileFace | undefined): string {
	return face ? PROFILE_FACE_ICON[face] : "•";
}

export function profileLabel(profile: KlermProfile | undefined): string {
	return profile ? `${profileIcon(profile.face)} ${profile.name}` : "No profile";
}
