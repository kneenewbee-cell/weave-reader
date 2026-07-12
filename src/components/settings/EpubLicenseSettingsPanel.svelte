<script lang="ts">
  import EnhancedActivationForm from "./components/EnhancedActivationForm.svelte";
  import EnhancedLicenseStatusCard from "./components/EnhancedLicenseStatusCard.svelte";
  import {
    getPluginEffectiveLicenseState,
    getPluginActivationRemovalKind,
    removePluginActivation,
  } from "../../utils/plugin-license";
  import { emitWeaveLicenseChanged } from "../../utils/license-sync-bridge";
  import { createSafeNotice } from "../../utils/obsidian-api-safe";
  import { showObsidianConfirm } from "../../utils/obsidian-confirm";
  import { showNotification } from "../../utils/notifications";
  import { copyTextToClipboard } from "../../utils/clipboard-copy";
  import { tr } from "../../utils/i18n";
  import {
    LIFETIME_LICENSE_PAYPAL_READER_PURCHASE_URL,
    LIFETIME_LICENSE_PURCHASE_URL,
    WEAVE_SERIES_PAYPAL_PURCHASE_URL,
  } from "../../config/plugin-runtime";
  import { openObsidianWebUrl } from "../../services/obsidian/obsidian-open-web-url";
  import { Menu } from "obsidian";
  import type StandaloneEpubPlugin from "../../main";

  interface Props {
    plugin: StandaloneEpubPlugin;
  }

  let { plugin }: Props = $props();
  let t = $derived($tr);

  let stateVersion = $state(0);
  let isRemoving = $state(false);
  let isSavingCode = $state(false);

  function refreshSnapshot(): void {
		stateVersion += 1;
	}

  let effectiveLicenseState = $derived.by(() => {
		stateVersion;
		return getPluginEffectiveLicenseState(plugin);
	});

  let currentLicense = $derived.by(() => {
		stateVersion;
		return effectiveLicenseState.primaryLicense || plugin.settings?.license || null;
	});

  async function save(): Promise<void> {
		await plugin.saveSettings();
		refreshSnapshot();
	}

  async function saveActivationCode(): Promise<void> {
    if (isSavingCode || isRemoving) {
      return;
    }

    const activationCode = currentLicense?.activationCode?.trim();

    if (!activationCode) {
      createSafeNotice(t("epub.settings.license.noSavableCode"), 2600);
      return;
    }

    isSavingCode = true;

    try {
      const copied = await copyTextToClipboard(activationCode);
      if (copied) {
        createSafeNotice(t("epub.settings.license.codeCopied"), 2600);
      } else {
        createSafeNotice(t("epub.settings.license.codeCopyFailed"), 3000);
      }
    } finally {
      isSavingCode = false;
    }
  }

  async function resetLicense(): Promise<void> {
    if (isRemoving || isSavingCode) {
      return;
    }

    const removalKind = getPluginActivationRemovalKind(plugin, { disableInheritedLicenses: true });

	if (removalKind === "none") {
		await plugin.refreshPremiumState?.();
		refreshSnapshot();
		showNotification(t("epub.settings.license.noActivationToRemove"), "info");
		return;
	}

    const confirmed = await showObsidianConfirm(
      plugin.app,
      t("epub.settings.license.confirmRemove"),
      { title: t("epub.settings.license.confirmRemoveTitle") }
    );

    if (!confirmed) {
      return;
    }

    isRemoving = true;

    try {
      const result = removePluginActivation(plugin, { disableInheritedLicenses: true });
      await plugin.saveSettings();
      emitWeaveLicenseChanged(plugin.app);

      const nextState = result.nextState;
      refreshSnapshot();

      if (nextState.isPremiumActive) {
        showNotification(t("epub.settings.license.removeAbnormal"), "error");
        return;
      }

      if (result.removalKind === "inherited-only") {
		showNotification(t("epub.settings.license.inheritedRemoved"), "success");
		return;
	  }

      showNotification(t("epub.settings.license.removed"), "success");
    } catch {
      showNotification(t("epub.settings.license.removeFailed"), "error");
    } finally {
      isRemoving = false;
    }
  }

  function attachMenuApp(menu: Menu): void {
    (menu as Menu & { app?: StandaloneEpubPlugin["app"] }).app = plugin.app;
  }

  function openPurchaseUrl(url: string): void {
    void openObsidianWebUrl(plugin.app, url, { preferExternal: true });
  }

  function showPurchaseMenu(event: MouseEvent): void {
    const menu = new Menu();
    attachMenuApp(menu);

    menu.addItem((item) => {
      item.setTitle(t("epub.settings.license.purchaseOptionMainland"));
      item.setIcon("store");
      item.onClick(() => {
        openPurchaseUrl(LIFETIME_LICENSE_PURCHASE_URL);
      });
    });

    menu.addItem((item) => {
      item.setTitle(t("epub.settings.license.purchaseOptionPaypal"));
      item.setIcon("globe");
      const subMenu = item.setSubmenu();
      attachMenuApp(subMenu);

      subMenu.addItem((subItem) => {
        subItem.setTitle(t("epub.settings.license.purchaseOptionPaypalReader"));
        subItem.setIcon("book-open");
        subItem.onClick(() => {
          openPurchaseUrl(LIFETIME_LICENSE_PAYPAL_READER_PURCHASE_URL);
        });
      });

      subMenu.addItem((subItem) => {
        subItem.setTitle(t("epub.settings.license.purchaseOptionPaypalSeries"));
        subItem.setIcon("layers");
        subItem.onClick(() => {
          openPurchaseUrl(WEAVE_SERIES_PAYPAL_PURCHASE_URL);
        });
      });
    });

    menu.showAtMouseEvent(event);
  }
