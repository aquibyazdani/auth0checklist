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
      <div className="app-shell">
        <div className="loading-state">Loading Auth0 Config Tracker…</div>
      </div>
    );
  }

  const selectedInstance = selectedKey ? allInstanceList.find((i) => i.key === selectedKey) : null;

  return (
    <div className="app-shell">
      <Header view={view} onNavigate={setView} onExport={handleExport} />

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
          onClose={() => setView('dashboard')}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function Header({ view, onNavigate, onExport }) {
  return (
    <header className="app-header">
      <div className="app-title">
        <h1>Auth0 Config Tracker</h1>
        <p className="app-subtitle">Configuration checklist coverage across apps, tenants &amp; environments</p>
      </div>
      <nav className="app-nav">
        <button className={`nav-btn ${view === 'dashboard' ? 'active' : ''}`} onClick={() => onNavigate('dashboard')}>
          Dashboard
        </button>
        <button className={`nav-btn ${view === 'settings' ? 'active' : ''}`} onClick={() => onNavigate('settings')}>
          Manage Config
        </button>
        <button className="btn-primary" onClick={onExport}>
          Export JSON
        </button>
      </nav>
    </header>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard({ instanceList, instances, items, apps, tenants, envs, filters, setFilters, onSelectInstance }) {
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

  const filtersActive = filters.app !== 'all' || filters.tenant !== 'all' || filters.env !== 'all' || filters.incompleteOnly;

  return (
    <div className="dashboard">
      <div className="summary-bar">
        <div className="summary-stat">
          <span className="summary-value">{overallPercent}%</span>
          <span className="summary-label">Overall completion</span>
        </div>
        <div className="summary-stat">
          <span className="summary-value">{instanceList.length}</span>
          <span className="summary-label">Instances tracked</span>
        </div>
        <div className="summary-stat">
          <span className="summary-value">{verifiedCount}</span>
          <span className="summary-label">Fully verified</span>
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

      <div className="grid-scroll">
        <table className="grid-table">
          <thead>
            <tr>
              <th className="sticky-col">Instance</th>
              <th>Status</th>
              {items.map((item) => (
                <th key={item.id} title={item.label} className="item-col">
                  {item.label}
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
                    <span className="instance-meta">
                      {inst.tenant} / {inst.env}
                    </span>
                  </td>
                  <td>
                    <span className={`status-pill status-${status}`}>{STATUS_LABEL[status]}</span>
                  </td>
                  {items.map((item) => {
                    const itemState = state?.items?.[item.id];
                    return (
                      <td key={item.id} className="cell-status" title={itemState?.note || ''}>
                        {itemState?.checked ? (
                          <span className="cell-check" aria-label="checked">
                            ✓
                          </span>
                        ) : (
                          <span className="cell-empty" aria-label="unchecked">
                            –
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="cell-percent">
                    <div className="percent-bar-wrap">
                      <div className="percent-bar" style={{ width: `${stats.percent}%` }} />
                    </div>
                    <span>{stats.percent}%</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
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
      <button className="btn-plain back-link" onClick={onBack}>
        ← Back to dashboard
      </button>

      <div className="detail-header">
        <div>
          <h2>
            {instance.app} / {instance.tenant} / {instance.env}
          </h2>
          <span className={`status-pill status-${status}`}>{STATUS_LABEL[status]}</span>
        </div>
        <div className="detail-header-right">
          <div className="percent-bar-wrap large">
            <div className="percent-bar" style={{ width: `${stats.percent}%` }} />
          </div>
          <span className="percent-text">
            {stats.checked} / {stats.total} verified ({stats.percent}%)
          </span>
        </div>
      </div>

      {items.length === 0 && (
        <p className="empty-row">No checklist items configured yet. Add some from Manage Config.</p>
      )}

      <div className="checklist">
        {items.map((item) => {
          const itemState = instanceState.items?.[item.id] || emptyItemState();
          return (
            <div key={item.id} className={`checklist-item ${itemState.checked ? 'checked' : ''}`}>
              <label className="checklist-item-check">
                <input
                  type="checkbox"
                  checked={!!itemState.checked}
                  onChange={(e) => onFieldChange(item.id, 'checked', e.target.checked)}
                />
                <span>{item.label}</span>
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
  onClose,
}) {
  return (
    <div className="settings-view">
      <button className="btn-plain back-link" onClick={onClose}>
        ← Back to dashboard
      </button>
      <h2>Manage configuration</h2>

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
    <div className="dimension-editor">
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
    <div className="checklist-item-editor">
      <h3>Checklist items</h3>
      <p className="settings-hint">These apply to every app × tenant × environment instance.</p>
      <ul className="item-list">
        {items.map((item) => (
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
                <span>{item.label}</span>
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
