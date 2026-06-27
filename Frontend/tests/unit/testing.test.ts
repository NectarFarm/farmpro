import { describe, it, expect } from 'vitest';
import {
  TEST_STEPS, freshRun, applyStepUpdate, progress, canSubmit, summarize, slugify, normalizeSteps,
  addPhotoToStep, allPhotoIds,
} from '@/lib/testing';

describe('freshRun', () => {
  it('produces one pending step per definition, in order', () => {
    const run = freshRun();
    expect(run).toHaveLength(TEST_STEPS.length);
    expect(run.every((s) => s.status === 'pending')).toBe(true);
    expect(run.map((s) => s.id)).toEqual(TEST_STEPS.map((s) => s.id));
  });
  it('has unique step ids', () => {
    const ids = TEST_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('freshRun honours an admin-supplied checklist', () => {
  it('uses the given step definitions instead of the defaults', () => {
    const run = freshRun([{ id: 'a', area: 'X', title: 'T', instruction: 'do it' }]);
    expect(run).toHaveLength(1);
    expect(run[0]).toEqual({ id: 'a', area: 'X', title: 'T', instruction: 'do it', status: 'pending' });
  });
});

describe('slugify', () => {
  it('lowercases and replaces non-alphanumerics with underscores', () => {
    expect(slugify('Sign in works!')).toBe('sign_in_works');
    expect(slugify('  Batch P&L  ')).toBe('batch_p_l');
  });
  it('never returns an empty id', () => {
    expect(slugify('!!!')).toBe('step');
    expect(slugify('')).toBe('step');
  });
});

describe('normalizeSteps (admin-edited checklist)', () => {
  it('derives ids from titles and fills the area default', () => {
    const out = normalizeSteps([{ title: 'Sign in works', instruction: 'log in' }]);
    expect(out).toEqual([{ id: 'sign_in_works', area: 'General', title: 'Sign in works', instruction: 'log in' }]);
  });
  it('de-duplicates ids that collide', () => {
    const out = normalizeSteps([
      { title: 'Check', instruction: 'a' },
      { title: 'Check', instruction: 'b' },
      { title: 'Check', instruction: 'c' },
    ]);
    expect(out.map((s) => s.id)).toEqual(['check', 'check_2', 'check_3']);
  });
  it('keeps an explicit id (slugified)', () => {
    expect(normalizeSteps([{ id: 'My Step', title: 'T', instruction: 'i' }])[0].id).toBe('my_step');
  });
  it('rejects an empty checklist and steps missing title/instruction', () => {
    expect(() => normalizeSteps([])).toThrow(/at least one/i);
    expect(() => normalizeSteps([{ title: '', instruction: 'x' }])).toThrow(/needs a title/i);
    expect(() => normalizeSteps([{ title: 'T', instruction: '  ' }])).toThrow(/needs an instruction/i);
  });
});

describe('applyStepUpdate', () => {
  it('marks a step passed and does not mutate the input', () => {
    const run = freshRun();
    const next = applyStepUpdate(run, { id: 'login', status: 'pass' });
    expect(next.find((s) => s.id === 'login')!.status).toBe('pass');
    expect(run.find((s) => s.id === 'login')!.status).toBe('pending'); // original untouched
  });

  it('records the note on a failure', () => {
    const next = applyStepUpdate(freshRun(), { id: 'sale', status: 'fail', note: '  count did not drop  ' });
    const step = next.find((s) => s.id === 'sale')!;
    expect(step.status).toBe('fail');
    expect(step.note).toBe('count did not drop'); // trimmed
  });

  it('REFUSES a failure with no explanation', () => {
    expect(() => applyStepUpdate(freshRun(), { id: 'sale', status: 'fail' })).toThrow(/describe what went wrong/i);
    expect(() => applyStepUpdate(freshRun(), { id: 'sale', status: 'fail', note: '   ' })).toThrow(/describe what went wrong/i);
  });

  it('clears any stale note when a step is set back to pass/pending', () => {
    let run = applyStepUpdate(freshRun(), { id: 'sale', status: 'fail', note: 'broke' });
    run = applyStepUpdate(run, { id: 'sale', status: 'pass' });
    expect(run.find((s) => s.id === 'sale')!.note).toBeUndefined();
  });

  it('rejects unknown steps and invalid statuses', () => {
    expect(() => applyStepUpdate(freshRun(), { id: 'nope', status: 'pass' })).toThrow(/unknown/i);
    // @ts-expect-error invalid status on purpose
    expect(() => applyStepUpdate(freshRun(), { id: 'login', status: 'maybe' })).toThrow(/invalid status/i);
  });
});

describe('screenshots on failed steps', () => {
  const failed = () => applyStepUpdate(freshRun(), { id: 'login', status: 'fail', note: 'broke' });

  it('attaches a screenshot id to a failed step, up to the max', () => {
    let run = failed();
    run = addPhotoToStep(run, 'login', 'p1', 2);
    run = addPhotoToStep(run, 'login', 'p2', 2);
    expect(run.find((s) => s.id === 'login')!.photoIds).toEqual(['p1', 'p2']);
  });

  it('refuses more than the max per step', () => {
    let run = addPhotoToStep(failed(), 'login', 'p1', 1);
    expect(() => addPhotoToStep(run, 'login', 'p2', 1)).toThrow(/Up to 1 screenshot/i);
    void run;
  });

  it('refuses screenshots when the max is 0 (disabled)', () => {
    expect(() => addPhotoToStep(failed(), 'login', 'p1', 0)).toThrow(/not enabled/i);
  });

  it('refuses a screenshot on a step that is not failed', () => {
    const run = applyStepUpdate(freshRun(), { id: 'login', status: 'pass' });
    expect(() => addPhotoToStep(run, 'login', 'p1', 3)).toThrow(/only attach a screenshot to a step you marked as failed/i);
  });

  it('un-failing a step drops its note AND its screenshots', () => {
    let run = addPhotoToStep(failed(), 'login', 'p1', 3);
    expect(allPhotoIds(run)).toEqual(['p1']);
    run = applyStepUpdate(run, { id: 'login', status: 'pass' });
    const step = run.find((s) => s.id === 'login')!;
    expect(step.note).toBeUndefined();
    expect(step.photoIds).toBeUndefined();
    expect(allPhotoIds(run)).toEqual([]); // so the server knows to delete p1
  });

  it('summarize carries each failure\'s screenshot ids for the admin', () => {
    const run = addPhotoToStep(failed(), 'login', 'p1', 3);
    expect(summarize(run).failures.find((f) => f.id === 'login')!.photoIds).toEqual(['p1']);
  });
});

describe('progress', () => {
  it('counts pending / passed / failed and points to the next pending step', () => {
    let run = freshRun();
    run = applyStepUpdate(run, { id: run[0].id, status: 'pass' });
    run = applyStepUpdate(run, { id: run[1].id, status: 'fail', note: 'x' });
    const p = progress(run);
    expect(p.total).toBe(TEST_STEPS.length);
    expect(p.passed).toBe(1);
    expect(p.failed).toBe(1);
    expect(p.done).toBe(2);
    expect(p.pendingCount).toBe(TEST_STEPS.length - 2);
    expect(p.nextPending!.id).toBe(run[2].id); // first still-pending step
    expect(p.complete).toBe(false);
  });

  it('is complete with no next step once all are answered', () => {
    let run = freshRun();
    for (const s of run) run = applyStepUpdate(run, { id: s.id, status: 'pass' });
    const p = progress(run);
    expect(p.complete).toBe(true);
    expect(p.nextPending).toBeNull();
    expect(p.pendingCount).toBe(0);
  });
});

describe('canSubmit', () => {
  it('is false while any step is pending, true once all are answered', () => {
    let run = freshRun();
    expect(canSubmit(run)).toBe(false);
    for (let i = 0; i < run.length - 1; i++) run = applyStepUpdate(run, { id: run[i].id, status: 'pass' });
    expect(canSubmit(run)).toBe(false);           // one still pending
    run = applyStepUpdate(run, { id: run[run.length - 1].id, status: 'fail', note: 'x' });
    expect(canSubmit(run)).toBe(true);            // a failure still counts as "answered"
  });
  it('is false for an empty checklist', () => {
    expect(canSubmit([])).toBe(false);
  });
});

describe('summarize (the admin report)', () => {
  it('tallies results and lists every failure with its note', () => {
    let run = freshRun();
    run = applyStepUpdate(run, { id: 'login', status: 'pass' });
    run = applyStepUpdate(run, { id: 'sale', status: 'fail', note: 'live count did not drop' });
    run = applyStepUpdate(run, { id: 'reports', status: 'fail', note: 'PDF was empty' });
    for (const s of run) if (s.status === 'pending') run = applyStepUpdate(run, { id: s.id, status: 'pass' });

    const rep = summarize(run);
    expect(rep.total).toBe(TEST_STEPS.length);
    expect(rep.failed).toBe(2);
    expect(rep.passed).toBe(TEST_STEPS.length - 2);
    expect(rep.complete).toBe(true);
    expect(rep.failures.map((f) => f.id).sort()).toEqual(['reports', 'sale']);
    expect(rep.failures.find((f) => f.id === 'sale')!.note).toBe('live count did not drop');
  });
});
