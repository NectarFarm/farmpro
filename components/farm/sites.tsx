'use client';
// ── Sites tab (docs/ui-migration-map.md D1–D3) ──────────────────────────────
// Ports the reference's src/components/farm/structure-map.tsx (`StructureMap`
// / `StructureFile` / `StructureWorkspace`) as the 5th tab on the Units screen
// (components/farm/crops.tsx, params.tab='sites') rather than a new top-level
// screen or a re-purposing of the unrelated GL Dimensions register — see the
// map's D1 for why the two "dimensions" words collide by accident.
//
// Zero new API calls: this reads the same `units`/`viewBatches`/`farms` the
// Units screen already has in state (GET /api/units, /api/batches, /api/farms).
//
// "Division" is not a real local entity, so this groups by `unit.type`
// (house/pen/paddock/parlor — whatever the farm actually typed in when
// creating the unit) rather than the reference's species-sniffing heuristic
// (`divisionName()` guessing "Layers"/"Broilers" from species text). That is
// more honest: it never claims a grouping the data doesn't actually support.
//
// Occupancy: the sum of `currentQty` across a unit's non-closed batches — the
// reference shows a capacity fill-bar; production_units has no capacity
// column locally, so this shows the honest "no capacity tracked" line instead
// of fabricating a percentage (same rule Units' own unit cards already
// follow).
import { useMemo, useState } from 'react';
import { Search, MapPin, Home, Warehouse } from './icons';
import { Input } from '@/components/ui-kit/input';
import { Badge } from '@/components/ui-kit/badge';
import { Dossier, Inspector, Kv } from '@/components/ui-kit/inspector';
import { EmptyState } from '@/components/ui-kit/empty-state';
import { cn } from '@/lib/utils';
import type { FarmSummary } from './navigation';

export interface SiteUnit {
  id: string;
  farmId: string;
  type: string;
  name: string;
  code: string;
  status: string;
}
export interface SiteBatch {
  id: string;
  unitId: string;
  code: string;
  label: string;
  qty: number;
  status: string;
}

type SitesSel =
  | { kind: 'group' }
  | { kind: 'farm'; id: string }
  | { kind: 'division'; farmId: string; name: string }
  | { kind: 'unit'; id: string };

interface Division { name: string; units: Array<SiteUnit & { batches: SiteBatch[] }> }
interface FarmNode { farm: FarmSummary; divisions: Division[]; head: number; houses: number }

function divisionLabel(type: string): string {
  if (!type) return 'Unassigned';
  return type.charAt(0).toUpperCase() + type.slice(1);
}

function isPhone() {
  return typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches;
}

function buildForest(units: SiteUnit[], batches: SiteBatch[], farms: FarmSummary[]): FarmNode[] {
  return farms.map((farm) => {
    const farmUnits = units.filter((u) => u.farmId === farm.id);
    const map = new Map<string, Division>();
    for (const unit of farmUnits) {
      const name = divisionLabel(unit.type);
      const row = map.get(name) ?? { name, units: [] };
      row.units.push({ ...unit, batches: batches.filter((b) => b.unitId === unit.id && b.status !== 'CLOSED') });
      map.set(name, row);
    }
    const divisions = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
    const head = divisions.reduce((s, d) => s + d.units.reduce((s2, u) => s2 + u.batches.reduce((s3, b) => s3 + b.qty, 0), 0), 0);
    return { farm, divisions, head, houses: farmUnits.length };
  });
}

