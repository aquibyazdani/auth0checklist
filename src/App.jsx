import { useEffect, useMemo, useState, useCallback } from 'react';
import './App.css';

// ---------------------------------------------------------------------------
// Storage layer — localStorage wrapper exposing a get/set/list/delete surface.
// ---------------------------------------------------------------------------

const STORAGE_KEYS = {
  apps: 'config:apps',
  tenants: 'config:tenants',
  envs: 'config:envs',
  items: 'config:checklist-items',
  lastVerifier: 'config:last-verifier',
};

const INSTANCE_PREFIX = 'instance:';

const storage = {
  get(key, fallback = null) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (err) {
      console.error(`storage.get failed for "${key}"`, err);
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (err) {
      console.error(`storage.set failed for "${key}"`, err);
      return false;
    }
  },
  list(prefix = '') {
    try {
      const keys = [];
      for (let i = 0; i < window.localStorage.length; i++) {
        const key = window.localStorage.key(i);
        if (key && key.startsWith(prefix)) keys.push(key);
      }
      return keys;
    } catch (err) {
      console.error(`storage.list failed for prefix "${prefix}"`, err);
      return [];
    }
  },
  delete(key) {
    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (err) {
      console.error(`storage.delete failed for "${key}"`, err);
      return false;
    }
  },
};

// ---------------------------------------------------------------------------
// Defaults & helpers
// ---------------------------------------------------------------------------

const DEFAULT_APPS = ['intake', 'fileonline', 'webfile'];
const DEFAULT_TENANTS = ['adrorg', 'nysi'];
const DEFAULT_ENVS = ['dev', 'uat'];

const DEFAULT_ITEMS = [
  { id: 'callback-urls', label: 'Callback URLs configured correctly' },
  { id: 'logout-urls', label: 'Allowed Logout URLs configured' },
  { id: 'web-origins', label: 'Allowed Web Origins (CORS) configured' },
  { id: 'silent-auth-cors', label: 'Allowed Origins (CORS) for silent auth / SPA SDK' },
  { id: 'post-password-redirect', label: '"Back to login" / post-password-change redirect URL set' },
  { id: 'connection-scope', label: 'Correct connection enabled for this tenant (no cross-tenant leakage)' },
  { id: 'grant-types', label: 'Client grant types correct' },
  { id: 'token-expiration', label: 'Token expiration / refresh token rotation settings match environment' },
  { id: 'custom-rules', label: 'Any custom rules/actions specific to this app-tenant combo verified' },
];

function slugify(text) {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
  return base || `item-${Date.now()}`;
}

