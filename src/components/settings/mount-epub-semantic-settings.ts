import { Notice, Setting, setIcon } from "obsidian";
import type StandaloneEpubPlugin from "../../main";
import { epubActiveDocumentStore } from "../../stores/epub-active-document-store";
import { showObsidianConfirm } from "../../utils/obsidian-confirm";
import {
	ANNOTATION_STYLE_LABELS,
	DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
	DEFAULT_EPUB_ANNOTATION_SEMANTICS,
	DEFAULT_EPUB_STANDARD_SEMANTIC_IDS,
	SEMANTIC_ANNOTATION_STYLE_TOKENS,
	SEMANTIC_COLOR_HEX,
	SEMANTIC_SCHEME_MAX_ITEMS,
	SEMANTIC_SCHEME_MIN_ITEMS,
	SYSTEM_SEMANTIC_SCHEMES,
	activeSemanticEntries,
	addCustomSemantic,
	applySemanticScheme,
	archiveSemantic,
	clearBookEpubPortableSemanticAnnotations,
	createSemanticSaveCoordinator,
	getSemanticScheme,
	isSemanticSchemeModified,
	loadEffectiveEpubSemanticProfile,
	normalizeEpubSemanticSettings,
	notifyEpubSemanticProfileChanged,
	profileToSettings,
	readBookEpubSemanticProfile,
	readGlobalEpubSemanticProfile,
	readEpubSemanticJson,
	readEffectiveEpubPortableAnnotations,
	safeEpubSemanticBookId,
	writeBookEpubSemanticProfile,
	writeGlobalEpubSemanticProfile,
	type EpubSemanticSettings,
	type EpubSemanticSettingsScope,
} from "../../services/epub";

interface SemanticBookOption {
	bookId: string;
	title: string;
}

interface MountEpubSemanticSettingsOptions {
	plugin: StandaloneEpubPlugin;
	host: HTMLElement;
	onSaved?: () => void;
}

const SEMANTIC_COLOR_LABELS: Record<string, string> = {
	yellow: "黄色",
	blue: "蓝色",
	red: "红色",
	purple: "紫色",
	green: "绿色",
	orange: "橙色",
	cyan: "青色",
	pink: "粉色",
	gray: "灰色",
};

function cloneSemanticSettings(settings: unknown): EpubSemanticSettings {
	const normalized = normalizeEpubSemanticSettings(settings);
	return {
		annotationSemanticsEnabled: normalized.annotationSemanticsEnabled,
		semanticSchemeId: normalized.semanticSchemeId,
		annotationSemantics: normalized.annotationSemantics.map((semantic) => ({ ...semantic })),
		standardSemanticIds: [...normalized.standardSemanticIds],
	};
}

function semanticProfileKey(scope: EpubSemanticSettingsScope, bookId: string): string {
	return scope === "book" ? `book:${String(bookId || "").trim()}` : "global";
}

function getSemanticColorHex(color: unknown): string {
	const key = String(color || "").trim().toLowerCase();
	return SEMANTIC_COLOR_HEX[key as keyof typeof SEMANTIC_COLOR_HEX] || SEMANTIC_COLOR_HEX.yellow;
}

function shortBookTitleFromPath(filePath: unknown): string {
	const fileName = String(filePath || "").split(/[\\/]/).pop() || "";
	return fileName.replace(/\.[^.]+$/, "").trim();
}

function getActiveReaderSemanticBookOption(): SemanticBookOption | null {
	const sharedState = epubActiveDocumentStore.getSharedState();
	const activeBook = sharedState.book as Record<string, unknown> | null | undefined;
	const bookId = safeEpubSemanticBookId(activeBook?.id || activeBook?.bookId || "");
	if (!bookId) {
		return null;
	}
	const metadata = activeBook?.metadata && typeof activeBook.metadata === "object"
		? activeBook.metadata as Record<string, unknown>
		: {};
	const title = String(
		metadata.title ||
			activeBook?.displayTitle ||
			shortBookTitleFromPath(activeBook?.filePath || sharedState.filePath) ||
			bookId
	).trim();
	return {
		bookId,
		title: title || bookId,
	};
}