export function SitesTab({
  units, batches, farms,
}: {
  units: SiteUnit[];
  batches: SiteBatch[];
  farms: FarmSummary[];
}) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SitesSel>({ kind: 'group' });
  const [mobileOpen, setMobileOpen] = useState(false);

  const forest = useMemo(() => buildForest(units, batches, farms), [units, batches, farms]);
  const q = query.trim().toLowerCase();

  const filtered = useMemo(() => {
    if (!q) return forest;
    return forest
      .map((node) => ({
        ...node,
        divisions: node.divisions
          .map((d) => ({
            ...d,
            units: d.units.filter((u) =>
              u.name.toLowerCase().includes(q) ||
              u.code.toLowerCase().includes(q) ||
              d.name.toLowerCase().includes(q) ||
              u.batches.some((b) => b.label.toLowerCase().includes(q) || b.code.toLowerCase().includes(q)),
            ),
          }))
          .filter((d) => d.units.length > 0 || d.name.toLowerCase().includes(q)),
      }))
      .filter((n) => n.divisions.length > 0 || n.farm.name.toLowerCase().includes(q));
  }, [forest, q]);

  const farmsCount = forest.length;
  const houses = forest.reduce((s, n) => s + n.houses, 0);
  const head = forest.reduce((s, n) => s + n.head, 0);
  const divisionsCount = forest.reduce((s, n) => s + n.divisions.length, 0);

  function pick(sel: SitesSel) {
    setSelected(sel);
    if (isPhone()) setMobileOpen(true);
  }

  if (farmsCount === 0) {
    return (
      <EmptyState
        icon={<MapPin size={20} />}
        title="No farms yet"
        body="Sites shows the tree once you have at least one farm and a house or field under it."
      />
    );
  }

  const title =
    selected.kind === 'group' ? 'All farms'
      : selected.kind === 'farm' ? (forest.find((n) => n.farm.id === selected.id)?.farm.name ?? 'Farm')
      : selected.kind === 'division' ? selected.name
      : (units.find((u) => u.id === selected.id)?.name ?? 'House');

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.9fr)]">
      <div className="min-w-0 rounded-xl bg-surface p-3 shadow-(--shadow-border) lg:p-4">
        <div className="mb-3 grid grid-cols-4 gap-2">
          <Mini k="Farms" v={farmsCount} />
          <Mini k="Divisions" v={divisionsCount} />
          <Mini k="Houses" v={houses} />
          <Mini k="Head" v={head.toLocaleString()} />
        </div>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a farm, division, house or batch…" className="pl-9" aria-label="Search sites" />
        </div>

        <p className="mt-3 px-1 text-[11px] font-medium tracking-[0.14em] text-subtle uppercase">Group</p>
        <button
          type="button"
          onClick={() => pick({ kind: 'group' })}
          className={cn(
            'mt-1 flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm',
            selected.kind === 'group' ? 'bg-primary-soft' : 'hover:bg-surface-2',
          )}
        >
          <span className="font-medium">All farms</span>
          <span className="text-xs text-muted">{farmsCount} {farmsCount === 1 ? 'farm' : 'farms'}</span>
        </button>

        <ol className="mt-2">
          {filtered.map((node) => (
            <li key={node.farm.id} className="mt-2">
              <button
                type="button"
                onClick={() => pick({ kind: 'farm', id: node.farm.id })}
                className={cn(
                  'flex w-full items-start justify-between gap-2 rounded-lg px-3 py-2.5 text-left',
                  selected.kind === 'farm' && selected.id === node.farm.id ? 'bg-primary-soft' : 'hover:bg-surface-2',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{node.farm.name}</span>
                  <span className="block text-xs text-subtle">{node.farm.location || node.farm.code} · {node.divisions.length} division{node.divisions.length === 1 ? '' : 's'}</span>
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted">{node.head.toLocaleString()} hd</span>
              </button>
              <ul className="ml-4 border-l border-border">
                {node.divisions.map((div) => (
                  <li key={div.name} className="mt-1">
                    <button
                      type="button"
                      onClick={() => pick({ kind: 'division', farmId: node.farm.id, name: div.name })}
                      className={cn(
                        'flex w-full items-center justify-between rounded-md py-2 pr-3 pl-4 text-left text-sm',
                        selected.kind === 'division' && selected.farmId === node.farm.id && selected.name === div.name
                          ? 'bg-primary-soft' : 'hover:bg-surface-2',
                      )}
                    >
                      <span>{div.name}</span>
                      <span className="text-xs text-muted">{div.units.length}</span>
                    </button>
                    <ul>
                      {div.units.map((unit) => {
                        const used = unit.batches.reduce((s, b) => s + b.qty, 0);
                        const hot = unit.batches.some((b) => b.status === 'QUARANTINE');
                        return (
                          <li key={unit.id}>
                            <button
                              type="button"
                              onClick={() => pick({ kind: 'unit', id: unit.id })}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-md py-2 pr-3 pl-8 text-left',
                                selected.kind === 'unit' && selected.id === unit.id ? 'bg-primary-soft' : 'hover:bg-surface-2',
                              )}
                            >
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-sm">{unit.name}</span>
                                <span className="block font-mono text-[11px] text-subtle">{unit.code}</span>
                              </span>
                              {hot && <Badge variant="warning">Q</Badge>}
                              <span className="shrink-0 text-xs text-muted">
                                {used > 0 ? `${used.toLocaleString()} hd` : 'Empty'}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ol>
        {filtered.length === 0 && <p className="px-2 py-8 text-center text-sm text-muted">Nothing matches that search.</p>}
      </div>

      <div className="hidden min-w-0 lg:block">
        <SiteFile selected={selected} forest={forest} units={units} />
      </div>

      <Inspector open={mobileOpen} onOpenChange={setMobileOpen} kicker="Sites" title={title}>
        <SiteFile selected={selected} forest={forest} units={units} />
      </Inspector>
    </div>
  );
}

function SiteFile({ selected, forest, units }: { selected: SitesSel; forest: FarmNode[]; units: SiteUnit[] }) {
  if (selected.kind === 'group') {
    const head = forest.reduce((s, n) => s + n.head, 0);
    const houses = forest.reduce((s, n) => s + n.houses, 0);
    return (
      <Dossier kicker="Group" title="All farms" lede="Every house and flock on the books, grouped the way your farm actually names its places.">
        <dl>
          <Kv label="Farms" value={forest.length} />
          <Kv label="Houses" value={houses} />
          <Kv label="Head on feed" value={head.toLocaleString()} />
        </dl>
        <p className="mt-4 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          Search the tree on the left rather than scrolling — farms → divisions → houses → batches, the same shape whether you have one house or forty.
        </p>
      </Dossier>
    );
  }
  if (selected.kind === 'farm') {
    const node = forest.find((n) => n.farm.id === selected.id);
    if (!node) return null;
    return (
      <Dossier kicker={node.farm.code} title={node.farm.name} lede={node.farm.location || undefined}>
        <dl>
          <Kv label="Divisions" value={node.divisions.map((d) => d.name).join(' · ') || '—'} />
          <Kv label="Houses" value={node.houses} />
          <Kv label="Head" value={node.head.toLocaleString()} />
        </dl>
        <ul className="mt-4 divide-y divide-border">
          {node.divisions.map((d) => (
            <li key={d.name} className="flex items-center justify-between py-2 text-sm">
              <span>{d.name}</span>
              <span className="text-muted">{d.units.length} house{d.units.length === 1 ? '' : 's'}</span>
            </li>
          ))}
        </ul>
      </Dossier>
    );
  }
  if (selected.kind === 'division') {
    const node = forest.find((n) => n.farm.id === selected.farmId);
    const div = node?.divisions.find((d) => d.name === selected.name);
    if (!node || !div) return null;
    const head = div.units.reduce((s, u) => s + u.batches.reduce((a, b) => a + b.qty, 0), 0);
    return (
      <Dossier kicker={node.farm.name} title={div.name} lede="Grouped by what your farm called the unit type — not a guess from species.">
        <dl>
          <Kv label="Houses" value={div.units.length} />
          <Kv label="Head" value={head.toLocaleString()} />
          <Kv label="Active batches" value={div.units.reduce((s, u) => s + u.batches.filter((b) => b.status === 'ACTIVE').length, 0)} />
        </dl>
        <ul className="mt-4 divide-y divide-border">
          {div.units.map((u) => (
            <li key={u.id} className="py-2">
              <p className="text-sm font-medium">{u.name}</p>
              <p className="text-xs text-muted">{u.batches[0] ? `${u.batches[0].code} · ${u.batches.reduce((s, b) => s + b.qty, 0).toLocaleString()} head` : 'Empty'}</p>
            </li>
          ))}
        </ul>
      </Dossier>
    );
  }
  const unit = units.find((u) => u.id === selected.id);
  if (!unit) return null;
  const node = forest.find((n) => n.farm.id === unit.farmId);
  const div = node?.divisions.flatMap((d) => d.units).find((u) => u.id === unit.id);
  const batches = div?.batches ?? [];
  const used = batches.reduce((s, b) => s + b.qty, 0);
  return (
    <Dossier kicker={unit.code} title={unit.name} lede={`${node?.farm.name ?? '—'} · ${divisionLabel(unit.type)}`}>
      <dl>
        <Kv label="Occupancy" value={used > 0 ? `${used.toLocaleString()} head` : 'Empty'} />
        <Kv label="Capacity" value="Not tracked" />
        <Kv label="Batches" value={batches.length || 'None'} />
      </dl>
      {batches.length > 0 ? (
        batches.map((b) => (
          <p key={b.id} className="mt-3 rounded-lg bg-surface-2 px-3 py-2 text-sm">
            <span className="font-medium">{b.label}</span>
            <span className="mt-1 block text-xs text-muted">{b.status} · {b.qty.toLocaleString()} head</span>
          </p>
        ))
      ) : (
        <p className="mt-4 flex items-center gap-2 text-sm text-muted"><Home size={14} className="shrink-0" /> No active flock in this house.</p>
      )}
    </Dossier>
  );
}

function Mini({ k, v }: { k: string; v: string | number }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2 py-2 text-center">
      <p className="font-display text-lg tabular-nums">{v}</p>
      <p className="text-[10px] tracking-wide text-muted uppercase">{k}</p>
    </div>
  );
}

// Re-exported so callers importing an icon-only "Sites" affordance elsewhere
// don't need their own MapPin import — kept minimal, only used if needed.
export const SitesTabIcon = Warehouse;
