<script lang="ts">
  /**
   * 增强的许可证状态卡片组件
   * 提供清晰、突出的激活状态显示
   */
  
  import { LEGACY_WEAVE_PRODUCT_IDS } from '../../../config/plugin-runtime';
  import type { EffectiveLicenseState, LicenseInfo } from '../../../types/license';
  import { tr } from '../../../utils/i18n';
  import {
    formatLicenseDeviceStats,
    resolveLicenseDeviceStats,
  } from '../../../utils/license-device-stats';
  
  interface Props {
    license: LicenseInfo | null;
    app?: import('obsidian').App;
    effectiveState?: EffectiveLicenseState;
    showActions?: boolean;
    onSaveCode?: () => Promise<void>;
    onReset?: () => Promise<void>;
    isSavingCode?: boolean;
    isResetting?: boolean;
  }
  
  let {
    license,
    app,
    effectiveState,
    showActions = true,
    onSaveCode,
    onReset,
    isSavingCode = false,
    isResetting = false,
  }: Props = $props();
  let t = $derived($tr);
 
  function formatLicenseSourcePluginName(sourcePluginId: string | undefined): string {
    if (sourcePluginId === 'weave') {
      return t('epub.settings.license.statusCard.source.weave');
    }
    if (sourcePluginId === 'weave-epub-reader') {
      return t('epub.settings.license.statusCard.source.reader');
    }
    return t('epub.settings.license.statusCard.source.related');
  }

  function isWeavePrimaryActivationCode(license: LicenseInfo | null): boolean {
    if (!license) {
      return false;
    }

    return LEGACY_WEAVE_PRODUCT_IDS.has(license.issuedProductId ?? '') || Boolean(license.entitlements?.includes('weave-premium'));
  }
  
  // 状态计算
  let localLicenseCount = $derived(effectiveState?.localLicenses.length ?? (license?.activationCode ? 1 : 0));

  let inheritedLicenseCount = $derived(effectiveState?.inheritedLicenses.length ?? 0);

  let displayLicense = $derived(effectiveState?.primaryLicense ?? license ?? null);

  let isActivated = $derived(effectiveState?.isPremiumActive ?? (displayLicense?.isActivated || false));

  let licenseSourceLabel = $derived.by(() => {
    if (!displayLicense) return t('epub.settings.license.statusCard.source.unactivated');
    if (displayLicense.source === 'inherited') {
      return displayLicense.sourcePluginId
				? t('epub.settings.license.statusCard.source.sharedFrom', { product: formatLicenseSourcePluginName(displayLicense.sourcePluginId) })
				: t('epub.settings.license.statusCard.source.shared');
    }
    return isWeavePrimaryActivationCode(displayLicense)
      ? t('epub.settings.license.statusCard.source.weavePrimaryCode')
      : t('epub.settings.license.statusCard.source.readerActivationCode');
  });

  let hasLocalLicense = $derived(localLicenseCount > 0);

  let isInheritedOnly = $derived(isActivated && !hasLocalLicense && inheritedLicenseCount > 0);

  let statusBadgeText = $derived(
    isInheritedOnly
      ? t('epub.settings.license.statusCard.sharedActive')
      : t('epub.settings.license.statusCard.activated')
  );

  let statusBadgeClass = $derived(isInheritedOnly ? 'inherited' : 'success');
  
  // 许可证类型显示
  let licenseTypeInfo = $derived.by(() => {
    if (!displayLicense?.licenseType) {
      return { text: t('epub.settings.license.statusCard.licenseType.unknown'), color: 'gray' };
    }

    switch (displayLicense.licenseType) {
      case 'lifetime':
        return { text: t('epub.settings.license.statusCard.licenseType.lifetime'), color: 'premium' };
      case 'subscription':
        return { text: t('epub.settings.license.statusCard.licenseType.subscription'), color: 'subscription' };
      default:
        return { text: t('epub.settings.license.statusCard.licenseType.default'), color: 'default' };
    }
  });
  
  // 到期状态
  let deviceStats = $derived(resolveLicenseDeviceStats(displayLicense, app));

  let expiryInfo = $derived.by(() => {
    if (!displayLicense?.expiresAt) return null;
    
    const expiryDate = new Date(displayLicense.expiresAt);
    const now = new Date();
    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    
    if (daysUntilExpiry < 0) {
      return { status: 'expired', text: t('epub.settings.license.statusCard.expiry.expired'), color: 'red' };
    } else if (daysUntilExpiry <= 30) {
      return { status: 'expiring', text: t('epub.settings.license.statusCard.expiry.inDays', { days: daysUntilExpiry }), color: 'orange' };
    } else if (daysUntilExpiry <= 365) {
      return { status: 'active', text: t('epub.settings.license.statusCard.expiry.inDays', { days: daysUntilExpiry }), color: 'green' };
    } else {
      return { status: 'long-term', text: t('epub.settings.license.statusCard.expiry.longTerm'), color: 'green' };
    }
  });
  
