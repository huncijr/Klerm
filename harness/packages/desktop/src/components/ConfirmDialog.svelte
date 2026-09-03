<script lang="ts">
	let {
		title,
		detail,
		confirmLabel,
		tone = "danger",
		oncancel,
		onconfirm,
	}: {
		title: string;
		detail: string;
		confirmLabel: string;
		tone?: "danger" | "approval";
		oncancel: () => void;
		onconfirm: () => void;
	} = $props();
</script>

<div class="fixed inset-0 z-40 grid place-items-center bg-black/55 px-4 backdrop-blur-[2px]">
	<button type="button" aria-label="Dismiss" class="absolute inset-0 border-0 bg-transparent" onclick={oncancel}></button>
	<section class="relative z-[1] w-[min(360px,92vw)] rounded-xl border border-[#323c44] bg-[#10161b] p-4 shadow-[0_24px_70px_rgba(0,0,0,.55)]">
		<strong class="block text-[13px] text-[#e4eaed]">{title}</strong>
		<p class="mt-2 text-[11px]/[1.5] text-[#8b969e]">{detail}</p>
		<div class="mt-4 flex justify-end gap-2">
			<button type="button" class="rounded-md px-3 py-2 font-mono text-[9px] text-[#8b969e] hover:bg-[#171d22] hover:text-[#d5dce0]" onclick={oncancel}>Cancel</button>
			<button
				type="button"
				class={`rounded-md px-3 py-2 font-mono text-[9px] font-semibold ${tone === "approval" ? "bg-[rgba(214,255,63,.12)] text-[#d6ff3f] hover:bg-[rgba(214,255,63,.2)]" : "bg-[rgba(255,111,97,.14)] text-[#ff958c] hover:bg-[rgba(255,111,97,.22)]"}`}
				onclick={onconfirm}
			>
				{confirmLabel}
			</button>
		</div>
	</section>
</div>
