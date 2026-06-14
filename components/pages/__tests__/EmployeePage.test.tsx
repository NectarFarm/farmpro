import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { useFarmStore } from '@/lib/store';
import type { Flock, FlockStageConfig, FeedInventory } from '@/lib/types';
import EmployeePage from '@/components/pages/EmployeePage';

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }));

const STAGES: FlockStageConfig[] = [
  { id: 'brooder', name: 'Brooder', displayOrder: 0, role: null, pricePerBird: 150 },
  { id: 'layer', name: 'Layer', displayOrder: 2, role: null, pricePerBird: 600 },
  { id: 'sold', name: 'Sold', displayOrder: 4, role: 'sold', pricePerBird: 0 },
];

function flock(over: Partial<Flock>): Flock {
  return {
    id: 'x', name: 'X', dateAcquired: '2026-01-01', source: 's',
    initialCount: 10, currentCount: 10, purchaseCostPerChick: 100,
    initialWeight: 0.04, breed: 'b', stage: 'layer', createdAt: '',
    ...over,
  };
}

const inventory: FeedInventory[] = [
  { id: 'i1', feedType: 'layer', currentStockKg: 100, reorderLevelKg: 20, lastUpdated: '' },
];

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({}) })));
  useFarmStore.setState({
    session: { type: 'employee', employeeName: 'Test', loginAt: '' },
    flockStages: STAGES,
    feedInventory: inventory,
    eggCollections: [], feedDispenseRecords: [], mortalityRecords: [],
    flocks: [
      flock({ id: 'active-layer', name: 'Active Layer', stage: 'layer' }),
      flock({ id: 'active-brooder', name: 'Active Brooder', stage: 'brooder' }),
      flock({ id: 'sold-batch', name: 'Sold Batch', stage: 'sold' }),
    ],
  });
});

afterEach(() => cleanup());

describe('EmployeePage flock dropdowns', () => {
  it('lists active (non-terminal) flocks in the data-entry dropdowns', () => {
    render(<EmployeePage />);
    const optionTexts = screen.getAllByRole('option').map(o => o.textContent ?? '');
    expect(optionTexts.some(t => t.includes('Active Layer'))).toBe(true);
    expect(optionTexts.some(t => t.includes('Active Brooder'))).toBe(true);
  });

  it('excludes terminal (sold) flocks from every dropdown', () => {
    render(<EmployeePage />);
    const optionTexts = screen.getAllByRole('option').map(o => o.textContent ?? '');
    expect(optionTexts.some(t => t.includes('Sold Batch'))).toBe(false);
  });

  it('shows the egg-collection dropdown even when no flock has the literal "layer" stage id', () => {
    // Simulate a farmer who renamed their laying stage to a custom id.
    useFarmStore.setState({
      flockStages: [
        { id: 'production', name: 'Production', displayOrder: 2, role: null, pricePerBird: 600 },
        { id: 'sold', name: 'Sold', displayOrder: 4, role: 'sold', pricePerBird: 0 },
      ],
      flocks: [flock({ id: 'p1', name: 'Custom Production Flock', stage: 'production' })],
    });
    render(<EmployeePage />);
    const optionTexts = screen.getAllByRole('option').map(o => o.textContent ?? '');
    // The custom-stage flock must still be selectable (would have been empty under the old hardcoded filter).
    expect(optionTexts.some(t => t.includes('Custom Production Flock'))).toBe(true);
  });
});
