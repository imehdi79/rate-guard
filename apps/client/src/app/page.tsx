'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import styles from './page.module.css';

const POLL_INTERVAL_MS = 5_000;

interface TenantSummary {
  id: string;
  name: string;
  created_at: string;
  quotaConfigs: { max_requests: number; window_seconds: number } | null;
}

interface TenantStats {
  tenantId: string;
  name: string;
  quota: { max_requests: number; window_seconds: number; configured: boolean };
  usage: { current: number; remaining: number };
  violations: {
    last_24h: number;
    recent: {
      id: string;
      request_id: string;
      path: string;
      created_at: string;
    }[];
  };
}

export default function Dashboard() {
  const [tenants, setTenants] = useState<TenantSummary[] | null>(null);
  const [selectedId, setSelectedId] = useState('');
  const [stats, setStats] = useState<TenantStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Inline quota editing.
  const [editing, setEditing] = useState(false);
  const [draftLimit, setDraftLimit] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/admin/tenants')
      .then(async (res) => {
        if (!res.ok) throw new Error(`tenant list failed (${res.status})`);
        return (await res.json()) as TenantSummary[];
      })
      .then((list) => {
        if (cancelled) return;
        setTenants(list);
        if (list.length > 0) setSelectedId((id) => id || list[0].id);
      })
      .catch((err) => {
        if (!cancelled) {
          setTenants([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadStats = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await fetch(`/api/admin/tenants/${selectedId}/stats`);
      if (!res.ok) throw new Error(`stats failed (${res.status})`);
      const data = (await res.json()) as TenantStats;
      // A slow response for a previously selected tenant must not clobber
      // the current one.
      if (data.tenantId !== selectedId) return;
      setStats(data);
      setUpdatedAt(new Date());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    setStats(null);
    setEditing(false);
    setSaveError(null);
    loadStats();
    const timer = setInterval(loadStats, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [selectedId, loadStats]);

  const startEditing = () => {
    if (!stats) return;
    setDraftLimit(String(stats.quota.max_requests));
    setSaveError(null);
    setEditing(true);
  };

  const cancelEditing = () => {
    setEditing(false);
    setSaveError(null);
  };

  const saveLimit = async (e: FormEvent) => {
    e.preventDefault();
    if (!stats) return;
    const max = Number(draftLimit);
    if (!Number.isInteger(max) || max <= 0) {
      setSaveError('limit must be a positive integer');
      return;
    }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/admin/tenants/${stats.tenantId}/quota`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          max_requests: max,
          window_seconds: stats.quota.window_seconds,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.message ?? `save failed (${res.status})`);
      }
      // Show the saved limit immediately; the follow-up fetch and the poll
      // keep the usage numbers authoritative.
      setStats((prev) =>
        prev && {
          ...prev,
          quota: {
            max_requests: data.max_requests,
            window_seconds: data.window_seconds,
            configured: data.configured,
          },
          usage: {
            ...prev.usage,
            remaining: Math.max(0, data.max_requests - prev.usage.current),
          },
        },
      );
      setEditing(false);
      loadStats();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const usagePct = stats
    ? Math.min(100, (stats.usage.current / stats.quota.max_requests) * 100)
    : 0;
  const usageLevel =
    usagePct >= 85 ? 'critical' : usagePct >= 60 ? 'warn' : 'ok';

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1 className={styles.title}>rate-guard</h1>
          <p className={styles.subtitle}>tenant quota dashboard</p>
        </div>
        <label className={styles.selector}>
          Tenant
          <select
            value={selectedId}
            onChange={(e) => setSelectedId(e.target.value)}
            disabled={!tenants || tenants.length === 0}
          >
            {(tenants ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </header>

      {error && <div className={styles.error}>{error}</div>}

      {tenants && tenants.length === 0 && !error && (
        <div className={styles.empty}>
          No tenants yet — create one with{' '}
          <code>POST /api/admin/tenants</code>.
        </div>
      )}

      {stats && (
        <>
          <section className={styles.cards}>
            <article className={styles.card}>
              <h2>Quota usage</h2>
              <div className={styles.big}>
                {stats.usage.current}{' '}
                {editing ? (
                  // noValidate: saveLimit's own check reports errors in the
                  // card instead of native browser bubbles.
                  <form
                    className={styles.limitForm}
                    onSubmit={saveLimit}
                    noValidate
                  >
                    <span className={styles.dim}>/</span>
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      step={1}
                      value={draftLimit}
                      aria-label="max requests"
                      disabled={saving}
                      onChange={(e) => setDraftLimit(e.target.value)}
                      onKeyDown={(e) => e.key === 'Escape' && cancelEditing()}
                    />
                    <button type="submit" disabled={saving}>
                      {saving ? 'Saving…' : 'Save'}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEditing}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </form>
                ) : (
                  <button
                    type="button"
                    className={styles.limitButton}
                    title="Click to edit the limit"
                    onClick={startEditing}
                  >
                    / {stats.quota.max_requests}
                  </button>
                )}
              </div>
              {saveError && <p className={styles.saveError}>{saveError}</p>}
              <div className={styles.barTrack}>
                <div
                  className={`${styles.barFill} ${styles[usageLevel]}`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
              <p className={styles.meta}>
                {stats.usage.remaining} remaining in a{' '}
                {stats.quota.window_seconds}s window
                {stats.quota.configured ? '' : ' (default quota)'}
              </p>
            </article>

            <article className={styles.card}>
              <h2>Violations · last 24h</h2>
              <p className={styles.big}>{stats.violations.last_24h}</p>
              <p className={styles.meta}>requests denied with 429</p>
            </article>
          </section>

          <section className={styles.card}>
            <h2>Recent violations</h2>
            {stats.violations.recent.length === 0 ? (
              <p className={styles.meta}>None recorded.</p>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Time</th>
                    <th>Path</th>
                    <th>Request id</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.violations.recent.map((v) => (
                    <tr key={v.id}>
                      <td>{new Date(v.created_at).toLocaleString()}</td>
                      <td>
                        <code>{v.path}</code>
                      </td>
                      <td>
                        <code>{v.request_id}</code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      )}

      <footer className={styles.footer}>
        {updatedAt
          ? `updated ${updatedAt.toLocaleTimeString()} · `
          : ''}
        polling every {POLL_INTERVAL_MS / 1000}s
      </footer>
    </main>
  );
}
