<script lang="ts">
	import { setIcon } from 'obsidian';

	interface Props {
		/** Visible status text; omit for icon-only inline use. */
		message?: string;
		/** panel: centered block; inline: row for banners; compact: smaller row for tight chrome. */
		variant?: 'panel' | 'inline' | 'compact';
		/** Match sidebar panel placeholder surfaces. */
		surface?: boolean;
		class?: string;
	}

	let { message = '', variant = 'panel', surface = false, class: className = '' }: Props = $props();

	let iconEl = $state<HTMLSpanElement | undefined>();

	$effect(() => {
		if (!iconEl) {
			return;
		}
		iconEl.replaceChildren();
		setIcon(iconEl, 'loader-2');
	});
</script>

<div
	class="epub-loading-state epub-loading-state--{variant}{surface ? ' epub-loading-state--surface' : ''} {className}"
	role="status"
	aria-live="polite"
	aria-busy="true"
	aria-label={message || undefined}
>
	<span class="epub-loading-state__icon" bind:this={iconEl} aria-hidden="true"></span>
	{#if message}
		<span class="epub-loading-state__message">{message}</span>
	{/if}
</div>