async function listSemanticProfileBooks(plugin: StandaloneEpubPlugin): Promise<SemanticBookOption[]> {
	const books = new Map<string, SemanticBookOption>();
	const activeBook = getActiveReaderSemanticBookOption();
	if (activeBook) {
		books.set(activeBook.bookId, activeBook);
	}

	const index = await readEpubSemanticJson(plugin.app, "weave/epub-data/index.json");
	if (index && typeof index === "object" && !Array.isArray(index)) {
		for (const [rawBookId, rawBook] of Object.entries((index as { books?: Record<string, unknown> }).books || {})) {
			const book = rawBook && typeof rawBook === "object" ? rawBook as Record<string, unknown> : {};
			const bookId = safeEpubSemanticBookId(book.bookId || rawBookId);
			books.set(bookId, {
				bookId,
				title: String(book.displayTitle || book.title || book.filePath || bookId).trim(),
			});
		}
	}

	try {
		const loadedBooks = await plugin.getEpubStorageService().loadBooks({ hydrateStates: false });
		for (const [rawBookId, rawBook] of Object.entries(loadedBooks || {})) {
			const book = rawBook && typeof rawBook === "object" ? rawBook as Record<string, unknown> : {};
			const metadata = book.metadata && typeof book.metadata === "object"
				? book.metadata as Record<string, unknown>
				: {};
			const bookId = safeEpubSemanticBookId(book.id || book.bookId || rawBookId);
			const title = String(
				metadata.title ||
					book.displayTitle ||
					shortBookTitleFromPath(book.filePath || book.bookPath) ||
					bookId
			).trim();
			books.set(bookId, { bookId, title: title || bookId });
		}
	} catch (error) {
		console.warn("[SemanticProfiles] Failed to read bookshelf titles:", error);
	}

	return Array.from(books.values()).sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
}

async function resolveActiveSemanticBookId(
	plugin: StandaloneEpubPlugin,
	books: SemanticBookOption[],
	currentBookId: string
): Promise<string> {
	const rawCurrentBookId = String(currentBookId || "").trim();
	const normalizedCurrentBookId = rawCurrentBookId ? safeEpubSemanticBookId(rawCurrentBookId) : "";
	if (!books.length) {
		return currentBookId ? normalizedCurrentBookId : "";
	}
	if (books.some((book) => book.bookId === normalizedCurrentBookId)) {
		return normalizedCurrentBookId;
	}

	const nextBookId = books[0].bookId;
	if (normalizedCurrentBookId && books.length === 1) {
		const [legacyProfile, nextProfile] = await Promise.all([
			readBookEpubSemanticProfile(plugin.app, normalizedCurrentBookId),
			readBookEpubSemanticProfile(plugin.app, nextBookId),
		]);
		if (legacyProfile && !nextProfile) {
			await writeBookEpubSemanticProfile(plugin.app, nextBookId, profileToSettings(legacyProfile));
			notifyEpubSemanticProfileChanged("book", nextBookId);
		}
	}

	return nextBookId;
}

async function saveSemanticSettingsForScope(
	plugin: StandaloneEpubPlugin,
	scope: EpubSemanticSettingsScope,
	bookId: string,
	settings: EpubSemanticSettings
): Promise<EpubSemanticSettings> {
	const normalized = cloneSemanticSettings(settings);
	if (scope === "book") {
		if (!bookId) {
			throw new Error("Book id is required for a book semantic profile");
		}
		await writeBookEpubSemanticProfile(plugin.app, bookId, normalized);
		notifyEpubSemanticProfileChanged("book", bookId);
		return normalized;
	}

	plugin.settings.annotationSemanticsEnabled = normalized.annotationSemanticsEnabled;
	plugin.settings.semanticSchemeId = normalized.semanticSchemeId;
	plugin.settings.annotationSemantics = normalized.annotationSemantics;
	plugin.settings.standardSemanticIds = normalized.standardSemanticIds;
	await plugin.saveSettings();
	await writeGlobalEpubSemanticProfile(plugin.app, normalized);
	notifyEpubSemanticProfileChanged("global");
	return normalized;
}

function countPortableAnnotations(annotations: unknown[]): number {
	return Array.isArray(annotations) ? annotations.length : 0;
}

