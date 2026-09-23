'use client';
import React, { useState, useEffect, useCallback } from 'react';
import { useNav, TopNav } from './navigation';
import { Plus, Key, ChevronRight, Check, X, Search, List, Grid3X3, CheckCircle2, Upload, AlertTriangle } from './icons';
import { CsvImportModal } from './csv-import';
import { DataTable, ColDef, usePersistedView } from './data-table';
import { useToast } from './ui-shared';
import { apiClient } from '@/lib/request';
import { StatusTimeline } from './status-timeline';
import { parseMoneyToCents, formatMoney, centsToMajor } from '@/lib/money';
import { PageHeader, Kpi } from '@/components/ui-kit/page-header';
import { Chips, Segmented } from '@/components/ui-kit/segmented';
import { Badge } from '@/components/ui-kit/badge';
import { Avatar } from '@/components/ui-kit/avatar';
import { Button } from '@/components/ui-kit/button';
import { Input } from '@/components/ui-kit/input';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { Kv } from '@/components/ui-kit/inspector';
import { Select } from '@/components/ui-kit/select';
import { cn } from '@/lib/utils';

// ── People screen — redesigned onto the reference's avatar-led roster list
// (ui/governance-reference-redesign), same backend as before (GET/POST
// /api/employees). Hero: the crew roster — role, status, phone and assigned
// batches at a glance. Per-employee permission overrides, payroll history
// and worker PIN provisioning are unchanged and stay inside
// PeopleDetailScreen (see docs/ui-migration-map.md §2 People).

// ── Real API shapes (issue #248 — wired to GET/POST /api/employees,
// GET/PATCH /api/employees/[id], GET/PUT /api/role-permissions from #247/#243).
// Replaces the old EMPLOYEES_DATA/OWNER_ROLES mock entirely on this screen.
// `monthlySalaryCents` (payroll-and-gps task): the pay basis payroll runs
// read from — see db/schemas/people.ts for why it's a flat monthly rate, not
// a wage. Login PIN provisioning is still a separate auth concern this
// screen doesn't build.
interface ApiEmployee {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  phone: string;
  role: string;
  monthlySalaryCents: number;
  assignedBatchIds: string[];
  mortalityPhotoThreshold: number;
  status: string;
  createdAt: string | null;
  farmId: string | null; // farm-scoped-data task (migration 0019)
}

// GET /api/payroll/payslips?employeeId= (payroll-and-gps task) — one
// employee's pay history across every run, for the per-employee Payroll tab
// below.
interface ApiPayslip {
  id: string;
  amountCents: number;
  periodStart: string;
  periodEnd: string;
}

interface ApiBatchLite {
  id: string;
  code: string;
  name: string;
}

type Access = 'hidden' | 'view' | 'edit';
interface RoleMatrixEntry {
  role: string;
  permissions: Record<string, Access>;
  approvalRequired: string[];
}

const FALLBACK_ROLES = ['manager', 'worker', 'vet', 'harvest_lead'];

function roleLabel(roleId: string) {
  return roleId.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function getRoleColor(roleId: string) {
  const colors: Record<string, string> = {
    manager: 'var(--accent-purple)', worker: 'var(--primary-green)',
    vet: 'var(--accent-cyan)', harvest_lead: 'var(--accent-amber)',
    owner: 'var(--accent-amber)', auditor: 'var(--accent-blue)',
  };
  return colors[roleId] ?? 'var(--text-muted)';
}
function getRoleBadge(roleId: string) {
  const badges: Record<string, string> = {
    manager: 'chip-purple', worker: 'chip-ok',
    vet: 'chip-cyan', harvest_lead: 'chip-warning',
    owner: 'chip-warning', auditor: 'chip-info',
  };
  return badges[roleId] ?? 'chip-info';
}

function initials(name: string) {
  return name.split(' ').filter(Boolean).map((n) => n[0]).join('').slice(0, 2) || '?';
}

function fmtDate(iso: string): string {
  return iso.slice(0, 10);
}

/* Column definitions for the table view */
const PEOPLE_COLS: ColDef<Record<string, unknown>>[] = [
  {
    key: 'name', header: 'Name', sortable: true, minWidth: 140,
    summary: () => <span style={{ fontWeight: 700, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>TOTALS</span>,
    render: (r) => (
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
          background: `${getRoleColor(r.role as string)}20`,
          border: `1px solid ${getRoleColor(r.role as string)}40`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 'var(--fs-xs)', fontWeight: 700, color: getRoleColor(r.role as string),
        }}>
          {initials(r.name as string)}
        </div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{r.name as string}</div>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', fontFamily: 'monospace' }}>{(r.id as string).slice(0, 8)}</div>
        </div>
      </div>
    ),
  },
  {
    key: 'role', header: 'Role', sortable: true, minWidth: 90,
    render: (r) => <span className={`chip ${getRoleBadge(r.role as string)}`} style={{ fontSize: 'var(--fs-2xs)' }}>{roleLabel(r.role as string)}</span>,
  },
  { key: 'phone', header: 'Phone', minWidth: 120, render: (r) => <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>{(r.phone as string) || '—'}</span> },
  {
    key: 'batchCount', header: 'Batches', align: 'center', minWidth: 80,
    summary: 'sum',
    render: (r) => <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600 }}>{((r.assignedBatchIds as string[]) ?? []).length}</span>,
  },
  {
    key: 'active', header: 'Status', align: 'center', minWidth: 70,
    summary: 'count',
    render: (r) => <span className={`chip ${r.status === 'ACTIVE' ? 'chip-ok' : 'chip-info'}`} style={{ fontSize: 'var(--fs-2xs)' }}>{r.status as string}</span>,
  },
];

