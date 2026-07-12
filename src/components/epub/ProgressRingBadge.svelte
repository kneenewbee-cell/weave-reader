<script lang="ts">
	import {
		clampBookshelfProgress,
		getBookshelfProgressToneClass,
	} from '../../services/epub/bookshelf-progress-display';

	interface Props {
		progress: number;
		valueText: string;
		titleText?: string;
		toneClass?: string;
		size?: 'default' | 'compact';
		interactive?: boolean;
		className?: string;
		onActivate?: (event: MouseEvent | KeyboardEvent) => void;
	}

	let {
		progress,
		valueText,
		titleText = '',
		toneClass = '',
		size = 'default',
		interactive = false,
		className = '',
		onActivate,
	}: Props = $props();

	const clampedProgress = $derived(clampBookshelfProgress(progress));
	const resolvedToneClass = $derived(toneClass || getBookshelfProgressToneClass(progress));
	const ringStyle = $derived(`--epub-progress-ring-fill: ${clampedProgress}%;`);
	const ariaLabel = $derived(titleText || valueText);

	function handleKeydown(event: KeyboardEvent) {
		if (!interactive || !onActivate) {
			return;
		}
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}
		event.preventDefault();
		onActivate(event);
	}
</script>

{#if interactive}
	<button
		type="button"
		class={`epub-progress-ring-badge ${resolvedToneClass} ${className}`.trim()}
		class:epub-progress-ring-badge-compact={size === 'compact'}
		style={ringStyle}
		aria-label={ariaLabel}
		title={titleText || undefined}
		onclick={(event) => onActivate?.(event)}
		onkeydown={handleKeydown}
	>
		<span class="epub-progress-ring-badge-value">{valueText}</span>
	</button>
{:else}
	<div
		class={`epub-progress-ring-badge ${resolvedToneClass} ${className}`.trim()}
		class:epub-progress-ring-badge-compact={size === 'compact'}
		style={ringStyle}
		role="img"
		aria-label={ariaLabel}
		title={titleText || undefined}
	>
		<span class="epub-progress-ring-badge-value">{valueText}</span>
	</div>
{/if}