</script>

{#if isActivated}
  <!-- 激活状态卡片 -->
  <div class="license-status-card activated">
    <!-- 状态头部 -->
    <div class="status-header">
      <div class="status-badge {statusBadgeClass}">
        <span class="badge-text">{statusBadgeText}</span>
      </div>
    </div>
    
    <!-- 许可证详情 -->
    <div class="license-details">
      <div class="detail-grid">
        <!-- 许可证类型 -->
        <div class="detail-item">
          <div class="detail-label">{t('epub.settings.license.statusCard.labels.licenseType')}</div>
          <div class="detail-value">
            <span class="license-type-badge {licenseTypeInfo.color}">
              {licenseTypeInfo.text}
            </span>
          </div>
        </div>

        <div class="detail-item">
          <div class="detail-label">{t('epub.settings.license.statusCard.labels.source')}</div>
          <div class="detail-value">{licenseSourceLabel}</div>
        </div>

        <div class="detail-item">
          <div class="detail-label">{t('epub.settings.license.statusCard.labels.localCount')}</div>
          <div class="detail-value">{localLicenseCount}</div>
        </div>

        {#if inheritedLicenseCount > 0}
          <div class="detail-item">
            <div class="detail-label">{t('epub.settings.license.statusCard.labels.inheritedCount')}</div>
            <div class="detail-value">{inheritedLicenseCount}</div>
          </div>
        {/if}

        {#if deviceStats}
          <div class="detail-item">
            <div class="detail-label">{t('epub.settings.license.statusCard.labels.deviceUsage')}</div>
            <div class="detail-value">{formatLicenseDeviceStats(deviceStats)}</div>
          </div>
        {/if}
        
        <!-- 激活时间 -->
        <div class="detail-item">
          <div class="detail-label">{t('epub.settings.license.statusCard.labels.activatedAt')}</div>
          <div class="detail-value">
            {displayLicense?.activatedAt ? new Date(displayLicense.activatedAt).toLocaleString() : '-'}
          </div>
        </div>
        
        <!-- 到期时间 -->
        {#if displayLicense?.expiresAt && displayLicense.licenseType !== 'lifetime'}
          <div class="detail-item">
            <div class="detail-label">{t('epub.settings.license.statusCard.labels.expiresAt')}</div>
            <div class="detail-value">
              <span class="expiry-date {expiryInfo?.color}">
                {new Date(displayLicense.expiresAt).toLocaleString()}
              </span>
              {#if expiryInfo}
                <span class="expiry-status {expiryInfo?.color ?? ''}">
                  ({expiryInfo?.text ?? ''})
                </span>
              {/if}
            </div>
          </div>
        {/if}
        
      </div>

      {#if isInheritedOnly}
        <div class="license-source-note">
          {t('epub.settings.license.statusCard.inheritedNote')}
        </div>
      {/if}
      
    </div>
    
    <!-- 操作按钮 -->
    {#if showActions}
      <div class="license-actions">
        <div class="license-actions-left">
          {#if onSaveCode}
            <button class="action-button" onclick={onSaveCode} disabled={isSavingCode || isResetting}>
              {t('epub.settings.license.statusCard.saveCode')}
            </button>
          {/if}
        </div>

        <div class="license-actions-right">
          {#if onReset}
            <button class="action-button secondary" onclick={onReset} disabled={isSavingCode || isResetting}>
              {t('epub.settings.license.statusCard.removeActivation')}
            </button>
          {/if}
        </div>
      </div>
    {/if}
  </div>
{:else}
  <!-- 未激活状态 -->
  <div class="license-status-card not-activated">
    <div class="status-header">
      <div class="status-badge inactive">
        <span class="badge-text">{t('epub.settings.license.statusCard.notActivated')}</span>
      </div>
    </div>
    
    <div class="inactive-message">
      <p>{t('epub.settings.license.statusCard.freeOnlyMessage')}</p>
    </div>
  </div>
{/if}

<style>
  .license-status-card {
    --epub-settings-font-size-label: var(--font-ui-small, 0.95rem);
    --epub-settings-font-size-desc: var(--font-ui-smaller, 0.85rem);
    --epub-settings-gap-xs: 0.25rem;
    --epub-settings-gap-sm: 0.35rem;
    --epub-settings-gap-md: 0.5rem;
    --epub-settings-gap-lg: 1rem;
    --epub-settings-radius-sm: var(--radius-s, 6px);
    --epub-settings-radius-md: var(--radius-m, 8px);
    border: 1px solid var(--background-modifier-border);
    border-radius: var(--epub-settings-radius-md);
    padding: 0;
    background: var(--background-primary-alt, var(--background-primary));
    overflow: hidden;
  }
  
  .license-status-card.activated {
    border-color: color-mix(in srgb, var(--background-modifier-border) 75%, var(--color-green));
  }
  
  .license-status-card.not-activated {
    border-color: color-mix(in srgb, var(--background-modifier-border) 75%, var(--color-orange));
  }
  
  .status-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--epub-settings-gap-lg) var(--epub-settings-gap-lg) 0;
    margin-bottom: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-xs));
  }
  
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: var(--epub-settings-gap-md);
    padding: var(--epub-settings-gap-xs) calc(var(--epub-settings-gap-md) + 0.125rem);
    border-radius: var(--epub-settings-radius-sm);
    font-weight: 600;
    font-size: var(--font-ui-small);
    border: 1px solid var(--background-modifier-border);
  }
  
  .status-badge.success {
    background: color-mix(in srgb, var(--background-secondary) 88%, var(--color-green));
    color: var(--color-green);
    border-color: color-mix(in srgb, var(--background-modifier-border) 60%, var(--color-green));
  }

  .status-badge.inherited {
    background: color-mix(in srgb, var(--background-secondary) 88%, var(--color-purple));
    color: var(--color-purple);
    border-color: color-mix(in srgb, var(--background-modifier-border) 60%, var(--color-purple));
  }
  
  .status-badge.inactive {
    background: color-mix(in srgb, var(--background-secondary) 88%, var(--color-orange));
    color: var(--color-orange);
    border-color: color-mix(in srgb, var(--background-modifier-border) 60%, var(--color-orange));
  }
  
  .license-type-badge {
    display: inline-flex;
    align-items: center;
    gap: calc(var(--epub-settings-gap-sm) - 0.025rem);
    padding: calc(var(--epub-settings-gap-xs) - 0.05rem) calc(var(--epub-settings-gap-md) + 0.05rem);
    border-radius: var(--epub-settings-radius-sm);
    font-weight: 500;
    font-size: 0.75rem;
    border: 1px solid var(--background-modifier-border);
    background: var(--background-secondary);
    color: var(--text-normal);
  }
  
  .license-type-badge.premium {
    border-color: color-mix(in srgb, var(--background-modifier-border) 60%, var(--color-purple));
  }
  
  .license-type-badge.standard {
    border-color: color-mix(in srgb, var(--background-modifier-border) 60%, var(--color-blue));
  }
  
  .license-type-badge.trial {
    border-color: color-mix(in srgb, var(--background-modifier-border) 60%, var(--color-orange));
  }

  .license-type-badge.subscription {
    border-color: color-mix(in srgb, var(--background-modifier-border) 60%, var(--color-green));
  }
  
  .detail-grid {
    display: grid;
    gap: 0;
    margin-bottom: 0;
  }
  
  .detail-item {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--epub-settings-gap-lg);
    padding: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-sm)) var(--epub-settings-gap-lg);
    background: transparent;
    border-radius: 0;
    border-top: 1px solid var(--background-modifier-border);
  }

  .detail-grid .detail-item:first-child {
    border-top: none;
  }
  
  .detail-label {
    font-weight: 500;
    color: var(--text-muted);
    font-size: var(--epub-settings-font-size-desc);
  }

  .action-button:disabled {
    opacity: 0.65;
    cursor: default;
  }
  
  .detail-value {
    font-weight: 500;
    color: var(--text-normal);
    text-align: right;
  }

  .license-source-note {
    padding: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-sm)) var(--epub-settings-gap-lg) 0;
    color: var(--text-muted);
    line-height: 1.55;
    font-size: var(--epub-settings-font-size-desc);
  }
  
  .license-type-display {
    font-weight: 600;
  }
  
  .license-type-display.premium {
    color: var(--color-purple);
  }
  
  .lifetime-badge {
    display: inline-block;
    margin-left: var(--epub-settings-gap-md);
    padding: 0.125rem var(--epub-settings-gap-md);
    background: linear-gradient(135deg, #10B981 0%, #059669 100%);
    color: white;
    border-radius: var(--epub-settings-radius-sm);
    font-size: 0.625rem;
    font-weight: 700;
  }
  
  .expiry-status.green {
    color: var(--color-green);
  }
  
  .expiry-status.orange {
    color: var(--color-orange);
  }
  
  .expiry-status.red {
    color: var(--color-red);
  }
  
  
  .license-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-xs));
    padding: var(--epub-settings-gap-lg);
    border-top: 1px solid var(--background-modifier-border);
  }

  .license-actions-left,
  .license-actions-right {
    display: flex;
    align-items: center;
    gap: calc(var(--epub-settings-gap-md) + var(--epub-settings-gap-xs));
  }

  .license-actions-left {
    justify-content: flex-end;
  }

  .license-actions-right {
    justify-content: flex-end;
  }
  
  button.action-button,
  button.action-button:hover,
  button.action-button:active,
  button.action-button:focus,
  button.action-button:focus-visible,
  button.action-button.secondary,
  button.action-button.secondary:hover,
  button.action-button.secondary:active,
  button.action-button.secondary:focus,
  button.action-button.secondary:focus-visible {
    padding: calc(var(--epub-settings-gap-xs) + 0.05rem) 0 !important;
    min-height: auto !important;
    height: auto !important;
    border: none !important;
    outline: none !important;
    box-shadow: none !important;
    border-radius: 0 !important;
    background: transparent !important;
    color: var(--text-muted) !important;
    cursor: pointer;
    transition: color 0.15s ease !important;
    font-size: var(--epub-settings-font-size-desc);
    font-weight: 500;
    line-height: 1.4;
  }

  button.action-button:hover,
  button.action-button.secondary:hover {
    color: var(--text-normal) !important;
  }

  button.action-button:focus-visible,
  button.action-button.secondary:focus-visible {
    color: var(--interactive-accent) !important;
  }
  
  .inactive-message {
    padding: 0 var(--epub-settings-gap-lg) var(--epub-settings-gap-lg);
    color: var(--text-muted);
    line-height: 1.55;
  }

  .inactive-message p {
    margin: 0;
  }

  @media (max-width: 720px) {
    .detail-item {
      flex-direction: column;
      align-items: stretch;
    }

    .detail-value {
      text-align: left;
    }

    .license-actions {
      justify-content: flex-end;
      flex-wrap: wrap;
    }

    .license-actions-left,
    .license-actions-right {
      width: auto;
    }
  }
</style>