async function confirmClearBookSemanticAnnotationsForSchemeChange(
	plugin: StandaloneEpubPlugin,
	bookId: string,
	nextSchemeLabel: string
): Promise<boolean> {
	if (!bookId) {
		return true;
	}
	const payload = await readEffectiveEpubPortableAnnotations(plugin.app, bookId);
	const annotationCount = countPortableAnnotations(payload.annotations);
	if (annotationCount === 0 && payload.authoritative === true) {
		return true;
	}

	const confirmed = await showObsidianConfirm(
		plugin.app,
		`\u8fd9\u672c\u4e66\u5df2\u6709 ${annotationCount} \u6761\u6807\u6ce8\u3002\n\n\u5207\u6362\u4e3a\u300c${nextSchemeLabel}\u300d\u540e\uff0c\u4f1a\u5220\u9664\u8fd9\u672c\u4e66\u5df2\u6709\u7684\u9ad8\u4eae\u3001\u4e0b\u5212\u7ebf\u3001\u6ce2\u6d6a\u7ebf\u7b49\u6807\u6ce8\uff0c\u4f46\u4e0d\u4f1a\u5220\u9664\u4f60\u7684\u8bed\u4e49\u65b9\u6848\u914d\u7f6e\u3002`,
		{
			title: "\u5207\u6362\u672c\u4e66\u8bed\u4e49\u65b9\u6848",
			confirmText: "\u5220\u9664\u6807\u6ce8\u5e76\u5207\u6362",
			cancelText: "\u53d6\u6d88",
			confirmClass: "mod-warning",
		}
	);
	if (!confirmed) {
		return false;
	}

	const removedCount = await clearBookEpubPortableSemanticAnnotations(plugin.app, bookId);
	if (removedCount > 0) {
		new Notice(`\u5df2\u6e05\u7a7a\u8fd9\u672c\u4e66\u7684 ${removedCount} \u6761\u6807\u6ce8`);
	}
	return true;
}