export function PeopleScreen() {
  const { navigate, tenantId, activeFarmId, farms } = useNav();
  const [filter, setFilter] = useState('All');
  // Status filter (farms/employees CRUD task) — the summary strip above
  // already counted Active/Inactive, but nothing let an admin actually see
  // just the inactive ones; deactivated staff must stay findable, not
  // silently disappear.
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');
  const [search, setSearch] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [employees, setEmployees] = useState<ApiEmployee[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [batches, setBatches] = useState<ApiBatchLite[]>([]);
  const [viewMode, setViewMode] = usePersistedView<'card' | 'table'>('people', 'card');
  // "On today" (additive, read-only): the tenant's own due-today tasks, same
  // GET /api/tasks?due=today endpoint dashboard.tsx already calls — grouped
  // client-side by assigneeId so the roster can honestly say what someone is
  // on today only where a task actually names them; nothing invented for
  // anyone task data doesn't link to.
  const [todayTasks, setTodayTasks] = useState<{ id: string; title: string; assigneeId: string | null; status: string }[]>([]);
  useEffect(() => {
    apiClient.get<{ id: string; title: string; assigneeId: string | null; status: string }[]>(
      `/api/tasks?tenantId=${tenantId}&farmId=${activeFarmId}&due=today`,
    ).then((res) => { if (res.success) setTodayTasks(res.data); });
  }, [tenantId, activeFarmId]);
  const onTodayFor = useCallback((employeeId: string) => {
    const mine = todayTasks.filter((t) => t.assigneeId === employeeId && t.status !== 'DONE' && t.status !== 'CANCELLED');
    if (mine.length === 0) return null;
    return mine.length === 1 ? mine[0].title : `${mine.length} tasks today`;
  }, [todayTasks]);

  // farm-scoped-data task: employees.farmId is a direct column
  // (migration 0019) — re-fetches when the active farm changes.
  const loadEmployees = useCallback(() => {
    apiClient.get<ApiEmployee[]>(`/api/employees?tenantId=${tenantId}&farmId=${activeFarmId}`).then((res) => {
      if (res.success) { setEmployees(res.data); setLoadError(''); }
      else setLoadError(res.error || 'Failed to load staff.');
    });
  }, [tenantId, activeFarmId]);

  useEffect(() => { loadEmployees(); }, [loadEmployees]);
  useEffect(() => {
    apiClient.get<ApiBatchLite[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      if (res.success) setBatches(res.data.map((b) => ({ id: b.id, code: (b as unknown as { code: string }).code, name: (b as unknown as { name: string }).name })));
    });
  }, [tenantId]);

  const batchLabel = useCallback((id: string) => batches.find((b) => b.id === id)?.code ?? id.slice(0, 8), [batches]);

  // CSV import (issue #248 task 6): loop real POST /api/employees calls per
  // row rather than a client-only merge — the imported rows become real
  // tenant employees, not local-only state that vanishes on refresh. Only
  // fields the backend actually stores are sent (name, phone, role, status,
  // assignedBatchIds resolved from batch codes) — salary/payday/pin columns
  // in the CSV template have no backend column (payroll/login are separate
  // epics) and are intentionally dropped, not fabricated.
  //
  // `farmCode` (farm-scoped-data task): employees.farmId now exists, so this
  // column is no longer dropped — resolved against the tenant's real farms
  // by code. A row whose code doesn't match any real farm, or that omits
  // the column, falls back to the currently active farm (or no farm at all
  // under 'ALL') rather than failing the whole import over one bad cell.
  const { showToast } = useToast();
  async function handleImportRows(rows: Record<string, string>[]) {
    let ok = 0;
    let failed = 0;
    for (const row of rows) {
      const batchCodes = row.batches ? row.batches.split('|').map((b) => b.trim()).filter(Boolean) : [];
      const assignedBatchIds = batchCodes
        .map((code) => batches.find((b) => b.code === code)?.id)
        .filter((id): id is string => !!id);
      const rowFarmId = row.farmCode ? farms.find((f) => f.code === row.farmCode.trim())?.id : undefined;
      const res = await apiClient.post<ApiEmployee>('/api/employees', {
        tenantId,
        name: row.name || 'Imported Employee',
        phone: row.phone || '',
        role: row.role || 'worker',
        status: row.active === 'false' ? 'INACTIVE' : 'ACTIVE',
        assignedBatchIds,
        farmId: rowFarmId ?? (activeFarmId !== 'ALL' ? activeFarmId : undefined),
      });
      if (res.success) ok += 1; else failed += 1;
    }
    loadEmployees();
    showToast(`${ok} employee${ok === 1 ? '' : 's'} imported${failed ? `, ${failed} failed` : ''}.`, failed ? 'warning' : 'success');
  }

  const list = employees ?? [];
  const roles = ['All', ...Array.from(new Set(list.map((e) => e.role)))];
  const filtered = list
    .filter((e) => filter === 'All' || e.role === filter)
    .filter((e) => statusFilter === 'All' || (statusFilter === 'Active' ? e.status === 'ACTIVE' : e.status !== 'ACTIVE'))
    .filter((e) => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q) || (e.phone || '').includes(q);
    });

  return (
    <div className="screen-content">
      <TopNav title="" />
      <div className="px-screen pt-3 pb-10">
        <PageHeader
          kicker="Farm"
          title="People"
          lede="Everyone on the roster — role, status and who to reach."
          actions={(
            <div className="flex items-center gap-2">
              <div className="flex overflow-hidden rounded-md shadow-(--shadow-border)">
                {(['card', 'table'] as const).map((m) => (
                  <button key={m} type="button" onClick={() => setViewMode(m)}
                    className={cn('flex size-9 items-center justify-center', viewMode === m ? 'bg-primary-soft text-primary' : 'bg-surface text-muted')}
                    title={m === 'card' ? 'Card view' : 'Table view'}>
                    {m === 'card' ? <Grid3X3 size={15} aria-hidden="true" /> : <List size={15} aria-hidden="true" />}
                  </button>
                ))}
              </div>
              <Button variant="secondary" size="icon-sm" onClick={() => setShowImport(true)} title="Import employees CSV" aria-label="Import employees CSV">
                <Upload size={14} />
              </Button>
              <Button onClick={() => setShowAdd(true)}><Plus size={14} /> Add person</Button>
            </div>
          )}
        />

        {/* Summary — also doubles as the Active/Inactive filter (farms/employees
            CRUD task): deactivated staff must stay findable, not disappear
            once toggled off. */}
        <div className="mt-5 grid grid-cols-3 gap-2">
          <Kpi label="Active" value={list.filter((e) => e.status === 'ACTIVE').length} tone="ok" onClick={() => setStatusFilter((cur) => (cur === 'Active' ? 'All' : 'Active'))} />
          <Kpi label="Inactive" value={list.filter((e) => e.status !== 'ACTIVE').length} onClick={() => setStatusFilter((cur) => (cur === 'Inactive' ? 'All' : 'Inactive'))} />
          <Kpi label="Total" value={list.length} onClick={() => setStatusFilter('All')} />
        </div>

        {loadError && <div className="mt-3 text-sm text-danger">{loadError}</div>}

        <div className="relative mt-5 mb-3">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, id, phone…" className="pl-9" aria-label="Search staff" />
          {search && (
            <button type="button" onClick={() => setSearch('')} className="absolute top-1/2 right-3 -translate-y-1/2 text-subtle"><X size={14} /></button>
          )}
        </div>

        <div className="mb-4">
          <Chips value={filter} onChange={setFilter} items={roles.map(r => ({ id: r, label: r === 'All' ? 'All' : roleLabel(r) }))} />
        </div>

        {employees === null && !loadError && (
          <div className="py-10 text-center text-sm text-muted">Loading staff…</div>
        )}

        {/* Roster: card view (hero) or table view */}
        {employees !== null && viewMode === 'table' ? (
          <DataTable
            rows={filtered as unknown as Record<string, unknown>[]}
            columns={PEOPLE_COLS}
            rowKey={(r) => r.id as string}
            onRowClick={(r) => navigate('people-detail', { id: r.id as string })}
            defaultPageSize={20}
            pageSizes={[10, 20, 50, 100, 200]}
            bodyHeight={380}
            tableId="people-staff"
            emptyText="No staff match your search."
          />
        ) : employees !== null && (
          <>
            {filtered.length === 0 && list.length === 0 && (
              <EmptyState icon={<Key size={20} />} title="No people yet" body="Add someone before you can give them a login or assign a batch."
                action={<Button className="w-full justify-center" onClick={() => setShowAdd(true)}><Plus size={14} /> Add a person</Button>} />
            )}
            {filtered.length === 0 && list.length > 0 && (
              <div className="py-10 text-center text-sm text-muted">No one matches that search.</div>
            )}
            {filtered.length > 0 && (
              <ul className="grid gap-2 sm:grid-cols-2">
                {filtered.map((emp) => (
                  <li key={emp.id}>
                    <button type="button" onClick={() => navigate('people-detail', { id: emp.id })}
                      className="flex w-full flex-col gap-2.5 rounded-xl bg-surface px-4 py-3.5 text-left shadow-(--shadow-border) hover:shadow-(--shadow-border-hover)">
                      <div className="flex items-center gap-3">
                        <Avatar name={emp.name} size="lg" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-medium">{emp.name}</span>
                            {emp.status !== 'ACTIVE' && <Badge variant="default">{emp.status}</Badge>}
                          </div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-2">
                            <Badge variant="primary">{roleLabel(emp.role)}</Badge>
                            <span className="text-xs text-muted">{emp.phone || '—'}</span>
                            {emp.userId && (
                              <span className="flex items-center gap-1 text-xs text-subtle"><Key size={10} /> Linked</span>
                            )}
                          </div>
                        </div>
                        <ChevronRight size={16} className="shrink-0 text-subtle" />
                      </div>
                      {onTodayFor(emp.id) && (
                        <p className="pl-[3.25rem] text-xs text-primary">On today: {onTodayFor(emp.id)}</p>
                      )}
                      {emp.assignedBatchIds.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 pl-[3.25rem]">
                          {emp.assignedBatchIds.slice(0, 4).map((b) => (
                            <span key={b} className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary">{batchLabel(b)}</span>
                          ))}
                          {emp.assignedBatchIds.length > 4 && <span className="text-xs text-muted">+{emp.assignedBatchIds.length - 4} more</span>}
                        </div>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>

      {/* CSV Import Modal */}
      {showImport && (
        <CsvImportModal
          entity="employees"
          onClose={() => setShowImport(false)}
          onImport={handleImportRows}
        />
      )}

      {/* Add Employee Modal */}
      {showAdd && (
        <AddEmployeeModal
          tenantId={tenantId}
          batches={batches}
          farms={farms}
          activeFarmId={activeFarmId}
          onClose={() => setShowAdd(false)}
          onCreated={(emp) => { setEmployees((prev) => [...(prev ?? []), emp]); setShowAdd(false); showToast(`${emp.name} added. Open them to give a login.`, 'success'); }}
        />
      )}
    </div>
  );
}

function AddEmployeeModal({ tenantId, batches, farms, activeFarmId, onClose, onCreated }: {
  tenantId: string;
  batches: ApiBatchLite[];
  // farm-scoped-data task: an employee's home farm — required, same as
  // purchases/lots (a worker is always based at one real farm; unlike a
  // task, "no farm" isn't a meaningful choice for a new hire).
  farms: { id: string; name: string }[];
  activeFarmId: string;
  onClose: () => void;
  onCreated: (emp: ApiEmployee) => void;
}) {
  const { navigate } = useNav();
  const [addStep, setAddStep] = useState(1);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('worker');
  const [threshold, setThreshold] = useState('3');
  const [monthlySalary, setMonthlySalary] = useState('');
  const [selectedBatches, setSelectedBatches] = useState<string[]>([]);
  const [farmId, setFarmId] = useState(activeFarmId !== 'ALL' ? activeFarmId : '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  function toggleBatch(id: string) {
    setSelectedBatches((prev) => prev.includes(id) ? prev.filter((b) => b !== id) : [...prev, id]);
  }

  async function handleSubmit() {
    if (!name.trim()) { setError('Full name is required.'); setAddStep(1); return; }
    if (!farmId) { setError('Select which farm this employee is based at.'); setAddStep(1); return; }
    // Blank salary means "no pay rate set yet" (0), not an error — an
    // employee can exist before payroll is configured for them.
    const monthlySalaryCents = monthlySalary.trim() === '' ? 0 : parseMoneyToCents(monthlySalary);
    if (monthlySalaryCents === null) { setError('Monthly salary must be a valid amount.'); setAddStep(2); return; }
    setSaving(true); setError('');
    const res = await apiClient.post<ApiEmployee>('/api/employees', {
      tenantId,
      name: name.trim(),
      phone: phone.trim(),
      role,
      mortalityPhotoThreshold: Number(threshold) || 3,
      monthlySalaryCents,
      assignedBatchIds: selectedBatches,
      status: 'ACTIVE',
      farmId,
    });
    setSaving(false);
    if (!res.success) { setError(res.error || 'Failed to add employee.'); return; }
    onCreated(res.data);
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)', maxHeight: '80%', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Add Employee</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', gap: 0, marginBottom: 20 }}>
          {['Who', 'Pay', 'Batches'].map((s, i) => (
            <React.Fragment key={s}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3 }}>
                <div className={`step-node ${i + 1 < addStep ? 'done' : i + 1 === addStep ? 'active' : 'pending'}`} style={{ width: 22, height: 22, fontSize: 'var(--fs-2xs)' }}>{i + 1 < addStep ? <Check size={11} aria-hidden="true" /> : i + 1}</div>
                <span style={{ fontSize: 'var(--fs-2xs)', fontWeight: 700, color: addStep === i + 1 ? 'var(--primary-green)' : 'var(--text-dim)' }}>{s}</span>
              </div>
              {i < 2 && <div className={`step-line ${i + 1 < addStep ? 'done' : ''}`} style={{ marginTop: 11 }} />}
            </React.Fragment>
          ))}
        </div>

        {addStep === 1 && (
          <div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Farm</label>
              {farms.length === 0 ? (
                <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--card)' }}>
                  <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 10 }}>A person has to belong to a farm. You do not have one yet.</div>
                  <button type="button" className="btn-secondary" onClick={() => { onClose(); navigate('crops', { tab: 'units' }); }}>Add a house or field first</button>
                </div>
              ) : (
              <Select className="farm-input" value={farmId} onChange={(v) => setFarmId(v)} placeholder="Select a farm…">
                <option value="" disabled>Select a farm…</option>
                {farms.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
              </Select>
              )}
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Full Name</label>
              <input className="farm-input" placeholder="Employee name" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Phone</label>
              <input className="farm-input" placeholder="+254-7xx-xxx-xxx" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Role</label>
              <Select className="farm-input" value={role} onChange={(v) => setRole(v)}>
                {FALLBACK_ROLES.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
              </Select>
            </div>
          </div>
        )}

        {addStep === 2 && (
          <div>
            <div style={{ padding: '10px 12px', background: 'rgba(var(--primary-rgb),0.06)', borderRadius: 10, marginBottom: 14, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.45 }}>
              You&apos;ll give a worker a phone and PIN on their page after they&apos;re added. This step is pay, not sign-in.
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Ask for a photo when deaths exceed</label>
              <input className="farm-input" placeholder="e.g. 3" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Monthly Salary (KSh)</label>
              <input className="farm-input" placeholder="Leave blank if not on payroll yet" type="number" min={0} value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} />
            </div>
          </div>
        )}

        {addStep === 3 && (
          <div>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', marginBottom: 10 }}>Which batches they can record against. Skip this and assign later from their page.</div>
            {batches.length === 0 && (
              <div style={{ padding: 12, borderRadius: 10, border: '1px solid var(--border-subtle)', background: 'var(--card)', marginBottom: 14 }}>
                <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.45, marginBottom: 10 }}>No batches yet. You can still add this person, then start a batch and assign them.</div>
                <button type="button" className="btn-secondary" onClick={() => { onClose(); navigate('crops', { tab: 'livestock' }); }}>Start a livestock batch</button>
              </div>
            )}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
              {batches.map((b) => {
                const on = selectedBatches.includes(b.id);
                return (
                  <div key={b.id} onClick={() => toggleBatch(b.id)} style={{ padding: '10px 12px', background: on ? 'rgba(var(--primary-rgb),0.08)' : 'var(--card)', border: `1px solid ${on ? 'rgba(var(--primary-rgb),0.3)' : 'var(--border-subtle)'}`, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                    <span style={{ fontSize: 'var(--fs-sm)', color: on ? 'var(--primary-green)' : 'var(--text-secondary)', fontWeight: on ? 700 : 400 }}>{b.code} – {b.name}</span>
                    {on && <Check size={14} color="var(--primary-green)" />}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 10 }}>
          {addStep > 1 && <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center', borderRadius: 12, padding: '12px' }} onClick={() => setAddStep(addStep - 1)}>Back</button>}
          <button className="btn-primary" disabled={saving} style={{ flex: 2, justifyContent: 'center', borderRadius: 12, padding: '12px', opacity: saving ? 0.7 : 1 }}
            onClick={() => { if (addStep < 3) setAddStep(addStep + 1); else handleSubmit(); }}>
            {saving ? 'Saving…' : addStep === 3 ? 'Add Employee' : 'Next'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Worker sign-in card (employee detail) ─────────────────────────────────
 * The missing half of worker access. Settings › Security could already RESET
 * a worker's PIN, but only for an account that already existed — and nothing
 * in the owner's app could create one, because POST /api/admin/users is
 * super_admin-only. On a new tenant that left every employee unable to sign
 * in with no owner-side fix, so this card issues the account from the person
 * it belongs to. */
interface WorkerLoginState {
  hasLogin: boolean;
  userId?: string;
  phone: string | null;
  hasPin: boolean;
  status: string | null;
}

// Owner reveals a fresh set-password link exactly once — same "cannot be
// retrieved again, copy it now" convention as admin-users.tsx's
// TempPasswordModal, for the same reason: this codebase sends no real email,
// so the link itself is the only way the owner can hand it to the manager.
function SetPasswordLinkModal({ email, url, onClose }: { email: string; url: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 300, padding: 20 }} onClick={onClose}>
      <div className="farm-card" style={{ width: '100%', maxWidth: 420, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <CheckCircle2 size={18} color="var(--status-ok)" />
          <div style={{ fontSize: 'var(--fs-lg)', fontWeight: 700 }}>Login created</div>
        </div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', marginBottom: 12, lineHeight: 1.5 }}>
          Send this one-time link to <strong>{email}</strong> — through a channel you trust, out of band. They use it to set their own password.
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--surface)', border: '1px solid var(--border-subtle)', borderRadius: 10, padding: '10px 12px', marginBottom: 8 }}>
          <code style={{ fontFamily: 'monospace', fontSize: 'var(--fs-xs)', flex: 1, wordBreak: 'break-all', color: 'var(--text-primary)' }}>{url}</code>
          <button
            onClick={() => { if (navigator.clipboard) void navigator.clipboard.writeText(url); setCopied(true); }}
            style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, padding: '5px 10px', borderRadius: 8, background: 'rgba(var(--primary-rgb),0.1)', border: '1px solid rgba(var(--primary-rgb),0.3)', color: 'var(--primary-green)', cursor: 'pointer', flexShrink: 0 }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, fontSize: 'var(--fs-2xs)', color: 'var(--status-warning)', marginBottom: 16, lineHeight: 1.4 }}>
          <AlertTriangle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>This link cannot be shown again once you close this dialog. It expires in 48 hours.</span>
        </div>
        <button onClick={onClose} className="btn-primary" style={{ width: '100%', justifyContent: 'center', fontSize: 'var(--fs-base)', padding: 10 }}>Done</button>
      </div>
    </div>
  );
}

// Roles this card can issue an email login for — everyone above a worker
// except the owner themselves (POST /api/employees/[id]/email-login refuses
// owner/super_admin server-side too; mirrored here only so the button never
// offers an action the API will reject).
const EMAIL_LOGIN_ROLES = new Set(['manager', 'vet', 'auditor']);

function WorkerLoginCard({ employee, tenantId, onLinked }: {
  employee: ApiEmployee;
  tenantId: string;
  onLinked: () => void;
}) {
  const { role } = useNav();
  const { showToast } = useToast();
  const [state, setState] = useState<WorkerLoginState | null>(null);
  const [phone, setPhone] = useState(employee.phone || '');
  const [pin, setPin] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [setPasswordLink, setSetPasswordLink] = useState<{ email: string; url: string } | null>(null);

  const canManage = role === 'owner' || role === 'manager';
  // Only an owner may issue a login for a role above worker — see the API
  // route's header comment for why this stays narrower than the PIN card.
  const canIssueEmailLogin = role === 'owner' && EMAIL_LOGIN_ROLES.has(employee.role);

  const load = useCallback(() => {
    if (!canManage) return;
    apiClient.get<WorkerLoginState>(`/api/employees/${employee.id}/login?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setState(res.data); setPhone((current) => current || res.data.phone || ''); }
      else setError(res.error || 'Could not load sign-in details.');
    });
  }, [canManage, employee.id, tenantId]);

  useEffect(() => { load(); }, [load]);

  if (!canManage) return null;

  // Everyone above a worker signs in with email + password, not a PIN — but
  // an owner can now actually issue that login from here instead of being
  // told to go find a platform admin who has no UI for it either.
  if (employee.role !== 'worker') {
    async function sendEmailLogin() {
      setError('');
      setBusy(true);
      const res = await apiClient.post<{ userId: string; email: string; setPasswordUrl: string }>(`/api/employees/${employee.id}/email-login`, { tenantId, email });
      setBusy(false);
      if (!res.success) { setError(res.error || 'Could not create the login.'); return; }
      setEmail('');
      setSetPasswordLink({ email: res.data.email, url: res.data.setPasswordUrl });
      load();
      onLinked();
    }

    return (
      <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
        <div className="section-eyebrow" style={{ marginBottom: 8 }}>Sign-in</div>
        {!canIssueEmailLogin ? (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {roleLabel(employee.role)} accounts sign in with an email and password, not a PIN.
            {role !== 'owner' ? ' Only the owner can issue this login.' : ' This role cannot be issued a login here.'}
          </div>
        ) : state === null ? (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>
        ) : state.hasLogin ? (
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
            {employee.name} already has a sign-in account{state.status && state.status !== 'ACTIVE' ? ` (currently ${state.status.toLowerCase()})` : ''}. There is no reset action here yet — ask the platform admin to reset their password.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
              {employee.name} has no way to sign in yet. {roleLabel(employee.role)} accounts sign in with an email and password — give them an email and we&apos;ll generate a one-time link for them to set one.
            </div>
            <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Email</label>
            <input
              className="farm-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="grace@example.com" style={{ marginBottom: 10 }}
            />
            {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
            <button className="btn-primary" disabled={busy || !email.trim()} onClick={sendEmailLogin} style={{ width: '100%', justifyContent: 'center' }}>
              {busy ? 'Creating…' : 'Create login'}
            </button>
          </>
        )}
        {setPasswordLink && (
          <SetPasswordLinkModal email={setPasswordLink.email} url={setPasswordLink.url} onClose={() => setSetPasswordLink(null)} />
        )}
      </div>
    );
  }

  async function createLogin() {
    setError('');
    if (!/^\d{4}$/.test(pin)) { setError('Enter an exact 4-digit PIN.'); return; }
    setBusy(true);
    const res = await apiClient.post<WorkerLoginState>(`/api/employees/${employee.id}/login`, { tenantId, phone, pin });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not create the login.'); return; }
    setPin('');
    showToast(`Login created. ${employee.name} signs in with ${res.data.phone} and this PIN — share it privately.`, 'success');
    load();
    onLinked();
  }

  async function resetPin() {
    setError('');
    if (!/^\d{4}$/.test(pin)) { setError('Enter an exact 4-digit PIN.'); return; }
    if (!state?.userId) return;
    setBusy(true);
    // The existing tenant-scoped rotation endpoint — not a second way to do
    // the same thing.
    const res = await apiClient.post('/api/security/worker-pins', { userId: state.userId, pin, phone });
    setBusy(false);
    if (!res.success) { setError(res.error || 'Could not update the PIN.'); return; }
    setPin('');
    showToast('PIN updated. Share it with the worker privately.', 'success');
    load();
  }

  async function revoke() {
    setError('');
    setBusy(true);
    const res = await apiClient.delete(`/api/employees/${employee.id}/login?tenantId=${tenantId}`);
    setBusy(false);
    setConfirmRevoke(false);
    if (!res.success) { setError(res.error || 'Could not revoke the login.'); return; }
    showToast('Sign-in revoked. Their PIN no longer works and open sessions were ended.', 'success');
    load();
  }

  const hasLogin = state?.hasLogin ?? false;
  const suspended = state?.status === 'SUSPENDED';

  return (
    <div className="farm-card" style={{ padding: 14, marginBottom: 14 }}>
      <div className="section-eyebrow" style={{ marginBottom: 8 }}>Sign-in</div>

      {state === null ? (
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>Loading…</div>
      ) : (
        <>
          <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 12 }}>
            {hasLogin
              ? suspended
                ? <>Sign-in is <strong>revoked</strong>. Setting a new PIN below restores access.</>
                : <>Signs in with <strong>{state.phone}</strong> and a 4-digit PIN{state.hasPin ? '' : ' — no PIN is set yet, so they cannot sign in'}.</>
              : <>{employee.name} has no way to sign in yet. Give them a phone number and a 4-digit PIN — that pair is their login.</>}
          </div>

          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Phone</label>
          <input
            className="farm-input" value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="07XXXXXXXX" inputMode="tel" style={{ marginBottom: 10 }}
          />

          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>
            {hasLogin ? 'New 4-digit PIN' : '4-digit PIN'}
          </label>
          <input
            className="farm-input" type="password" inputMode="numeric" pattern="[0-9]*" maxLength={4}
            value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            placeholder="••••" style={{ marginBottom: 10 }}
          />

          {error && <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn-primary" disabled={busy}
              onClick={hasLogin ? resetPin : createLogin}
              style={{ flex: 1, justifyContent: 'center' }}
            >
              {busy ? 'Saving…' : hasLogin ? 'Update PIN' : 'Create login'}
            </button>
            {hasLogin && !suspended && (
              <button
                className="btn-secondary" disabled={busy}
                onClick={() => setConfirmRevoke(true)}
                style={{ justifyContent: 'center' }}
              >
                Revoke
              </button>
            )}
          </div>

          {confirmRevoke && (
            <div style={{ marginTop: 10, padding: 10, borderRadius: 10, border: '1px solid var(--status-critical)', background: 'rgba(var(--critical-rgb),0.06)' }}>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 8 }}>
                Revoke sign-in for {employee.name}? Their PIN stops working immediately and any open session ends. Their work records are kept.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-secondary" onClick={() => setConfirmRevoke(false)} style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
                <button disabled={busy} onClick={revoke} style={{ flex: 1, justifyContent: 'center', padding: 10, borderRadius: 10, fontWeight: 700, fontSize: 'var(--fs-sm)', background: 'rgba(var(--critical-rgb),0.12)', border: '1px solid rgba(var(--critical-rgb),0.35)', color: 'var(--status-critical)', cursor: 'pointer' }}>
                  Revoke sign-in
                </button>
              </div>
            </div>
          )}

          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginTop: 10, lineHeight: 1.5 }}>
            PINs are stored hashed and are never shown again — if it&apos;s forgotten, set a new one here.
          </div>
        </>
      )}
    </div>
  );
}

export function PeopleDetailScreen() {
  const { params, tenantId, goBack } = useNav();
  const { showToast } = useToast();
  const id = params.id;
  const [employee, setEmployee] = useState<ApiEmployee | null>(null);
  const [loadError, setLoadError] = useState('');
  const [batches, setBatches] = useState<ApiBatchLite[]>([]);
  const [roleMatrix, setRoleMatrix] = useState<RoleMatrixEntry[]>([]);
  const [activeSection, setActiveSection] = useState<'profile' | 'permissions' | 'payroll'>('profile');
  const [showRoleDropdown, setShowRoleDropdown] = useState(false);
  // Payroll tab (payroll-and-gps task) — GET /api/payroll/payslips?employeeId=,
  // fetched lazily (only once this tab is actually opened) since most visits
  // to this screen never look at pay history.
  const [payslips, setPayslips] = useState<ApiPayslip[] | null>(null);
  const [payslipsError, setPayslipsError] = useState('');
  const [roleSaved, setRoleSaved] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [busy, setBusy] = useState(false);
  // Deactivate/reactivate confirmation (farms/employees CRUD task) — a status
  // toggle used to fire straight from the button with no confirmation step
  // and no visibility into what the employee is still attached to.
  const [showToggleConfirm, setShowToggleConfirm] = useState(false);
  const [toggleError, setToggleError] = useState('');

  const loadEmployee = useCallback(() => {
    if (!id) return;
    apiClient.get<ApiEmployee>(`/api/employees/${id}?tenantId=${tenantId}`).then((res) => {
      if (res.success) { setEmployee(res.data); setLoadError(''); }
      else setLoadError(res.error || 'Employee not found.');
    });
  }, [id, tenantId]);

  useEffect(() => { loadEmployee(); }, [loadEmployee]);
  useEffect(() => {
    apiClient.get<ApiBatchLite[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      if (res.success) setBatches(res.data.map((b) => ({ id: b.id, code: (b as unknown as { code: string }).code, name: (b as unknown as { name: string }).name })));
    });
    apiClient.get<RoleMatrixEntry[]>(`/api/role-permissions?tenantId=${tenantId}`).then((res) => {
      if (res.success) setRoleMatrix(res.data);
    });
  }, [tenantId]);

  const batchLabel = useCallback((bid: string) => batches.find((b) => b.id === bid)?.code ?? bid.slice(0, 8), [batches]);

  useEffect(() => {
    if (activeSection !== 'payroll' || !id || payslips !== null) return;
    apiClient.get<ApiPayslip[]>(`/api/payroll/payslips?tenantId=${tenantId}&employeeId=${id}`).then((res) => {
      if (res.success) { setPayslips(res.data); setPayslipsError(''); }
      else { setPayslips([]); setPayslipsError(res.error || 'Failed to load payroll history.'); }
    });
  }, [activeSection, id, tenantId, payslips]);

  if (loadError) {
    return (
      <div className="screen-content">
        <TopNav title="Employee" showBack />
        <div className="px-screen" style={{ paddingTop: 16, fontSize: 'var(--fs-base)', color: 'var(--status-critical)' }}>{loadError}</div>
      </div>
    );
  }
  if (!employee) {
    return (
      <div className="screen-content">
        <TopNav title="Employee" showBack />
        <div className="px-screen" style={{ paddingTop: 16, fontSize: 'var(--fs-base)', color: 'var(--text-dim)' }}>Loading…</div>
      </div>
    );
  }

  const availableRoles = roleMatrix.length > 0 ? roleMatrix.map((r) => r.role) : FALLBACK_ROLES;
  const assignedRole = roleMatrix.find((r) => r.role === employee.role);
  const roleName = roleLabel(employee.role);

  async function handleSaveRole(newRoleId: string) {
    setShowRoleDropdown(false);
    setBusy(true);
    const res = await apiClient.patch<ApiEmployee>(`/api/employees/${employee!.id}?tenantId=${tenantId}`, { role: newRoleId });
    setBusy(false);
    if (res.success) {
      setEmployee(res.data);
      setRoleSaved(true);
      setTimeout(() => setRoleSaved(false), 2000);
    }
  }

  async function handleToggleActive() {
    setBusy(true);
    setToggleError('');
    const nextStatus = employee!.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    const res = await apiClient.patch<ApiEmployee>(`/api/employees/${employee!.id}?tenantId=${tenantId}`, { status: nextStatus });
    setBusy(false);
    if (!res.success) {
      setToggleError(res.error || `Failed to ${nextStatus === 'INACTIVE' ? 'deactivate' : 'reactivate'} employee.`);
      return;
    }
    setEmployee(res.data);
    setShowToggleConfirm(false);
  }

  return (
    <div className="screen-content">
      <TopNav title="" showBack />
      <div className="px-screen pt-3 pb-10">
        {/* Header */}
        <div className="flex flex-col items-center gap-2 pb-1 text-center">
          <Avatar name={employee.name} size="lg" className="size-16 text-xl" />
          <h1 className="font-display text-2xl font-medium">{employee.name}</h1>
          <div className="flex items-center gap-2">
            <Badge variant="primary">{roleName}</Badge>
            {employee.status !== 'ACTIVE' && <Badge variant="default">{employee.status}</Badge>}
          </div>
        </div>

        <div className="mt-5">
          <Segmented
            value={activeSection}
            onChange={setActiveSection}
            items={[
              { id: 'profile', label: 'Profile', hint: 'Contact, role, sign-in' },
              { id: 'permissions', label: 'Permissions', hint: 'What this role can do' },
              { id: 'payroll', label: 'Payroll', hint: 'Pay history' },
            ]}
          />
        </div>

        {activeSection === 'profile' && (
          <div className="mt-5 flex flex-col gap-4">
            {/* Role Assignment */}
            <section className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium">{roleName}</div>
                  <p className="mt-0.5 text-xs text-muted">
                    {assignedRole ? `${Object.values(assignedRole.permissions).filter(p => p === 'edit').length} edit · ${assignedRole.approvalRequired.length} need approval` : 'No permissions configured for this role yet'}
                  </p>
                </div>
                <Button variant="secondary" size="sm" disabled={busy} onClick={() => setShowRoleDropdown(s => !s)}>
                  {showRoleDropdown ? 'Cancel' : 'Change role'}
                </Button>
              </div>
              {roleSaved && (
                <div className="mt-2.5 flex items-center gap-1.5 text-xs font-medium text-success"><CheckCircle2 size={12} aria-hidden="true" /> Role updated successfully</div>
              )}
              {showRoleDropdown && (
                <div className="mt-3 flex flex-col gap-1.5">
                  <p className="mb-1 text-xs text-subtle">Select a role to assign:</p>
                  {availableRoles.map((r) => (
                    <button key={r} type="button" onClick={() => handleSaveRole(r)}
                      className={cn('flex items-center justify-between rounded-lg px-3 py-2.5 text-left', employee.role === r ? 'bg-primary-soft' : 'bg-surface-2 hover:bg-surface-2/70')}>
                      <span className="flex items-center gap-2">
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: getRoleColor(r) }} />
                        <span className={cn('text-sm font-medium', employee.role === r && 'text-primary')}>{roleLabel(r)}</span>
                      </span>
                      {employee.role === r && <Check size={13} className="text-primary" />}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="rounded-xl bg-surface p-4 shadow-(--shadow-border)">
              <dl>
                <Kv label="Employee ID" value={<span className="font-mono text-xs">{employee.id.slice(0, 8)}</span>} />
                <Kv label="Phone" value={employee.phone || '—'} />
                <Kv label="Login" value={employee.userId ? 'Account linked' : 'No login account'} />
                <Kv label="Photo threshold" value={`${employee.mortalityPhotoThreshold}+ deaths`} />
                <Kv label="Monthly salary" value={employee.monthlySalaryCents > 0 ? formatMoney(employee.monthlySalaryCents) : 'Not set'} />
                <Kv label="Assigned batches" value={employee.assignedBatchIds.length > 0 ? employee.assignedBatchIds.map(batchLabel).join(', ') : 'None'} />
              </dl>
            </section>

            <WorkerLoginCard employee={employee} tenantId={tenantId} onLinked={loadEmployee} />

            <div className="grid grid-cols-2 gap-2.5">
              <Button variant="secondary" className="justify-center" onClick={() => setShowEdit(true)}>Edit details</Button>
              <Button variant={employee.status === 'ACTIVE' ? 'danger' : 'default'} disabled={busy} className="justify-center" onClick={() => { setToggleError(''); setShowToggleConfirm(true); }}>
                {employee.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
              </Button>
            </div>
          </div>
        )}

        {activeSection === 'permissions' && (
          <div className="mt-5">
            <p className="mb-3 text-sm text-muted">
              Permissions inherited from the <strong className="text-fg">{roleName}</strong> role. Go to Approvals → Roles &amp; rules to edit role permissions.
            </p>
            <section className="rounded-xl bg-surface p-2 shadow-(--shadow-border)">
              {assignedRole ? (
                <ul className="divide-y divide-border">
                  {Object.entries(assignedRole.permissions).map(([key, perm]) => (
                    <li key={key} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="text-sm">{key.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                      <Badge variant={perm === 'edit' ? 'success' : perm === 'view' ? 'default' : 'danger'}>
                        {perm === 'edit' ? 'Editable' : perm === 'view' ? 'Read-only' : 'Hidden'}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="py-6 text-center text-sm text-muted">No role permissions configured</div>
              )}
            </section>
            {assignedRole && assignedRole.approvalRequired.length > 0 && (
              <section className="mt-4 rounded-xl bg-surface p-4 shadow-(--shadow-border)">
                <p className="mb-2.5 text-xs font-medium tracking-wide text-warning uppercase">Requires owner approval</p>
                <div className="flex flex-wrap gap-1.5">
                  {assignedRole.approvalRequired.map(a => (
                    <Badge key={a} variant="warning">{a.replace(/-/g, ' ')}</Badge>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}

        {activeSection === 'payroll' && (
          <div className="mt-5">
            {employee.monthlySalaryCents === 0 && (
              <div className="mb-4 rounded-xl bg-warning-soft px-3.5 py-2.5 text-xs text-fg">
                No monthly salary set — this employee is skipped by every payroll run until one is set in Edit Details.
              </div>
            )}
            {payslipsError && <div className="mb-3 text-sm text-danger">{payslipsError}</div>}
            {!payslipsError && payslips === null && (
              <div className="py-10 text-center text-sm text-muted">Loading…</div>
            )}
            {!payslipsError && payslips !== null && payslips.length === 0 && (
              <EmptyState icon={<CheckCircle2 size={20} />} title="No pay history yet" body="This employee hasn't been paid in a payroll run. Run payroll from Finance → Payroll to pay them for the first time." />
            )}
            {!payslipsError && payslips !== null && payslips.length > 0 && (
              <section className="rounded-xl bg-surface p-2 shadow-(--shadow-border)">
                <ul className="divide-y divide-border">
                  {payslips.map((p) => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                      <span className="text-sm text-muted">{fmtDate(p.periodStart)} – {fmtDate(p.periodEnd)}</span>
                      <span className="font-display text-base font-medium">{formatMoney(p.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}

        {/* Status Timeline */}
        <div className="mt-5">
          <StatusTimeline tenantId={tenantId} entity="employee" entityId={employee.id} />
        </div>
      </div>

      {showEdit && (
        <EditEmployeeModal
          employee={employee}
          tenantId={tenantId}
          onClose={() => setShowEdit(false)}
          onSaved={(updated) => { setEmployee(updated); setShowEdit(false); }}
          onRemoved={(message) => {
            // The record this screen is showing may no longer exist, so leave
            // it rather than re-rendering a detail view of a deleted row. The
            // server's own message says whether it was deleted or archived.
            setShowEdit(false);
            showToast(message, 'success');
            goBack();
          }}
        />
      )}

      {showToggleConfirm && (
        <ToggleActiveConfirm
          employee={employee}
          busy={busy}
          error={toggleError}
          batchLabel={batchLabel}
          onCancel={() => { setShowToggleConfirm(false); setToggleError(''); }}
          onConfirm={handleToggleActive}
        />
      )}
    </div>
  );
}

// Deactivate/reactivate confirmation — names the employee and, when
// deactivating, surfaces what they're still assigned to (batches) so the
// admin isn't guessing. This does not hard-block the action: assignment
// isn't reassigned automatically, but the admin has to see it first.
function ToggleActiveConfirm({ employee, busy, error, batchLabel, onCancel, onConfirm }: {
  employee: ApiEmployee;
  busy: boolean;
  error: string;
  batchLabel: (id: string) => string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const deactivating = employee.status === 'ACTIVE';
  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={onCancel}>
      <div className="farm-card" style={{ padding: 18, width: '100%', maxWidth: 340 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ fontSize: 'var(--fs-md)', fontWeight: 700, marginBottom: 10 }}>{deactivating ? 'Deactivate' : 'Reactivate'} {employee.name}?</div>
        <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: deactivating && employee.assignedBatchIds.length > 0 ? 8 : 14 }}>
          {deactivating
            ? <>This account keeps its history — <strong>{employee.name}</strong> is never deleted — but they&apos;re marked inactive and won&apos;t appear as an option for new assignments.</>
            : <>This makes <strong>{employee.name}</strong> active again.</>}
        </div>
        {deactivating && employee.assignedBatchIds.length > 0 && (
          <div style={{ padding: '8px 10px', background: 'rgba(var(--warning-rgb),0.08)', border: '1px solid rgba(var(--warning-rgb),0.3)', borderRadius: 8, marginBottom: 14, fontSize: 'var(--fs-xs)', color: 'var(--text-secondary)' }}>
            Still assigned to {employee.assignedBatchIds.length} batch{employee.assignedBatchIds.length === 1 ? '' : 'es'}: {employee.assignedBatchIds.map(batchLabel).join(', ')}. Deactivating does not unassign them.
          </div>
        )}
        {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 12 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={onCancel} disabled={busy} className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }}>Cancel</button>
          <button onClick={onConfirm} disabled={busy} className="btn-primary" style={{ flex: 1, justifyContent: 'center' }}>
            {busy ? 'Working…' : deactivating ? 'Deactivate' : 'Reactivate'}
          </button>
        </div>
      </div>
    </div>
  );
}

function EditEmployeeModal({ employee, tenantId, onClose, onSaved, onRemoved }: {
  employee: ApiEmployee;
  tenantId: string;
  onClose: () => void;
  onSaved: (emp: ApiEmployee) => void;
  // Given the server's own message, because only the server knows whether the
  // person was deleted outright or archived to protect their records.
  onRemoved: (message: string) => void;
}) {
  const [name, setName] = useState(employee.name);
  const [phone, setPhone] = useState(employee.phone);
  const [threshold, setThreshold] = useState(String(employee.mortalityPhotoThreshold));
  const [monthlySalary, setMonthlySalary] = useState(employee.monthlySalaryCents > 0 ? String(centsToMajor(employee.monthlySalaryCents)) : '');
  // ── Batch assignment was creation-only ────────────────────────────────────
  // The Add Employee flow has a "select batches this employee can access" step,
  // and this modal had no equivalent — so once someone was created, their
  // assignment was frozen. There was no other route to it either: PATCH
  // /api/employees/[id] has accepted `assignedBatchIds` all along (it validates
  // them against the tenant), nothing in the UI ever sent it. A worker whose
  // batches changed had to be deleted and recreated.
  //
  // This matters more than it looks: useWorkerContext (components/farm/
  // worker.tsx) filters the worker's whole batch list by assignedBatchIds, and
  // an employee with an empty array sees NO batches and cannot record anything.
  const [batches, setBatches] = useState<ApiBatchLite[] | null>(null);
  const [selectedBatches, setSelectedBatches] = useState<string[]>(employee.assignedBatchIds ?? []);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    apiClient.get<ApiBatchLite[]>(`/api/batches?tenantId=${tenantId}`).then((res) => {
      setBatches(res.success ? res.data : []);
    });
  }, [tenantId]);

  function toggleBatch(id: string) {
    setSelectedBatches((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  // ── Removing someone, with the warning the action deserves ───────────────
  // Two-step on purpose: the button reveals a confirm panel naming the person
  // rather than deleting on first tap, because this can suspend their login.
  // The server decides whether it is a delete or an archive — a worker with
  // any record or payslip cannot be removed without taking the farm's history
  // with them (see DELETE /api/employees/[id]) — so this UI never promises
  // which one will happen. It reports what the server actually did.
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    setDeleting(true);
    setError('');
    const res = await apiClient.delete<{ outcome: 'deleted' | 'archived'; message: string }>(`/api/employees/${employee.id}?tenantId=${tenantId}`);
    setDeleting(false);
    if (!res.success) { setError(res.error || 'Could not remove this person.'); return; }
    onRemoved(res.data.message);
  }

  async function handleSave() {
    if (!name.trim()) { setError('Full name is required.'); return; }
    const monthlySalaryCents = monthlySalary.trim() === '' ? 0 : parseMoneyToCents(monthlySalary);
    if (monthlySalaryCents === null) { setError('Monthly salary must be a valid amount.'); return; }
    setSaving(true); setError('');
    const res = await apiClient.patch<ApiEmployee>(`/api/employees/${employee.id}?tenantId=${tenantId}`, {
      name: name.trim(),
      phone: phone.trim(),
      mortalityPhotoThreshold: Number(threshold) || 0,
      monthlySalaryCents,
      assignedBatchIds: selectedBatches,
    });
    setSaving(false);
    if (!res.success) { setError(res.error || 'Failed to save changes.'); return; }
    onSaved(res.data);
  }

  return (
    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'flex-end', zIndex: 100 }} onClick={onClose}>
      <div style={{ background: 'var(--surface)', borderRadius: '24px 24px 0 0', padding: 20, width: '100%', border: '1px solid var(--border-subtle)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ fontWeight: 700, fontSize: 'var(--fs-lg)' }}>Edit Employee</div>
          <button className="btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Full Name</label>
          <input className="farm-input" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Phone</label>
          <input className="farm-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Photo Required Above (deaths)</label>
          <input className="farm-input" type="number" min={0} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>Monthly Salary (KSh)</label>
          <input className="farm-input" placeholder="Leave blank if not on payroll" type="number" min={0} value={monthlySalary} onChange={(e) => setMonthlySalary(e.target.value)} />
        </div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ fontSize: 'var(--fs-xs)', fontWeight: 700, color: 'var(--text-secondary)', display: 'block', marginBottom: 5 }}>
            Assigned batches
          </label>
          <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--text-dim)', marginBottom: 8, lineHeight: 1.5 }}>
            A worker only sees the batches assigned to them — with none, they cannot record anything.
          </div>
          {batches === null && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>Loading batches…</div>}
          {batches !== null && batches.length === 0 && (
            <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-dim)' }}>No batches exist yet for this farm.</div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflowY: 'auto' }}>
            {(batches ?? []).map((b) => {
              const on = selectedBatches.includes(b.id);
              return (
                <div key={b.id} onClick={() => toggleBatch(b.id)} style={{ padding: '10px 12px', background: on ? 'rgba(var(--primary-rgb),0.08)' : 'var(--card)', border: `1px solid ${on ? 'rgba(var(--primary-rgb),0.3)' : 'var(--border-subtle)'}`, borderRadius: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                  <span style={{ fontSize: 'var(--fs-sm)', color: on ? 'var(--primary-green)' : 'var(--text-secondary)', fontWeight: on ? 700 : 400 }}>{b.code} – {b.name}</span>
                  {on && <Check size={14} color="var(--primary-green)" />}
                </div>
              );
            })}
          </div>
        </div>
        {error && <div style={{ fontSize: 'var(--fs-sm)', color: 'var(--status-critical)', marginBottom: 10 }}>{error}</div>}
        <button className="btn-primary" disabled={saving} style={{ width: '100%', justifyContent: 'center', borderRadius: 12, padding: 12, opacity: saving ? 0.7 : 1 }} onClick={handleSave}>
          {saving ? 'Saving…' : 'Save Changes'}
        </button>

        {/* Remove — last, separated, and never the primary action. */}
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--border-subtle)' }}>
          {!confirmingDelete ? (
            <button
              onClick={() => setConfirmingDelete(true)}
              style={{ width: '100%', padding: 11, borderRadius: 12, fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'rgba(var(--critical-rgb),0.08)', border: '1px solid rgba(var(--critical-rgb),0.25)', color: 'var(--status-critical)', cursor: 'pointer' }}
            >
              Remove {employee.name} from this farm
            </button>
          ) : (
            <div style={{ padding: '11px 12px', background: 'rgba(var(--critical-rgb),0.06)', border: '1px solid rgba(var(--critical-rgb),0.3)', borderRadius: 12 }}>
              <div style={{ fontSize: 'var(--fs-sm)', fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                Remove {employee.name}?
              </div>
              <div style={{ fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 1.55, marginBottom: 10 }}>
                They will be taken off the roster{employee.userId ? ' and will no longer be able to sign in' : ''}. If they have already filed records or been paid, those must stay on the farm&apos;s history — in that case they are archived rather than deleted, and we&apos;ll tell you which happened. This cannot be undone from here.
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button onClick={() => setConfirmingDelete(false)} disabled={deleting} className="btn-secondary" style={{ flex: 1, justifyContent: 'center', fontSize: 'var(--fs-sm)', padding: 9 }}>
                  Keep them
                </button>
                <button
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{ flex: 1, padding: 9, borderRadius: 10, fontSize: 'var(--fs-sm)', fontWeight: 700, background: 'var(--status-critical)', border: 'none', color: '#fff', cursor: 'pointer', opacity: deleting ? 0.7 : 1 }}
                >
                  {deleting ? 'Removing…' : 'Remove'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