</script>

<section class="epub-license-settings-panel">
  <div class="epub-license-settings-card">
    <div class="epub-license-settings-header">
      <div class="section-title-row">
        <h3 class="section-title with-accent-bar accent-purple">{t("epub.settings.license.title")}</h3>
        <button
          type="button"
          class="clickable-icon license-purchase-link"
          onclick={showPurchaseMenu}
        >
          {t("epub.settings.license.purchaseLink")}
        </button>
      </div>
      <p class="section-description">{t("epub.settings.license.description")}</p>
    </div>

    <div class="epub-license-settings-content">
    {#if effectiveLicenseState.isPremiumActive}
      <EnhancedLicenseStatusCard
        license={currentLicense}
        app={plugin.app}
        effectiveState={effectiveLicenseState}
        showActions={true}
        isSavingCode={isSavingCode}
        isResetting={isRemoving}
        onSaveCode={saveActivationCode}
        onReset={resetLicense}
      />
    {/if}

    {#if !effectiveLicenseState.isPremiumActive}
      <EnhancedActivationForm
        {plugin}
        onSave={save}
        showHeader={false}
        displayState={effectiveLicenseState}
        standalone={false}
      />
    {/if}
    </div>
  </div>
</section>

<style>
  .epub-license-settings-panel {
    /* Spacing tokens aligned with settings panel */
    --epub-settings-gap-sm: 0.35rem;
    --epub-settings-gap-lg: 1rem;
    --epub-settings-panel-padding: 1rem;
    --epub-settings-radius-panel: 18px;
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .epub-license-settings-card {
    display: flex;
    flex-direction: column;
    gap: var(--epub-settings-gap-lg);
    padding: var(--epub-settings-panel-padding);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--epub-settings-radius-panel);
    background: color-mix(in oklab, var(--background-primary), var(--background-secondary) 26%);
  }

  .epub-license-settings-header {
    display: flex;
    flex-direction: column;
    gap: var(--epub-settings-gap-sm);
    min-width: 0;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--epub-settings-gap-lg);
    min-width: 0;
  }

  .section-title-row .section-title {
    flex: 1 1 auto;
    min-width: 0;
  }

  .epub-license-settings-panel button.clickable-icon.license-purchase-link,
  .epub-license-settings-panel button.clickable-icon.license-purchase-link:hover,
  .epub-license-settings-panel button.clickable-icon.license-purchase-link:focus,
  .epub-license-settings-panel button.clickable-icon.license-purchase-link:active {
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    border: none;
    border-width: 0;
    border-color: transparent;
    box-shadow: none;
    outline: none;
    background: transparent;
    background-color: transparent;
  }

  .epub-license-settings-panel button.clickable-icon.license-purchase-link {
    flex-shrink: 0;
    margin: 0;
    padding: 0;
    width: auto;
    height: auto;
    min-width: 0;
    min-height: 0;
    font: inherit;
    font-size: var(--epub-settings-font-size-desc, var(--font-ui-smaller, 0.85rem));
    color: var(--text-accent);
    text-decoration: none;
    white-space: nowrap;
    cursor: pointer;
    transition: color 0.15s ease, opacity 0.15s ease;
  }

  .epub-license-settings-panel button.clickable-icon.license-purchase-link:hover {
    color: var(--text-accent-hover, var(--text-accent));
    opacity: 0.88;
  }

  .epub-license-settings-panel button.clickable-icon.license-purchase-link:focus-visible {
    outline: 2px solid var(--text-accent);
    outline-offset: 2px;
  }

  .epub-license-settings-content {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--epub-settings-gap-lg);
  }

  .section-title {
    margin: 0;
    font-size: var(--epub-settings-font-size-title, var(--font-ui-medium, 1rem));
    font-weight: 600;
    color: var(--text-normal);
    line-height: 1.4;
  }

  .section-title.with-accent-bar {
    position: relative;
    padding-left: 16px;
  }

  .section-title.with-accent-bar::before {
    content: "";
    position: absolute;
    left: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 4px;
    height: 80%;
    border-radius: var(--radius-s, 2px);
  }

  .section-title.accent-purple::before {
    background: linear-gradient(
      135deg,
      color-mix(in oklab, var(--color-purple), transparent 20%),
      color-mix(in oklab, var(--color-purple), transparent 40%)
    );
  }

  .section-description {
    margin: 0;
    font-size: var(--epub-settings-font-size-desc, var(--font-ui-smaller, 0.85rem));
    color: var(--text-muted);
    line-height: 1.55;
  }

  .epub-license-settings-content :global(.enhanced-activation-form .activation-form) {
    gap: 1.1rem;
  }

  .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child)) {
    display: grid;
    grid-template-columns: minmax(7rem, 9rem) minmax(0, 1fr);
    column-gap: var(--epub-settings-gap-lg);
    row-gap: var(--epub-settings-gap-sm);
    align-items: start;
  }

  .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child) .input-label) {
    display: block;
    grid-column: 1;
    padding-top: 0.4rem;
  }

  .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child) .input-hint) {
    display: none;
  }

  .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child) .email-input),
  .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child) .email-hint) {
    grid-column: 2;
    width: 100%;
  }

  .epub-license-settings-content :global(.enhanced-activation-form .action-section) {
    justify-content: flex-end;
  }

  @media (max-width: 720px) {
    .epub-license-settings-card {
      padding: calc(var(--epub-settings-panel-padding) - 0.1rem);
      border-radius: var(--radius-l, 14px);
    }

    .section-title-row {
      flex-wrap: wrap;
      row-gap: var(--epub-settings-gap-sm);
    }

    .epub-license-settings-panel button.clickable-icon.license-purchase-link {
      white-space: normal;
    }

    .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child)) {
      grid-template-columns: 1fr;
      row-gap: 0.25rem;
    }

    .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child) .input-label),
    .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child) .email-input),
    .epub-license-settings-content :global(.enhanced-activation-form .input-section:not(:first-child) .email-hint) {
      grid-column: 1;
    }

    .epub-license-settings-content :global(.enhanced-activation-form .action-section) {
      justify-content: center;
    }
  }

</style>