function instanceKey(app, tenant, env) {
  return `${INSTANCE_PREFIX}${app}-${tenant}-${env}`;
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function emptyItemState() {
  return { checked: false, note: '', verifiedBy: '', verifiedOn: '' };
}

function emptyInstanceState() {
  return { items: {} };
}

function getInstanceStats(instanceState, items) {
  const total = items.length;
  if (total === 0) return { checked: 0, total: 0, percent: 0 };
  let checked = 0;
  for (const item of items) {
    if (instanceState?.items?.[item.id]?.checked) checked += 1;
  }
  return { checked, total, percent: Math.round((checked / total) * 100) };
}

function getInstanceStatus(stats) {
  if (stats.total === 0 || stats.checked === 0) return 'not-started';
  if (stats.checked === stats.total) return 'complete';
  return 'in-progress';
}

const STATUS_LABEL = {
  'not-started': 'Not started',
  'in-progress': 'In progress',
  complete: 'Verified',
};

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Icons — small inline SVGs, no external icon library
// ---------------------------------------------------------------------------

const Icon = {
  grid: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  gear: (props) => (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.04.04a2 2 0 1 1-2.83 2.83l-.04-.04a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.04.04a2 2 0 1 1-2.83-2.83l.04-.04A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.04-.04a2 2 0 1 1 2.83-2.83l.04.04A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.04-.04a2 2 0 1 1 2.83 2.83l-.04.04A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
    </svg>
  ),
  download: (props) => (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M12 3v12" />
      <path d="M7 10l5 5 5-5" />
      <path d="M4 19h16" />
    </svg>
  ),
  arrowLeft: (props) => (
    <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M19 12H5" />
      <path d="M11 18l-6-6 6-6" />
    </svg>
  ),
  check: (props) => (
    <svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  ),
};

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [apps, setApps] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [envs, setEnvs] = useState([]);
  const [items, setItems] = useState([]);
  const [instances, setInstances] = useState({});
  const [view, setView] = useState('dashboard'); // 'dashboard' | 'detail' | 'settings'
  const [selectedKey, setSelectedKey] = useState(null);
  const [filters, setFilters] = useState({ app: 'all', tenant: 'all', env: 'all', incompleteOnly: false });

  useEffect(() => {
    try {
      const loadedApps = storage.get(STORAGE_KEYS.apps, DEFAULT_APPS);
      const loadedTenants = storage.get(STORAGE_KEYS.tenants, DEFAULT_TENANTS);
      const loadedEnvs = storage.get(STORAGE_KEYS.envs, DEFAULT_ENVS);
      const loadedItems = storage.get(STORAGE_KEYS.items, DEFAULT_ITEMS);

      storage.set(STORAGE_KEYS.apps, loadedApps);
      storage.set(STORAGE_KEYS.tenants, loadedTenants);
      storage.set(STORAGE_KEYS.envs, loadedEnvs);
      storage.set(STORAGE_KEYS.items, loadedItems);

      setApps(loadedApps);
      setTenants(loadedTenants);
      setEnvs(loadedEnvs);
      setItems(loadedItems);

      const instanceMap = {};
      for (const app of loadedApps) {
        for (const tenant of loadedTenants) {
          for (const env of loadedEnvs) {
            const key = instanceKey(app, tenant, env);
            instanceMap[key] = storage.get(key, emptyInstanceState());
          }
        }
      }
      setInstances(instanceMap);
    } catch (err) {
      console.error('Failed to load tracker data', err);
      setError('Failed to load saved data from local storage. Starting with defaults.');
      setApps(DEFAULT_APPS);
      setTenants(DEFAULT_TENANTS);
      setEnvs(DEFAULT_ENVS);
      setItems(DEFAULT_ITEMS);
      setInstances({});
    } finally {
      setLoading(false);
    }
  }, []);

  const allInstanceList = useMemo(() => {
    const list = [];
    for (const app of apps) {
      for (const tenant of tenants) {
        for (const env of envs) {
          list.push({ app, tenant, env, key: instanceKey(app, tenant, env) });
        }
      }
    }
    return list;
  }, [apps, tenants, envs]);

  // Backfill instance entries when a new app/tenant/env is added.
  useEffect(() => {
    setInstances((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const { key } of allInstanceList) {
        if (!next[key]) {
          next[key] = emptyInstanceState();
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allInstanceList]);

  const updateItemField = useCallback(
    (key, itemId, field, value) => {
      const current = instances[key] || emptyInstanceState();
      const currentItem = current.items[itemId] || emptyItemState();
      const nextItem = { ...currentItem, [field]: value };

      if (field === 'checked' && value === true) {
        nextItem.verifiedOn = todayISO();
        if (!nextItem.verifiedBy) {
          const lastVerifier = storage.get(STORAGE_KEYS.lastVerifier, '');
          if (lastVerifier) nextItem.verifiedBy = lastVerifier;
        }
      }
      if (field === 'verifiedBy' && value) {
        storage.set(STORAGE_KEYS.lastVerifier, value);
      }

      const nextState = { ...current, items: { ...current.items, [itemId]: nextItem } };
      setInstances((prev) => ({ ...prev, [key]: nextState }));
      const ok = storage.set(key, nextState);
      if (!ok) setError(`Failed to save changes for ${key.replace(INSTANCE_PREFIX, '')}.`);
    },
    [instances]
  );

  const resetInstance = useCallback((key) => {
    const fresh = emptyInstanceState();
    setInstances((prev) => ({ ...prev, [key]: fresh }));
    const ok = storage.set(key, fresh);
    if (!ok) setError(`Failed to reset ${key.replace(INSTANCE_PREFIX, '')}.`);
  }, []);

  const saveConfigList = (storageKey, list, setter) => {
    setter(list);
    const ok = storage.set(storageKey, list);
    if (!ok) setError('Failed to save configuration change.');
  };

  const addDimension = (kind) => (value) => {
    const trimmed = value.trim();
    if (!trimmed) return;
    if (kind === 'app' && !apps.includes(trimmed)) saveConfigList(STORAGE_KEYS.apps, [...apps, trimmed], setApps);
    else if (kind === 'tenant' && !tenants.includes(trimmed))
      saveConfigList(STORAGE_KEYS.tenants, [...tenants, trimmed], setTenants);
    else if (kind === 'env' && !envs.includes(trimmed)) saveConfigList(STORAGE_KEYS.envs, [...envs, trimmed], setEnvs);
  };

  const removeDimension = (kind) => (value) => {
    if (kind === 'app') saveConfigList(STORAGE_KEYS.apps, apps.filter((a) => a !== value), setApps);
    else if (kind === 'tenant') saveConfigList(STORAGE_KEYS.tenants, tenants.filter((t) => t !== value), setTenants);
    else if (kind === 'env') saveConfigList(STORAGE_KEYS.envs, envs.filter((e) => e !== value), setEnvs);
  };

  const addChecklistItem = (label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    let id = slugify(trimmed);
    let suffix = 2;
    while (items.some((i) => i.id === id)) {
      id = `${slugify(trimmed)}-${suffix}`;
      suffix += 1;
    }
    saveConfigList(STORAGE_KEYS.items, [...items, { id, label: trimmed }], setItems);
  };

  const editChecklistItem = (id, label) => {
    const trimmed = label.trim();
    if (!trimmed) return;
    saveConfigList(
      STORAGE_KEYS.items,
      items.map((i) => (i.id === id ? { ...i, label: trimmed } : i)),
      setItems
    );
  };

  const removeChecklistItem = (id) => {
    saveConfigList(STORAGE_KEYS.items, items.filter((i) => i.id !== id), setItems);
  };

  const handleExport = () => {
    try {
      const exportData = {
        exportedAt: new Date().toISOString(),
        config: { apps, tenants, envs, checklistItems: items },
        instances: Object.fromEntries(
          allInstanceList.map(({ key, app, tenant, env }) => [key, { app, tenant, env, ...instances[key] }])
        ),
      };
      downloadJSON(exportData, `auth0-config-tracker-export-${todayISO()}.json`);
    } catch (err) {
      console.error('Export failed', err);
      setError('Failed to export data.');
    }
  };

  const openDetail = (key) => {
    setSelectedKey(key);
    setView('detail');
  };

  if (loading) {
    return (
      <div className="app-layout">
        <div className="loading-state">Loading Auth0 Config Tracker…</div>
      </div>
    );
  }

  const selectedInstance = selectedKey ? allInstanceList.find((i) => i.key === selectedKey) : null;

  return (
    <div className="app-layout">
      <Sidebar view={view} onNavigate={setView} />

      <main className="main-content">
        {error && (
          <div className="error-banner" role="alert">
            <span>{error}</span>
            <button className="btn-plain" onClick={() => setError('')}>
              Dismiss
            </button>
          </div>
        )}

        {view === 'dashboard' && (
          <Dashboard
            instanceList={allInstanceList}
            instances={instances}
            items={items}
            apps={apps}
            tenants={tenants}
            envs={envs}
            filters={filters}
            setFilters={setFilters}
            onSelectInstance={openDetail}
            onExport={handleExport}
          />
        )}

        {view === 'detail' && selectedInstance && (
          <DetailView
            instance={selectedInstance}
            items={items}
            instanceState={instances[selectedInstance.key] || emptyInstanceState()}
            onFieldChange={(itemId, field, value) => updateItemField(selectedInstance.key, itemId, field, value)}
            onReset={() => resetInstance(selectedInstance.key)}
            onBack={() => setView('dashboard')}
          />
        )}

        {view === 'settings' && (
          <SettingsPanel
            apps={apps}
            tenants={tenants}
            envs={envs}
            items={items}
            onAddDimension={addDimension}
            onRemoveDimension={removeDimension}
            onAddItem={addChecklistItem}
            onEditItem={editChecklistItem}
            onRemoveItem={removeChecklistItem}
            onBack={() => setView('dashboard')}
          />
        )}
      </main>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

function Sidebar({ view, onNavigate }) {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <span className="brand-mark">A0</span>
        <div className="brand-text">
          <div className="brand-title">Config Tracker</div>
          <div className="brand-subtitle">Auth0 multi-tenant</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <button className={`sidebar-link ${view === 'dashboard' ? 'active' : ''}`} onClick={() => onNavigate('dashboard')}>
          <Icon.grid />
          Dashboard
        </button>
        <button className={`sidebar-link ${view === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}>
          <Icon.gear />
          Manage Config
        </button>
      </nav>

      <div className="sidebar-footer">
        <p>Apps × Tenants × Envs are tracked as instances. Add new ones any time from Manage Config.</p>
      </div>
    </aside>
  );
}

// ---------------------------------------------------------------------------
// Shared page header
// ---------------------------------------------------------------------------

function PageHeader({ title, subtitle, actions, onBack, backLabel }) {
  return (
    <div className="page-head">
      {onBack && (
        <button className="breadcrumb-back" onClick={onBack}>
          <Icon.arrowLeft />
          {backLabel || 'Back'}
        </button>
      )}
      <div className="page-head-row">
        <div>
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="page-subtitle">{subtitle}</p>}
        </div>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({ instanceList, instances, items, apps, tenants, envs, filters, setFilters, onSelectInstance, onExport }) {
  const filtered = instanceList.filter((inst) => {
    if (filters.app !== 'all' && inst.app !== filters.app) return false;
    if (filters.tenant !== 'all' && inst.tenant !== filters.tenant) return false;
    if (filters.env !== 'all' && inst.env !== filters.env) return false;
    if (filters.incompleteOnly) {
      const stats = getInstanceStats(instances[inst.key], items);
      if (getInstanceStatus(stats) === 'complete') return false;
    }
    return true;
  });

  const overallStats = instanceList.reduce(
    (acc, inst) => {
      const stats = getInstanceStats(instances[inst.key], items);
      acc.checked += stats.checked;
      acc.total += stats.total;
      return acc;
    },
    { checked: 0, total: 0 }
  );
  const overallPercent = overallStats.total ? Math.round((overallStats.checked / overallStats.total) * 100) : 0;
  const verifiedCount = instanceList.filter(
    (inst) => getInstanceStatus(getInstanceStats(instances[inst.key], items)) === 'complete'
  ).length;
  const inProgressCount = instanceList.filter(
    (inst) => getInstanceStatus(getInstanceStats(instances[inst.key], items)) === 'in-progress'
  ).length;

  const filtersActive = filters.app !== 'all' || filters.tenant !== 'all' || filters.env !== 'all' || filters.incompleteOnly;

  return (
    <div className="dashboard">
      <PageHeader
        title="Dashboard"
        subtitle="Configuration checklist coverage across every app, tenant, and environment."
        actions={
          <button className="btn-primary" onClick={onExport}>
            <Icon.download />
            Export JSON
          </button>
        }
      />

      <div className="summary-bar">
        <div className="summary-stat accent-teal">
          <span className="summary-value">{overallPercent}%</span>
          <span className="summary-label">Overall completion</span>
        </div>
        <div className="summary-stat">
          <span className="summary-value">{instanceList.length}</span>
          <span className="summary-label">Instances tracked</span>
        </div>
        <div className="summary-stat accent-success">
          <span className="summary-value">{verifiedCount}</span>
          <span className="summary-label">Fully verified</span>
        </div>
        <div className="summary-stat accent-warning">
          <span className="summary-value">{inProgressCount}</span>
          <span className="summary-label">In progress</span>
        </div>
        <div className="summary-stat">
          <span className="summary-value">{items.length}</span>
          <span className="summary-label">Checklist items</span>
        </div>
      </div>

      <div className="filter-bar">
        <label>
          App
          <select value={filters.app} onChange={(e) => setFilters((f) => ({ ...f, app: e.target.value }))}>
            <option value="all">All</option>
            {apps.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tenant
          <select value={filters.tenant} onChange={(e) => setFilters((f) => ({ ...f, tenant: e.target.value }))}>
            <option value="all">All</option>
            {tenants.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label>
          Env
          <select value={filters.env} onChange={(e) => setFilters((f) => ({ ...f, env: e.target.value }))}>
            <option value="all">All</option>
            {envs.map((e) => (
              <option key={e} value={e}>
                {e}
              </option>
            ))}
          </select>
        </label>
        <label className="checkbox-label">
          <input
            type="checkbox"
            checked={filters.incompleteOnly}
            onChange={(e) => setFilters((f) => ({ ...f, incompleteOnly: e.target.checked }))}
          />
          Show only incomplete
        </label>
        {filtersActive && (
          <button
            className="btn-plain"
            onClick={() => setFilters({ app: 'all', tenant: 'all', env: 'all', incompleteOnly: false })}
          >
            Clear filters
          </button>
        )}
      </div>

      <div className="grid-card">
        <div className="grid-scroll">
          <table className="grid-table">
            <thead>
              <tr>
                <th className="sticky-col">Instance</th>
                <th>Status</th>
                {items.map((item, idx) => (
                  <th key={item.id} title={item.label} className="item-col">
                    {idx + 1}
                  </th>
                ))}
                <th>Completion</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={items.length + 3} className="empty-row">
                    No instances match the current filters.
                  </td>
                </tr>
              )}
              {filtered.map((inst) => {
                const state = instances[inst.key];
                const stats = getInstanceStats(state, items);
                const status = getInstanceStatus(stats);
                return (
                  <tr key={inst.key} className="grid-row" onClick={() => onSelectInstance(inst.key)}>
                    <td className="sticky-col instance-cell">
                      <span className="instance-label">{inst.app}</span>
                      <span className="instance-badges">
                        <span className="tag">{inst.tenant}</span>
                        <span className="tag tag-env">{inst.env}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill status-${status}`}>{STATUS_LABEL[status]}</span>
                    </td>
                    {items.map((item) => {
                      const itemState = state?.items?.[item.id];
                      const checked = !!itemState?.checked;
                      return (
                        <td key={item.id} className="cell-status" title={`${item.label}${itemState?.note ? ` — ${itemState.note}` : ''}`}>
                          <span className={`status-dot ${checked ? 'status-dot-on' : ''}`}>
                            {checked && <Icon.check />}
                          </span>
                        </td>
                      );
                    })}
                    <td className="cell-percent">
                      <div className="percent-bar-wrap">
                        <div className="percent-bar" style={{ width: `${stats.percent}%` }} />
                      </div>
                      <span className="percent-text-sm">{stats.percent}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {items.length > 0 && (
        <div className="legend-card">
          <h3>Checklist item key</h3>
          <ol className="legend-list">
            {items.map((item, idx) => (
              <li key={item.id}>
                <span className="legend-num">{idx + 1}</span>
                {item.label}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail view
// ---------------------------------------------------------------------------

function DetailView({ instance, items, instanceState, onFieldChange, onReset, onBack }) {
  const stats = getInstanceStats(instanceState, items);
  const status = getInstanceStatus(stats);
  const [confirmingReset, setConfirmingReset] = useState(false);

  return (
    <div className="detail-view">
      <PageHeader
        onBack={onBack}
        backLabel="Dashboard"
        title={`${instance.app} / ${instance.tenant} / ${instance.env}`}
        subtitle={
          <>
            <span className={`status-pill status-${status}`}>{STATUS_LABEL[status]}</span>
            <span className="detail-progress-text">
              {stats.checked} of {stats.total} items verified ({stats.percent}%)
            </span>
          </>
        }
        actions={
          <div className="percent-bar-wrap large">
            <div className="percent-bar" style={{ width: `${stats.percent}%` }} />
          </div>
        }
      />

      {items.length === 0 && (
        <p className="empty-row">No checklist items configured yet. Add some from Manage Config.</p>
      )}

      <div className="checklist">
        {items.map((item) => {
          const itemState = instanceState.items?.[item.id] || emptyItemState();
          return (
            <div key={item.id} className={`checklist-item ${itemState.checked ? 'checked' : ''}`}>
              <label className="checklist-item-check">
                <span className={`custom-checkbox ${itemState.checked ? 'on' : ''}`}>
                  {itemState.checked && <Icon.check />}
                </span>
                <input
                  type="checkbox"
                  checked={!!itemState.checked}
                  onChange={(e) => onFieldChange(item.id, 'checked', e.target.checked)}
                />
                <span className="checklist-item-label">{item.label}</span>
              </label>
              <div className="checklist-item-fields">
                <label className="field">
                  <span className="field-label">Note / actual value</span>
                  <input
                    type="text"
                    placeholder="e.g. actual callback URL, or details"
                    value={itemState.note}
                    onChange={(e) => onFieldChange(item.id, 'note', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Verified by</span>
                  <input
                    type="text"
                    placeholder="Name"
                    value={itemState.verifiedBy}
                    onChange={(e) => onFieldChange(item.id, 'verifiedBy', e.target.value)}
                  />
                </label>
                <label className="field">
                  <span className="field-label">Verified on</span>
                  <input
                    type="date"
                    value={itemState.verifiedOn}
                    onChange={(e) => onFieldChange(item.id, 'verifiedOn', e.target.value)}
                  />
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="detail-footer">
        {confirmingReset ? (
          <div className="confirm-reset">
            <span>Clear all checklist state for this instance? This cannot be undone.</span>
            <button
              className="btn-danger"
              onClick={() => {
                onReset();
                setConfirmingReset(false);
              }}
            >
              Confirm reset
            </button>
            <button className="btn-plain" onClick={() => setConfirmingReset(false)}>
              Cancel
            </button>
          </div>
        ) : (
          <button className="btn-danger-outline" onClick={() => setConfirmingReset(true)}>
            Reset this instance's checklist
          </button>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function SettingsPanel({
  apps,
  tenants,
  envs,
  items,
  onAddDimension,
  onRemoveDimension,
  onAddItem,
  onEditItem,
  onRemoveItem,
  onBack,
}) {
  return (
    <div className="settings-view">
      <PageHeader onBack={onBack} backLabel="Dashboard" title="Manage configuration" subtitle="Add apps, tenants, or environments, and edit the checklist items applied to every instance." />

      <div className="settings-grid">
        <DimensionEditor title="Apps" values={apps} onAdd={onAddDimension('app')} onRemove={onRemoveDimension('app')} placeholder="e.g. mycase" />
        <DimensionEditor
          title="Tenants"
          values={tenants}
          onAdd={onAddDimension('tenant')}
          onRemove={onRemoveDimension('tenant')}
          placeholder="e.g. thirdorg"
        />
        <DimensionEditor
          title="Environments"
          values={envs}
          onAdd={onAddDimension('env')}
          onRemove={onRemoveDimension('env')}
          placeholder="e.g. staging"
        />
      </div>

      <ChecklistItemEditor items={items} onAdd={onAddItem} onEdit={onEditItem} onRemove={onRemoveItem} />
    </div>
  );
}

function DimensionEditor({ title, values, onAdd, onRemove, placeholder }) {
  const [value, setValue] = useState('');
  const submit = (e) => {
    e.preventDefault();
    onAdd(value);
    setValue('');
  };
  return (
    <div className="settings-card">
      <h3>{title}</h3>
      <ul className="dimension-list">
        {values.map((v) => (
          <li key={v}>
            <span>{v}</span>
            <button className="btn-remove" onClick={() => onRemove(v)} aria-label={`Remove ${v}`}>
              ×
            </button>
          </li>
        ))}
        {values.length === 0 && <li className="dimension-empty">None yet</li>}
      </ul>
      <form onSubmit={submit} className="dimension-form">
        <input type="text" value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} />
        <button type="submit" className="btn-secondary">
          Add
        </button>
      </form>
    </div>
  );
}

function ChecklistItemEditor({ items, onAdd, onEdit, onRemove }) {
  const [newLabel, setNewLabel] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editingLabel, setEditingLabel] = useState('');

  const submitNew = (e) => {
    e.preventDefault();
    onAdd(newLabel);
    setNewLabel('');
  };

  const startEdit = (item) => {
    setEditingId(item.id);
    setEditingLabel(item.label);
  };

  const submitEdit = (e) => {
    e.preventDefault();
    onEdit(editingId, editingLabel);
    setEditingId(null);
    setEditingLabel('');
  };

  return (
    <div className="settings-card checklist-item-editor">
      <h3>Checklist items</h3>
      <p className="settings-hint">These apply to every app × tenant × environment instance.</p>
      <ul className="item-list">
        {items.map((item, idx) => (
          <li key={item.id}>
            {editingId === item.id ? (
              <form onSubmit={submitEdit} className="item-edit-form">
                <input type="text" value={editingLabel} onChange={(e) => setEditingLabel(e.target.value)} autoFocus />
                <button type="submit" className="btn-secondary">
                  Save
                </button>
                <button type="button" className="btn-plain" onClick={() => setEditingId(null)}>
                  Cancel
                </button>
              </form>
            ) : (
              <>
                <span className="item-list-label">
                  <span className="legend-num">{idx + 1}</span>
                  {item.label}
                </span>
                <span className="item-actions">
                  <button className="btn-plain" onClick={() => startEdit(item)}>
                    Edit
                  </button>
                  <button className="btn-remove" onClick={() => onRemove(item.id)} aria-label={`Remove ${item.label}`}>
                    ×
                  </button>
                </span>
              </>
            )}
          </li>
        ))}
        {items.length === 0 && <li className="dimension-empty">No checklist items yet</li>}
      </ul>
      <form onSubmit={submitNew} className="dimension-form">
        <input type="text" value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New checklist item label" />
        <button type="submit" className="btn-secondary">
          Add item
        </button>
      </form>
    </div>
  );
}