export function mountEpubSemanticSettings(options: MountEpubSemanticSettingsOptions): () => void {
	const { plugin, host, onSaved } = options;
	host.replaceChildren();

	const root = host.createDiv({ cls: "weave-epub-semantic-settings" });
	const header = new Setting(root)
		.setName("语义标注")
		.setDesc("选择一套初始方案，再按阅读习惯调整名称、颜色和标注方式。");
	const scopeControl = header.controlEl.createDiv({
		cls: "weave-epub-semantic-scope",
		attr: { role: "group", "aria-label": "语义配置范围" },
	});
	const body = root.createDiv({ cls: "weave-epub-semantic-settings-body" });

	let scope: EpubSemanticSettingsScope =
		plugin.settings.semanticSettingsScope === "book" ? "book" : "global";
	let bookId = String(plugin.settings.semanticSettingsBookId || "").trim();
	let books: SemanticBookOption[] = [];
	let booksLoaded = false;
	let initialScopeResolved = false;
	let renderVersion = 0;

	const scopeButtons = new Map<EpubSemanticSettingsScope, HTMLButtonElement>();
	const saveCoordinator = createSemanticSaveCoordinator(cloneSemanticSettings);

	const persistScopeChoice = async () => {
		plugin.settings.semanticSettingsScope = scope;
		plugin.settings.semanticSettingsBookId = bookId;
		await plugin.saveSettings();
	};

	const syncScopeButtons = () => {
		for (const [buttonScope, button] of scopeButtons) {
			button.classList.toggle("is-active", buttonScope === scope);
			button.setAttribute("aria-pressed", buttonScope === scope ? "true" : "false");
		}
	};

	const addScopeButton = (buttonScope: EpubSemanticSettingsScope, label: string) => {
		const button = scopeControl.createEl("button", {
			type: "button",
			cls: "weave-epub-semantic-scope-button",
			text: label,
		});
		button.setAttribute("data-scope", buttonScope);
		button.addEventListener("click", async () => {
			if (scope === buttonScope) {
				return;
			}
			scope = buttonScope;
			syncScopeButtons();
			await persistScopeChoice();
			await renderBody();
		});
		scopeButtons.set(buttonScope, button);
	};

	addScopeButton("global", "全局配置");
	addScopeButton("book", "本书配置");
	syncScopeButtons();

	async function saveDraft(
		nextSettings: EpubSemanticSettings,
		nextScope = scope,
		nextBookId = bookId,
		draftKey = semanticProfileKey(nextScope, nextBookId)
	): Promise<void> {
		if (nextScope === "book" && !nextBookId) {
			return;
		}
		const isLatest = await saveCoordinator.enqueue(draftKey, nextSettings, (snapshot) =>
			saveSemanticSettingsForScope(plugin, nextScope, nextBookId, snapshot)
		);
		if (isLatest) {
			onSaved?.();
			await renderBody();
		}
	}

	async function renderBody(): Promise<void> {
		const version = ++renderVersion;
		body.replaceChildren();
		const loading = body.createDiv({
			cls: "weave-epub-semantic-loading",
			text: "正在加载语义配置…",
		});

		try {
			if (!booksLoaded) {
				books = await listSemanticProfileBooks(plugin);
				booksLoaded = true;
			}
			const activeReaderBook = getActiveReaderSemanticBookOption();
			if (!initialScopeResolved && activeReaderBook?.bookId && activeReaderBook.bookId !== bookId) {
				bookId = activeReaderBook.bookId;
				if (!books.some((book) => book.bookId === activeReaderBook.bookId)) {
					books = [activeReaderBook, ...books];
				}
				plugin.settings.semanticSettingsBookId = bookId;
				await plugin.saveSettings();
			}
			const resolvedBookId = await resolveActiveSemanticBookId(plugin, books, bookId);
			if (resolvedBookId !== bookId) {
				bookId = resolvedBookId;
				plugin.settings.semanticSettingsBookId = bookId;
				await plugin.saveSettings();
			}
			if (!initialScopeResolved) {
				initialScopeResolved = true;
				if (scope === "global" && bookId) {
					const bookProfile = await readBookEpubSemanticProfile(plugin.app, bookId);
					if (bookProfile) {
						scope = "book";
						plugin.settings.semanticSettingsScope = "book";
						await plugin.saveSettings();
						syncScopeButtons();
					}
				}
			}

			const globalProfile = await readGlobalEpubSemanticProfile(plugin.app, {
				annotationSemanticsEnabled: plugin.settings.annotationSemanticsEnabled,
				semanticSchemeId: plugin.settings.semanticSchemeId || DEFAULT_EPUB_SEMANTIC_SCHEME_ID,
				annotationSemantics: plugin.settings.annotationSemantics || DEFAULT_EPUB_ANNOTATION_SEMANTICS,
				standardSemanticIds: plugin.settings.standardSemanticIds || DEFAULT_EPUB_STANDARD_SEMANTIC_IDS,
			});
			const effective =
				scope === "book" && bookId
					? await loadEffectiveEpubSemanticProfile(plugin.app, bookId, plugin.settings)
					: {
							globalProfile,
							bookProfile: null,
							effectiveProfile: globalProfile,
							settings: profileToSettings(globalProfile),
						};

			if (version !== renderVersion || !body.isConnected) {
				return;
			}

			body.replaceChildren();
			if (scope === "book") {
				new Setting(body)
					.setName("书籍")
					.setDesc("选择要单独配置语义映射的 EPUB。")
					.addDropdown((dropdown) => {
						dropdown.selectEl.addClass("weave-epub-semantic-book-select");
						dropdown.addOption("", "选择书籍");
						for (const book of books) {
							dropdown.addOption(book.bookId, book.title);
						}
						if (bookId && !books.some((book) => book.bookId === bookId)) {
							dropdown.addOption(bookId, bookId);
						}
						dropdown.setValue(bookId);
						dropdown.onChange(async (value) => {
							bookId = value;
							await persistScopeChoice();
							await renderBody();
						});
					});
				body.createDiv({
					cls: "weave-epub-semantic-inheritance-note",
					text: effective.bookProfile
						? "这本书正在使用独立配置。"
						: "当前使用全局配置；首次修改会自动建立本书配置。",
				});
			}

			const currentSettings =
				scope === "global"
					? cloneSemanticSettings(profileToSettings(globalProfile))
					: cloneSemanticSettings(profileToSettings(effective.effectiveProfile));
			const currentScope = scope;
			const currentBookId = bookId;
			const draftKey = semanticProfileKey(currentScope, currentBookId);
			saveCoordinator.reset(draftKey, currentSettings);
			const getCurrentDraft = () => saveCoordinator.current(draftKey, currentSettings);
			const saveCurrentDraft = (nextSettings: EpubSemanticSettings) =>
				saveDraft(nextSettings, currentScope, currentBookId, draftKey);
			const editSemantic = async (semanticId: string, patch: Partial<EpubSemanticSettings["annotationSemantics"][number]>) => {
				const draft = getCurrentDraft();
				draft.annotationSemantics = draft.annotationSemantics.map((semantic) =>
					semantic.id === semanticId ? { ...semantic, ...patch, source: "custom" } : semantic
				);
				await saveCurrentDraft(draft);
			};

			const activeSemantics = activeSemanticEntries(currentSettings);
			const archivedCount = currentSettings.annotationSemantics.length - activeSemantics.length;
			const canEdit = currentScope === "global" || Boolean(currentBookId);
			const selectedScheme = getSemanticScheme(currentSettings.semanticSchemeId);
			const schemeModified = isSemanticSchemeModified(currentSettings);

			const displayToolSetting = new Setting(body)
				.setName("显示语义标注工具")
				.setDesc(
					currentScope === "global"
						? "应用于所有没有本书配置的 EPUB。"
						: currentBookId
							? "仅控制当前所选书籍。"
							: "请先选择一本书。"
				);
			displayToolSetting.addToggle((toggle) => {
				toggle.setValue(currentSettings.annotationSemanticsEnabled);
				toggle.setDisabled(!canEdit);
				toggle.onChange(async (enabled) => {
					const draft = getCurrentDraft();
					draft.annotationSemanticsEnabled = enabled;
					await saveCurrentDraft(draft);
				});
			});

			const schemeSetting = new Setting(body)
				.setName(schemeModified ? "语义方案 · 已调整" : "语义方案")
				.setDesc(
					selectedScheme
						? `当前启用 ${activeSemantics.length} 个语义；切换方案后仍会保留旧标注所需的历史映射。`
						: `当前启用 ${activeSemantics.length} 个语义；自定义方案没有可恢复的系统初始版本。`
				);
			schemeSetting.addDropdown((dropdown) => {
				dropdown.selectEl.addClass("weave-epub-semantic-scheme-select");
				dropdown.addOption("custom", "自定义方案");
				for (const scheme of SYSTEM_SEMANTIC_SCHEMES) {
					dropdown.addOption(
						scheme.id,
						scheme.id === currentSettings.semanticSchemeId && schemeModified
							? `${scheme.label}（${scheme.semantics.length}，已调整）`
							: `${scheme.label}（${scheme.semantics.length}）`
					);
				}
				dropdown.setValue(selectedScheme ? currentSettings.semanticSchemeId : "custom");
				dropdown.setDisabled(!canEdit);
				dropdown.onChange(async (value) => {
					if (!canEdit) {
						return;
					}
					if (value === "custom") {
						const draft = getCurrentDraft();
						draft.semanticSchemeId = "custom";
						await saveCurrentDraft(draft);
						return;
					}
					const nextScheme = getSemanticScheme(value);
					if (
						nextScheme &&
						currentBookId &&
						value !== currentSettings.semanticSchemeId
					) {
						const confirmed = await confirmClearBookSemanticAnnotationsForSchemeChange(
							plugin,
							currentBookId,
							nextScheme.label
						);
						if (!confirmed) {
							dropdown.setValue(selectedScheme ? currentSettings.semanticSchemeId : "custom");
							return;
						}
					}
					await saveCurrentDraft(applySemanticScheme(getCurrentDraft(), value));
				});
			});
			schemeSetting.addButton((button) => {
				button.setButtonText("恢复此方案初始设置");
				button.setDisabled(!canEdit || !selectedScheme || !schemeModified);
				button.onClick(async () => {
					if (!canEdit || !selectedScheme || !schemeModified) {
						return;
					}
					await saveCurrentDraft(
						applySemanticScheme(getCurrentDraft(), currentSettings.semanticSchemeId)
					);
				});
			});

			const list = body.createDiv({ cls: "weave-epub-semantic-settings-list" });
			const standardIds = new Set(currentSettings.standardSemanticIds);
			const standardFull = standardIds.size >= 4;
			for (const semantic of activeSemantics) {
				const row = list.createDiv({ cls: "weave-epub-semantic-setting-row" });
				const preview = row.createDiv({ cls: "weave-epub-semantic-setting-preview" });
				preview.style.setProperty("--weave-semantic-color", getSemanticColorHex(semantic.color));
				preview.createSpan({ cls: "weave-epub-semantic-dot" });
				preview.createSpan({ cls: "weave-epub-semantic-setting-label", text: semantic.label });

				const nameInput = row.createEl("input", {
					type: "text",
					cls: "weave-epub-semantic-name-input",
					attr: { "aria-label": `${semantic.label}名称` },
				});
				nameInput.value = semantic.label;
				nameInput.disabled = !canEdit;
				nameInput.addEventListener("change", async () => {
					await editSemantic(semantic.id, { label: nameInput.value.trim() || semantic.label });
				});

				const colorSwatches = row.createDiv({
					cls: "weave-epub-semantic-color-swatches",
					attr: { role: "group", "aria-label": `${semantic.label}颜色` },
				});
				for (const [color, label] of Object.entries(SEMANTIC_COLOR_LABELS)) {
					const swatch = colorSwatches.createEl("button", {
						type: "button",
						cls: "weave-epub-semantic-color-swatch",
						attr: {
							title: label,
							"aria-label": label,
							"aria-pressed": color === semantic.color ? "true" : "false",
						},
					});
					swatch.style.setProperty("--weave-semantic-color", getSemanticColorHex(color));
					if (color === semantic.color) {
						swatch.addClass("is-selected");
					}
					swatch.disabled = !canEdit;
					swatch.addEventListener("click", async () => {
						await editSemantic(semantic.id, { color });
					});
				}

				const styleSelect = row.createEl("select", {
					cls: "weave-epub-semantic-style-select",
					attr: { "aria-label": `${semantic.label}标注方式` },
				});
				for (const style of SEMANTIC_ANNOTATION_STYLE_TOKENS) {
					const option = styleSelect.createEl("option", {
						text: ANNOTATION_STYLE_LABELS[style as keyof typeof ANNOTATION_STYLE_LABELS] || style,
					});
					option.value = style;
					if (style === semantic.style) {
						option.selected = true;
					}
				}
				styleSelect.disabled = !canEdit;
				styleSelect.addEventListener("change", async () => {
					await editSemantic(semantic.id, { style: styleSelect.value as EpubSemanticSettings["annotationSemantics"][number]["style"] });
				});

				const standardLabel = row.createEl("label", {
					cls: "weave-epub-semantic-standard-toggle",
				});
				const checkbox = standardLabel.createEl("input", { type: "checkbox" });
				checkbox.checked = standardIds.has(semantic.id);
				checkbox.disabled = !canEdit || (!checkbox.checked && standardFull);
				standardLabel.createSpan({ text: "普通模式" });
				checkbox.addEventListener("change", async () => {
					const draft = getCurrentDraft();
					const nextIds = new Set(draft.standardSemanticIds);
					if (checkbox.checked) {
						nextIds.add(semantic.id);
					} else {
						nextIds.delete(semantic.id);
					}
					draft.standardSemanticIds = draft.annotationSemantics
						.filter((entry) => nextIds.has(entry.id) && entry.active !== false)
						.map((entry) => entry.id)
						.slice(0, 4);
					draft.annotationSemantics = draft.annotationSemantics.map((entry) => ({
						...entry,
						showInStandard: draft.standardSemanticIds.includes(entry.id),
					}));
					await saveCurrentDraft(draft);
				});

				const deleteButton = row.createEl("button", {
					type: "button",
					cls: "weave-epub-semantic-delete-button",
					attr: {
						title: "移除语义",
						"aria-label": `移除${semantic.label}`,
					},
				});
				setIcon(deleteButton, "trash-2");
				deleteButton.disabled = !canEdit || activeSemantics.length <= SEMANTIC_SCHEME_MIN_ITEMS;
				deleteButton.addEventListener("click", async () => {
					await saveCurrentDraft(archiveSemantic(getCurrentDraft(), semantic.id));
				});
			}

			const footer = body.createDiv({ cls: "weave-epub-semantic-settings-footer" });
			const count = footer.createSpan({
				cls: "weave-epub-semantic-count",
				text: `${activeSemantics.length} / ${SEMANTIC_SCHEME_MAX_ITEMS}`,
			});
			if (archivedCount > 0) {
				count.setAttribute("title", `另保留 ${archivedCount} 个历史映射，用于显示旧标注`);
			}
			const addButton = footer.createEl("button", {
				type: "button",
				cls: "weave-epub-semantic-add-button",
				attr: { title: "添加语义" },
			});
			setIcon(addButton, "plus");
			addButton.createSpan({ text: "添加语义" });
			addButton.disabled = !canEdit || activeSemantics.length >= SEMANTIC_SCHEME_MAX_ITEMS;
			addButton.addEventListener("click", async () => {
				await saveCurrentDraft(addCustomSemantic(getCurrentDraft()));
			});
		} catch (error) {
			if (version !== renderVersion || !body.isConnected) {
				return;
			}
			body.replaceChildren();
			body.createDiv({
				cls: "weave-epub-semantic-settings-error",
				text: "语义配置加载失败，请重新打开设置页。",
			});
			console.error("[SemanticProfiles] Failed to render settings:", error);
		} finally {
			loading.remove();
		}
	}

	void renderBody();

	return () => {
		host.replaceChildren();
	};
}
