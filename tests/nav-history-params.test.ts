// ── History stack params restoration (issue #320) ──────────────────────────
// Before this fix, NavProvider's `history` was a plain ScreenId[] stack, and
// goBack() unconditionally called setParams({}) after popping — so any
// params-dependent detail screen (batch-detail, inventory-detail,
// people-detail, batch-detail) reached through 2+ levels of back
// navigation rendered "not found" once an intermediate goBack() wiped its
// params. e.g. Batch Detail -> Crop Schedule -> Batch Detail -> back ->
// back landed on batch-detail with params: {} instead of the original
// { id: <batchId> }.
//
// The fix stores { screen, params } pairs in history (each entry capturing
// the params that were active for the screen being *left*, at push time)
// and goBack() restores both. pushHistoryEntry/popHistoryEntry are pure
// functions (no JSX, no hooks) exported from components/farm/navigation.tsx,
// so — same pattern as tests/nav-tab-badges.test.ts (issue #298) — they can
// be imported and exercised directly with plain argument-driven assertions,
// without a DOM/render harness.
import { describe, it, expect } from 'vitest'
import { pushHistoryEntry, popHistoryEntry, type HistoryEntry, type ScreenId } from '@/components/farm/navigation'

describe('pushHistoryEntry / popHistoryEntry (issue #320)', () => {
  it('push appends without mutating the input array', () => {
    const h: HistoryEntry[] = []
    const h1 = pushHistoryEntry(h, { screen: 'crops', params: {} })
    expect(h).toEqual([]) // original untouched
    expect(h1).toEqual([{ screen: 'crops', params: {} }])
  })

  it('pop on an empty stack returns entry:null and the same (empty) history', () => {
    const h: HistoryEntry[] = []
    const { history, entry } = popHistoryEntry(h)
    expect(entry).toBeNull()
    expect(history).toEqual([])
  })

  it('pop returns the last-pushed entry and the remaining stack, without mutating the input', () => {
    const h: HistoryEntry[] = [
      { screen: 'crops', params: {} },
      { screen: 'batch-detail', params: { id: 'batch-1' } },
    ]
    const { history, entry } = popHistoryEntry(h)
    expect(entry).toEqual({ screen: 'batch-detail', params: { id: 'batch-1' } })
    expect(history).toEqual([{ screen: 'crops', params: {} }])
    expect(h.length).toBe(2) // original untouched
  })

  it('reproduces the full Batch Detail -> Crop Schedule -> Batch Detail -> back -> back flow', () => {
    // Simulates NavProvider's navigate()/goBack() using the extracted stack
    // functions, mirroring exactly what navigation.tsx now does:
    //   navigate: history = push(history, { screen: current, params }); current = dest; params = p
    //   goBack:   { history, entry } = pop(history); if entry: current = entry.screen; params = entry.params
    let history: HistoryEntry[] = []
    let current: ScreenId = 'batch-detail'
    let params: Record<string, string> = { id: 'batch-42' }

    function navigate(dest: ScreenId, p?: Record<string, string>) {
      history = pushHistoryEntry(history, { screen: current, params })
      current = dest
      params = p ?? {}
    }
    function goBack() {
      const popped = popHistoryEntry(history)
      if (!popped.entry) return
      history = popped.history
      current = popped.entry.screen
      params = popped.entry.params
    }

    // Batch Detail (id: batch-42) -> Crop Schedule (batchId: batch-42)
    navigate('crop-schedule', { batchId: 'batch-42' })
    expect(current).toBe('crop-schedule')
    expect(params).toEqual({ batchId: 'batch-42' })

    // Crop Schedule -> Batch Detail (batchId: batch-42, stage: brooding).
    // Any third params-carrying screen exercises this; it used to be
    // 'process-config', which was removed as dead UI (every control in it was
    // disabled and it saved nothing — the real feature is Routines).
    navigate('batch-detail', { batchId: 'batch-42', stage: 'brooding' })
    expect(current).toBe('batch-detail')
    expect(params).toEqual({ batchId: 'batch-42', stage: 'brooding' })

    // back #1: -> Crop Schedule, params restored to { batchId: batch-42 }
    goBack()
    expect(current).toBe('crop-schedule')
    expect(params).toEqual({ batchId: 'batch-42' })

    // back #2: -> Batch Detail, params restored to the ORIGINAL { id: batch-42 }
    // (the old behavior would show params: {} here -> "Batch not found")
    goBack()
    expect(current).toBe('batch-detail')
    expect(params).toEqual({ id: 'batch-42' })
    expect(history).toEqual([])
  })

  it('same 2-level pattern holds for Inventory Detail nested navigation', () => {
    let history: HistoryEntry[] = []
    let current: ScreenId = 'inventory-detail'
    let params: Record<string, string> = { id: 'item-7' }

    function navigate(dest: ScreenId, p?: Record<string, string>) {
      history = pushHistoryEntry(history, { screen: current, params })
      current = dest
      params = p ?? {}
    }
    function goBack() {
      const popped = popHistoryEntry(history)
      if (!popped.entry) return
      history = popped.history
      current = popped.entry.screen
      params = popped.entry.params
    }

    navigate('inventory', {}) // e.g. drills into a filtered list view
    navigate('settings', {}) // then wanders further before backing out

    goBack()
    expect(current).toBe('inventory')
    expect(params).toEqual({})

    goBack()
    expect(current).toBe('inventory-detail')
    expect(params).toEqual({ id: 'item-7' })
  })

  it('same 2-level pattern holds for People Detail nested navigation', () => {
    let history: HistoryEntry[] = []
    let current: ScreenId = 'people-detail'
    let params: Record<string, string> = { id: 'emp-3' }

    function navigate(dest: ScreenId, p?: Record<string, string>) {
      history = pushHistoryEntry(history, { screen: current, params })
      current = dest
      params = p ?? {}
    }
    function goBack() {
      const popped = popHistoryEntry(history)
      if (!popped.entry) return
      history = popped.history
      current = popped.entry.screen
      params = popped.entry.params
    }

    navigate('inventory-detail', { id: 'emp-3' })
    navigate('reports', {})

    goBack()
    expect(current).toBe('inventory-detail')
    expect(params).toEqual({ id: 'emp-3' })

    goBack()
    expect(current).toBe('people-detail')
    expect(params).toEqual({ id: 'emp-3' })
  })
})
