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
	<section class="relative z-[1] w-[min(360px,92vw)] rounded-xl border border-line bg-panel p-4 shadow-sm">
		<strong class="block text-[14px] text-ink">{title}</strong>
		<p class="mt-2 text-[13px]/[1.5] text-muted">{detail}</p>
		<div class="mt-4 flex justify-end gap-2">
			<button type="button" class="rounded-md px-3 py-2 font-sans text-[12px] text-muted hover:bg-raised hover:text-ink" onclick={oncancel}>Cancel</button>
			<button
				type="button"
				class={`rounded-md px-3 py-2 font-sans text-[12px] font-semibold ${tone === "approval" ? "bg-warning-soft text-warning hover:bg-warning-soft" : "bg-danger-soft text-danger hover:bg-danger-soft"}`}
				onclick={onconfirm}
			>
				{confirmLabel}
			</button>
		</div>
	</section>
</div>
