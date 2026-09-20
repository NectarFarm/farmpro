// ── Dimensions screen UI regression guards (dimensions-operable task) ──────
// This repo has no component-level test harness (vitest only, no jsdom/RTL
// — see tests/crops-batch-detail-ui.test.ts's header for the same note), so
// this file asserts on the actual component source for the two things that
// have no server-side route to test through: the "Inactive" bug and the
// Required Dimensions control's wiring to the real `requirement` values.
// Negatives are anchored to rendered JSX/behaviour, not comments — a bare
// `not.toMatch(/phrase/)` would also match this file's own header prose.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const source = readFileSync(join(process.cwd(), 'components/farm/dimensions.tsx'), 'utf8')

describe('components/farm/dimensions.tsx — the "Inactive" bug (item 2)', () => {
  it('no longer reads a fictitious `active` field the schema never had', () => {
    // The bug: `Dimension` used to declare `active: boolean`, and the badge
    // read `!d.active` — always true, since the API row never carried one.
    expect(source).not.toMatch(/active:\s*boolean/);
    expect(source).not.toMatch(/!d\.active/);
    expect(source).not.toMatch(/\{!d\.active/);
  });

  it('the Dimension type declares the REAL `archived` column instead', () => {
    expect(source).toMatch(/type Dimension = \{[\s\S]*?archived: boolean/);
  });

  it('the register renders an Archived chip from the real field, not an invented one', () => {
    expect(source).toMatch(/d\.archived && <span className="chip chip-critical"/);
  });
});

describe('components/farm/dimensions.tsx — Required Dimensions panel (item 1)', () => {
  it('a Yes control writes requirement "required"', () => {
    expect(source).toMatch(/setRequirement\(dim, 'required'\)/);
  });
  it('a No control writes requirement "optional"', () => {
    expect(source).toMatch(/setRequirement\(dim, 'optional'\)/);
  });
  it('the Blocked state is kept, not dropped for a plain Yes\/No', () => {
    expect(source).toMatch(/setRequirement\(dim, 'blocked'\)/);
  });
  it('writes through the real per-tenant defaults endpoint, not a local-only toggle', () => {
    expect(source).toMatch(/apiClient\.post\('\/api\/dimensions\/defaults', \{/);
  });
  it('states on screen that the account itself is read-only and shared platform-wide', () => {
    expect(source).toMatch(/shared by every farm on the platform/);
    expect(source).toMatch(/Read-only/);
  });
});

describe('components/farm/dimensions.tsx — Analysis Dimensions register (item 3)', () => {
  const REQUIRED_COLUMNS = ['DIMENSION ID', 'NAME', 'SHORT NAME', 'SEGMENTS', 'SEPARATOR', 'BUDGET CHECK', 'BUDGET CONTROL', 'ACTIONS'];
  it('renders every column from the owner\'s screenshot', () => {
    for (const col of REQUIRED_COLUMNS) expect(source).toContain(col);
  });
  it('has an Export action and shows a row count', () => {
    expect(source).toMatch(/exportCsv/);
    expect(source).toMatch(/dimension\{dimensions\.length === 1 \? '' : 's'\}/);
  });
  it('rides in a horizontally scrolling container rather than being redesigned for 360px', () => {
    expect(source).toMatch(/overflowX: 'auto'/);
  });
});

describe('components/farm/dimensions.tsx — editing and archiving (item 4)', () => {
  it('a user-defined dimension can be edited and archived, gated on isSystem', () => {
    expect(source).toMatch(/!d\.isSystem && \(/);
    expect(source).toMatch(/onArchiveToggle/);
  });
  it('a user-defined value can be renamed and archived, gated on canEditValue', () => {
    expect(source).toMatch(/canEditValue = \(v: DimensionValue\) => !dimension\.isSystem && !v\.sourceType/);
  });
});
