const BASE = 'http://localhost:10100';
const finite = value => typeof value === 'number' && Number.isFinite(value);
const pick = (object, keys) => Object.fromEntries(keys.filter(key => object?.[key] !== undefined).map(key => [key, object[key]]));
const iso = value => {
  if (!finite(value) || value <= 0) return null;
  const date = new Date(value < 1e12 ? value * 1000 : value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
};

export function projectQuota(quota, now = Date.now()) {
  if (!quota || typeof quota !== 'object') return null;
  const windows = [];
  for (const [prefix, label] of [['fiveHour', '5 hours'], ['weekly', 'weekly'], ['monthly', 'monthly']]) {
    if (finite(quota[`${prefix}Percent`])) windows.push({
      label, usedPercent: quota[`${prefix}Percent`],
      remainingPercent: Math.max(0, 100 - quota[`${prefix}Percent`]),
      resetsAt: iso(quota[`${prefix}ResetAt`]),
    });
  }
  for (const window of quota.customWindows ?? []) {
    const balanceOnly = /balance/i.test(window.label ?? '');
    windows.push({
      ...pick(window, ['label', 'modelId', 'scope', 'rejected']),
      ...(finite(window.percent) && !balanceOnly ? {
        usedPercent: window.percent, remainingPercent: Math.max(0, 100 - window.percent),
      } : {}),
      ...(balanceOnly ? { balanceDisplay: window.label } : {}),
      resetsAt: iso(window.resetAt),
    });
  }
  const updatedAt = iso(quota.updatedAt);
  return {
    windows, updatedAt,
    ageSeconds: updatedAt ? Math.max(0, Math.floor((now - Date.parse(updatedAt)) / 1000)) : null,
    ...(quota.creditsUsd ? { creditsUsd: pick(quota.creditsUsd, ['used', 'limit', 'remaining', 'percent', 'unlimited']), creditsExpireAt: iso(quota.creditsUsd.expiresAt) } : {}),
    ...pick(quota, ['kiroCreditsUsed', 'kiroCreditsLimit']),
  };
}

export async function getProviderQuotas(provider, fetcher = fetch) {
  async function request(path, headers = {}) {
    try {
      return await fetcher(`${BASE}${path}`, {
        method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(45000),
      });
    } catch {
      throw new Error('OpenCodex is unreachable or timed out. Check http://localhost:10100 in your browser and retry.');
    }
  }
  async function session() {
    const page = await request('/');
    if (!page.ok) throw new Error(`OpenCodex dashboard returned HTTP ${page.status}.`);
    const html = await page.text();
    const meta = name => html.match(new RegExp(`name="${name}" content="([^"]+)"`))?.[1];
    const token = meta('opencodex-session-token');
    if (!token?.startsWith('ocx_session_') || meta('opencodex-session-origin') !== BASE) {
      throw new Error('OpenCodex did not issue a local dashboard session. Open the dashboard and check its authentication settings.');
    }
    return { Authorization: `Bearer ${token}`, 'x-opencodex-gui-origin': BASE };
  }
  let headers = await session();
  async function json(path) {
    let response = await request(path, headers);
    if (response.status === 401 || response.status === 403) {
      headers = await session();
      response = await request(path, headers);
    }
    if (!response.ok) throw new Error(`OpenCodex quota query returned HTTP ${response.status}. Check dashboard access and retry.`);
    try { return await response.json(); }
    catch { throw new Error('OpenCodex returned invalid JSON. Check the dashboard and retry.'); }
  }
  const [roster, snapshot] = await Promise.all([json('/api/providers'), json('/api/provider-quotas')]);
  if (!Array.isArray(roster) || !Array.isArray(snapshot?.reports)) throw new Error('OpenCodex quota response has an unexpected structure. The integration may need updating.');
  const query = provider?.trim().toLowerCase();
  const selected = roster.filter(row => !query || row.name.toLowerCase() === query || snapshot.reports.some(report => report.provider === row.name && report.label.toLowerCase() === query));
  if (!selected.length) throw new Error('Unknown provider. Call get_provider_quotas without a provider to list configured providers.');
  const now = Date.now();
  return {
    dashboardUrl: `${BASE}/#providers`, queriedAt: new Date(now).toISOString(),
    generatedAt: iso(snapshot.generatedAt),
    note: 'Uses the dashboard quota endpoint and its cache policy. queriedAt is not measurement time. Missing data does not mean zero usage. Balance-only rows do not have a meaningful used percentage. Percentages are used percentages. Pool aggregates and current-account quotas are separate.',
    providers: selected.map(row => {
      const report = snapshot.reports.find(item => item.provider === row.name);
      const result = { provider: row.name, label: report?.label ?? row.name, enabled: !row.disabled, status: report ? 'available' : 'unavailable_or_unsupported' };
      if (!report) return result;
      result.source = report.source;
      result.observed = report.observed === true;
      result.quota = projectQuota(report.quota, now);
      result.updatedAt = iso(report.updatedAt);
      if (report.aggregation) {
        const aggregate = report.aggregation;
        result.pool = pick(aggregate, ['kind', 'scope', 'presentation', 'includedAccounts', 'excludedAccounts', 'unknownPlanAccounts', 'missingQuotaAccounts', 'pausedAccounts', 'reauthAccounts', 'staleQuotaAccounts', 'partialWindowAccounts', 'incomplete']);
        for (const key of ['fiveHour', 'weekly', 'monthly']) {
          if (aggregate[key]) result.pool[key] = {
            ...pick(aggregate[key], ['usedPercent', 'includedAccounts', 'excludedAccounts', 'incomplete', 'nextRecoveryPercent']),
            updatedAt: iso(aggregate[key].updatedAt), nextRecoveryAt: iso(aggregate[key].nextRecoveryAt),
          };
        }
        if (aggregate.currentAccount) result.currentAccount = {
          ...pick(aggregate.currentAccount, ['isMain', 'plan']),
          quota: projectQuota(aggregate.currentAccount.quota, now),
        };
      }
      return result;
    }),
  };
}
