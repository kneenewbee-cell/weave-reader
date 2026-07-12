<script lang="ts">
	import { setIcon } from 'obsidian';
	import {
		EPUB_TUTORIAL_CONTENT_BY_LANG,
		EPUB_TUTORIAL_TABS_BY_LANG,
		resolveTutorialLanguage,
		type TutorialTabId
	} from './epub-tutorial-content';
	import { currentLanguage, tr } from '../../utils/i18n';

	interface Props {
		visible: boolean;
		onClose: () => void;
		initialTab?: TutorialTabId;
		showDismissOption?: boolean;
		onDismissPermanently?: () => void;
	}

	let {
		visible,
		onClose,
		initialTab,
		showDismissOption = false,
		onDismissPermanently,
	}: Props = $props();
	let t = $derived($tr);
	let tutorialLanguage = $derived(resolveTutorialLanguage($currentLanguage));
	let tutorialTabs = $derived(EPUB_TUTORIAL_TABS_BY_LANG[tutorialLanguage]);
	let tutorialContent = $derived(EPUB_TUTORIAL_CONTENT_BY_LANG[tutorialLanguage]);

	let activeTab = $state<TutorialTabId>('basics');

	$effect(() => {
		if (visible) {
			activeTab = initialTab ?? 'basics';
		}
	});

	function icon(node: HTMLElement, name: string) {
		setIcon(node, name);
		return {
			update(newName: string) {
				// /skip innerHTML is used to clear the trusted icon container before setIcon rerenders it
				node.replaceChildren();
				setIcon(node, newName);
			}
		};
	}

	function switchTab(tab: TutorialTabId) {
		activeTab = tab;
	}

	function handleDismissPermanently() {
		onDismissPermanently?.();
	}
</script>

{#if visible}
	<div
		class="epub-tutorial-overlay"
		onclick={onClose}
		onkeydown={(event) => event.key === 'Escape' && onClose()}
		role="button"
		tabindex="0"
		aria-label={t('epub.reader.tutorial.close')}
	></div>

	<div class="epub-tutorial-panel">
		<div class="epub-tutorial-header">
			<div class="epub-tutorial-title-wrap">
				<span class="epub-tutorial-title-text">{t('epub.reader.tutorial.title')}</span>
			</div>
			<button type="button" class="clickable-icon epub-tutorial-close" onclick={onClose} aria-label={t('epub.reader.tutorial.close')}>
				<span use:icon={'x'}></span>
			</button>
		</div>

		<div class="epub-tutorial-tabs">
			{#each tutorialTabs as tab}
				<button
					type="button"
					class="clickable-icon"
					class:active={activeTab === tab.id}
					onclick={() => switchTab(tab.id)}
				>
					{tab.label}
				</button>
			{/each}
		</div>

		<div class="epub-tutorial-scroll">
			<div class="epub-tutorial-body">
				{#each tutorialContent[activeTab] as section, index}
					<div class="epub-tut-section">
						<div class="epub-tut-title">
							<span class="epub-tut-title-text">{section.title}</span>
						</div>
						<div class="epub-tut-text">
							{#if section.paragraphs}
								{#each section.paragraphs as paragraph}
									<p>{paragraph}</p>
								{/each}
							{/if}

							{#if section.listGroups}
								{#each section.listGroups as group}
									{#if group.heading}
										<h4>{group.heading}</h4>
									{/if}
									<ul>
										{#each group.items as item}
											<li>{item}</li>
										{/each}
									</ul>
								{/each}
							{/if}

							{#if section.colors}
								<div class="epub-tut-colors">
									{#each section.colors as color}
										<div class="epub-tut-color-item">
											<span class={`epub-tut-color-dot ${color.tone}`}></span>
											<span>{color.label}：{color.description}</span>
										</div>
									{/each}
								</div>
							{/if}

							{#if section.code}
								<pre>{section.code}</pre>
							{/if}

							{#if section.shortcuts}
								<div class="epub-tut-shortcut-list">
									{#each section.shortcuts as shortcut}
										<div class="epub-tut-shortcut">
											<span>
												{#each shortcut.keys as key}
													<kbd>{key}</kbd>
												{/each}
											</span>
											<span>{shortcut.description}</span>
										</div>
									{/each}
								</div>
							{/if}

							{#if section.buttons}
								<div class="epub-tut-btn-list">
									{#each section.buttons as button}
										<div class="epub-tut-btn-item">
											<span class="epub-tut-icon" use:icon={button.icon}></span>
											<span>{button.label}：{button.description}</span>
										</div>
									{/each}
								</div>
							{/if}

							{#if section.links}
								<div class="epub-tut-link-list">
									{#each section.links as link}
										<p>
											<a href={link.url} target="_blank" rel="noopener noreferrer">{link.label}</a>
										</p>
									{/each}
								</div>
							{/if}
						</div>
					</div>

					{#if index < tutorialContent[activeTab].length - 1}
						<div class="epub-tut-divider"></div>
					{/if}
				{/each}
			</div>
		</div>

		{#if showDismissOption}
			<div class="epub-tutorial-footer">
				<button
					type="button"
					class="clickable-icon epub-tutorial-dismiss"
					onclick={handleDismissPermanently}
				>
					{t('epub.reader.tutorial.dontShowAgain')}
				</button>
			</div>
		{/if}
	</div>
{/if}
