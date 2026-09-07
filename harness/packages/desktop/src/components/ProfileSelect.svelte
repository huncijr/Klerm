<script lang="ts">
	import { profileIcon } from "../lib/profiles.ts";
	import type { KlermProfile } from "../lib/model.ts";

	let {
		label,
		profiles,
		value,
		disabled,
		onchange,
	}: {
		label: string;
		profiles: KlermProfile[];
		value: string;
		disabled: boolean;
		onchange: (id: string) => void;
	} = $props();

</script>

<label class="mb-1 block min-w-0">
	<span class="mb-1 block font-mono text-[8px] tracking-[.12em] text-[#536069] uppercase">{label}</span>
	<select
		class="h-9 w-full truncate rounded-lg border border-[#2a3239] bg-[#0d1116] px-2 font-mono text-[10px] text-[#d7dfe2] outline-none disabled:opacity-45"
		{disabled}
		value={value}
		onchange={(event) => onchange((event.currentTarget as HTMLSelectElement).value)}
	>
		<option value="">No profile</option>
		{#each profiles as profile (profile.id)}
			<option value={profile.id}>{profileIcon(profile.face)} {profile.name}</option>
		{/each}
	</select>
</label>
