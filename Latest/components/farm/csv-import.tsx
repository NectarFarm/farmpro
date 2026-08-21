'use client';
// ============================================================
// csv-import.tsx — Shared CSV Import Modal with full validation
// Used by: TasksScreen, PeopleScreen, InventoryScreen
//
// Flow:
//   1. User uploads a CSV (exported from the app or from template)
//   2. Header row is parsed and compared against expected columns
//   3. Each row is validated — required fields, formats, cross-refs
//   4. Issues shown per-row with colour coding:
//       • error   = import blocked until fixed
//       • warning = importable but suspicious (typo? wrong ref?)
//       • info    = auto-correction applied (trimmed, uppercased, etc.)
//   5. User can edit cell values inline before confirming
//   6. "Fix All Auto" applies all safe auto-corrections
//   7. Import proceeds only for rows with no remaining errors
// ============================================================

import React, { useState, useRef, useCallback } from 'react';
import { X, Check, AlertTriangle, Download, RefreshCw, Edit2, ChevronDown, ChevronUp } from './icons';
import { OWNER_ROLES, downloadCSV } from './data';
import { apiClient } from '@/lib/request';

/* ─────────────────────────────────────────────────────────────
   Validation types
───────────────────────────────────────────────────────────── */
export type IssueSeverity = 'error' | 'warning' | 'info';

export interface CellIssue {
  col: string;
  severity: IssueSeverity;
  message: string;
  suggestion?: string;    // proposed fix value
  autoFix?: boolean;      // if true, "Fix All Auto" will apply this
}

export interface RowResult {
  rowIndex: number;        // 0-based (excludes header)
  original: Record<string, string>;
  edited: Record<string, string>;
  issues: CellIssue[];
  importable: boolean;     // no error-severity issues remain
}

/* ─────────────────────────────────────────────────────────────
   Regex helpers
───────────────────────────────────────────────────────────── */
const RE_EMP_CODE    = /^EMP-[A-Z]{3}-\d{3}$/;
const RE_TASK_CODE   = /^TSK-[A-Z]{3}-\d{4}$/;
const RE_BATCH_CODE  = /^[A-Z]{2,4}-[A-Z]{3}-\d{3}$/;
const RE_FARM_CODE   = /^FRM-[A-Z]{3}-\d{3}$/;
const RE_INV_ID      = /^[A-Z]\d{3}$/;           // F001, M002, V003
const RE_DATE        = /^\d{4}-\d{2}-\d{2}$/;
const RE_TIME        = /^\d{2}:\d{2}$/;
const RE_PHONE_KE    = /^\+254-\d{3}-\d{3}-\d{3}$/;
const RE_PHONE_LOOSE = /^\+?\d[\d\s\-()]{7,}$/;
const RE_EMAIL       = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fuzzyMatchCode(value: string, validCodes: string[]): string | null {
  if (!value) return null;
  const v = value.trim().toUpperCase();
  // Exact match first
  if (validCodes.includes(v)) return v;
  // Levenshtein ≤ 2
  for (const c of validCodes) {
    if (levenshtein(v, c) <= 2) return c;
  }
  return null;
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      d[i][j] = a[i-1] === b[j-1] ? d[i-1][j-1] : 1 + Math.min(d[i-1][j], d[i][j-1], d[i-1][j-1]);
  return d[m][n];
}

/* ─────────────────────────────────────────────────────────────
   CSV parser (handles quoted fields, escaped quotes)
───────────────────────────────────────────────────────────── */
export function parseCSVText(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim().split('\n');
  if (lines.length === 0) return { headers: [], rows: [] };

  function parseLine(line: string): string[] {
    const result: string[] = [];
    let cur = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuote && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuote = !inQuote;
      } else if (ch === ',' && !inQuote) { result.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    result.push(cur.trim());
    return result;
  }

  const headers = parseLine(lines[0]).map(h => h.replace(/^"|"$/g, '').trim());
  const rows = lines.slice(1).filter(l => l.trim()).map(line => {
    const vals = parseLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = (vals[i] ?? '').replace(/^"|"$/g, '').trim(); });
    return row;
  });
  return { headers, rows };
}

/* ─────────────────────────────────────────────────────────────
   Validation engines per entity type
───────────────────────────────────────────────────────────── */
export type ImportEntity = 'tasks' | 'employees' | 'inventory' | 'external_workers';

const VALID_TASK_TYPES = ['feeding','egg-collection','milking','mortality','health','physical-count','harvest','weight','weed','spray','ploughing','stock-count','custom'];
const VALID_FREQUENCIES = ['once','daily','weekly','on-demand'];
const VALID_PRIORITIES  = ['high','medium','low'];
const VALID_STATUSES    = ['PENDING','DONE','OVERDUE','APPROVED','REJECTED'];
const VALID_ROLES       = OWNER_ROLES.map(r => r.id);

// Reference checks (does this batch/farm/role exist?) are NOT done here any
// more. They used to run against EMPLOYEES_DATA / BATCHES_DATA / TASKS_DATA —
// static fixtures in ./data — so a farmer's real batch codes were rejected
// while fixture-only codes passed. POST /api/imports/validate now answers
// those against the tenant's own rows; what stays below is pure format
// checking that needs no database.

function validateTask(row: Record<string, string>, allRows: Record<string, string>[], rowIdx: number): CellIssue[] {
  const issues: CellIssue[] = [];
  const v = (col: string) => (row[col] ?? '').trim();

  // ── code ──
  const code = v('code');
  if (!code) {
    issues.push({ col: 'code', severity: 'error', message: 'Task code is required', suggestion: `TSK-KMU-${String(9000 + rowIdx).padStart(4, '0')}`, autoFix: true });
  } else if (!RE_TASK_CODE.test(code)) {
    const fixed = code.toUpperCase().replace(/\s+/g, '-');
    issues.push({ col: 'code', severity: 'warning', message: `Code "${code}" doesn't match TSK-XXX-0000 pattern`, suggestion: fixed, autoFix: true });
  }
  // duplicate within import batch
  const dupeInBatch = allRows.some((r, i) => i !== rowIdx && (r.code ?? '') === code && code !== '');
  if (dupeInBatch) issues.push({ col: 'code', severity: 'error', message: 'Duplicate code in this import file' });
  // already exists in system

  // ── title ──
  const title = v('title');
  if (!title) {
    issues.push({ col: 'title', severity: 'error', message: 'Title is required' });
  } else if (title.length < 5) {
    issues.push({ col: 'title', severity: 'warning', message: 'Title seems too short — is it complete?' });
  }

  // ── type ──
  const type = v('type');
  if (!type) {
    issues.push({ col: 'type', severity: 'error', message: 'Task type is required', suggestion: 'feeding', autoFix: false });
  } else if (!VALID_TASK_TYPES.includes(type)) {
    const match = fuzzyMatchCode(type, VALID_TASK_TYPES);
    issues.push({ col: 'type', severity: 'warning', message: `"${type}" is not a known type${match ? ` — did you mean "${match}"?` : ''}`, suggestion: match ?? undefined, autoFix: !!match });
  }

  // ── assigneeCode ──
  const aCode = v('assigneeCode');
  if (!aCode) {
    issues.push({ col: 'assigneeCode', severity: 'error', message: 'assigneeCode is required (employee code or GROUP:roleId)' });
  } else if (!aCode.startsWith('GROUP:')) {
    // Format only — whether this employee exists is the server's call.
    if (!RE_EMP_CODE.test(aCode)) {
      issues.push({ col: 'assigneeCode', severity: 'warning', message: `"${aCode}" is not in the EMP-XXX-000 format` });
    }
  } else {
    const roleId = aCode.replace('GROUP:', '');
    if (!VALID_ROLES.includes(roleId) && roleId !== 'all') {
      issues.push({ col: 'assigneeCode', severity: 'warning', message: `Role "${roleId}" not defined. Valid: ${VALID_ROLES.join(', ')}, all` });
    }
  }

  // ── batchCode ──
  // Format only. Whether the batch exists is checked server-side against the
  // tenant's real batches, not against a fixture list.
  const bCode = v('batchCode');
  if (bCode && !RE_BATCH_CODE.test(bCode)) {
    issues.push({ col: 'batchCode', severity: 'warning', message: `"${bCode}" is not in the expected batch-code format` });
  }

  // ── dates ──
  const startDate = v('startDate');
  if (!startDate) {
    issues.push({ col: 'startDate', severity: 'error', message: 'Start date is required', suggestion: new Date().toISOString().slice(0,10), autoFix: true });
  } else if (!RE_DATE.test(startDate)) {
    issues.push({ col: 'startDate', severity: 'error', message: `Date must be YYYY-MM-DD, got "${startDate}"` });
  }
  const endDate = v('endDate');
  if (endDate && !RE_DATE.test(endDate)) {
    issues.push({ col: 'endDate', severity: 'error', message: `End date must be YYYY-MM-DD, got "${endDate}"` });
  }
  if (startDate && endDate && RE_DATE.test(startDate) && RE_DATE.test(endDate) && endDate < startDate) {
    issues.push({ col: 'endDate', severity: 'error', message: 'End date is before start date' });
  }

  // ── dueTime ──
  const dueTime = v('dueTime');
  if (dueTime && !RE_TIME.test(dueTime)) {
    issues.push({ col: 'dueTime', severity: 'warning', message: `Time should be HH:MM, got "${dueTime}"` });
  }

  // ── frequency ──
  const freq = v('frequency');
  if (!freq) {
    issues.push({ col: 'frequency', severity: 'error', message: 'Frequency is required', suggestion: 'once', autoFix: true });
  } else if (!VALID_FREQUENCIES.includes(freq)) {
    const match = fuzzyMatchCode(freq, VALID_FREQUENCIES);
    issues.push({ col: 'frequency', severity: 'warning', message: `"${freq}" is not valid. Valid: ${VALID_FREQUENCIES.join(', ')}`, suggestion: match ?? 'once', autoFix: !!match });
  }

  // ── priority ──
  const pri = v('priority');
  if (!pri) {
    issues.push({ col: 'priority', severity: 'warning', message: 'Priority missing — will default to medium', suggestion: 'medium', autoFix: true });
  } else if (!VALID_PRIORITIES.includes(pri)) {
    const match = fuzzyMatchCode(pri, VALID_PRIORITIES);
    issues.push({ col: 'priority', severity: 'warning', message: `"${pri}" is not valid. Valid: ${VALID_PRIORITIES.join(', ')}`, suggestion: match ?? 'medium', autoFix: !!match });
  }

  // ── maxPhotos ──
  const mp = v('maxPhotos');
  if (mp !== '' && mp !== undefined) {
    const n = parseInt(mp);
    if (isNaN(n) || n < 0 || n > 20) {
      issues.push({ col: 'maxPhotos', severity: 'warning', message: `maxPhotos should be 0–20 or blank, got "${mp}"`, suggestion: '', autoFix: true });
    }
  }

  // ── lat/lng ──
  const lat = v('lat'), lng = v('lng');
  if (lat && (isNaN(parseFloat(lat)) || Math.abs(parseFloat(lat)) > 90)) {
    issues.push({ col: 'lat', severity: 'error', message: `Latitude "${lat}" is not valid (must be -90 to 90)` });
  }
  if (lng && (isNaN(parseFloat(lng)) || Math.abs(parseFloat(lng)) > 180)) {
    issues.push({ col: 'lng', severity: 'error', message: `Longitude "${lng}" is not valid (must be -180 to 180)` });
  }
  if ((lat && !lng) || (!lat && lng)) {
    issues.push({ col: lat ? 'lng' : 'lat', severity: 'warning', message: 'Both lat and lng must be provided together, or both left blank' });
  }

  return issues;
}

function validateEmployee(row: Record<string, string>, allRows: Record<string, string>[], rowIdx: number): CellIssue[] {
  const issues: CellIssue[] = [];
  const v = (col: string) => (row[col] ?? '').trim();

  // ── code ──
  const code = v('code');
  if (!code) {
    issues.push({ col: 'code', severity: 'error', message: 'Employee code is required', suggestion: `EMP-KMU-${String(100 + rowIdx).padStart(3, '0')}`, autoFix: true });
  } else if (!RE_EMP_CODE.test(code)) {
    const fixed = code.toUpperCase().replace(/\s+/g, '-');
    issues.push({ col: 'code', severity: 'warning', message: `Code "${code}" should match EMP-XXX-000 format — e.g. EMP-KMU-007`, suggestion: fixed, autoFix: false });
  }
  const dupeInBatch = allRows.some((r, i) => i !== rowIdx && (r.code ?? '') === code && code !== '');
  if (dupeInBatch) issues.push({ col: 'code', severity: 'error', message: 'Duplicate code within this import file' });

  // ── name ──
  const name = v('name');
  if (!name) {
    issues.push({ col: 'name', severity: 'error', message: 'Name is required' });
  } else if (name.length < 3) {
    issues.push({ col: 'name', severity: 'warning', message: 'Name seems very short — is it complete?' });
  } else if (!/^[A-Za-z\s\-'.]+$/.test(name)) {
    issues.push({ col: 'name', severity: 'info', message: `Name "${name}" has unusual characters — verify spelling`, autoFix: false });
  }

  // ── role ──
  const role = v('role');
  if (!role) {
    issues.push({ col: 'role', severity: 'error', message: 'Role is required', suggestion: 'worker', autoFix: true });
  } else if (!VALID_ROLES.includes(role)) {
    const match = fuzzyMatchCode(role, VALID_ROLES);
    issues.push({ col: 'role', severity: 'warning', message: `Role "${role}" not defined. Valid: ${VALID_ROLES.join(', ')}${match ? ` — did you mean "${match}"?` : ''}`, suggestion: match ?? 'worker', autoFix: !!match });
  }

  // ── phone ──
  const phone = v('phone');
  if (!phone) {
    issues.push({ col: 'phone', severity: 'warning', message: "Phone is missing — employee won't receive SMS notifications" });
  } else if (!RE_PHONE_KE.test(phone)) {
    if (RE_PHONE_LOOSE.test(phone)) {
      // Try to auto-format Kenyan number
      const digits = phone.replace(/\D/g, '');
      let suggestion = phone;
      if (digits.length === 10 && digits.startsWith('07')) {
        suggestion = `+254-${digits.slice(1,4)}-${digits.slice(4,7)}-${digits.slice(7)}`;
      } else if (digits.length === 12 && digits.startsWith('254')) {
        suggestion = `+254-${digits.slice(3,6)}-${digits.slice(6,9)}-${digits.slice(9)}`;
      }
      issues.push({ col: 'phone', severity: 'info', message: `Phone "${phone}" — expected +254-XXX-XXX-XXX format`, suggestion, autoFix: suggestion !== phone });
    } else {
      issues.push({ col: 'phone', severity: 'warning', message: `Phone "${phone}" doesn't look like a valid number` });
    }
  }

  // ── salary ──
  const salary = v('salary');
  if (!salary) {
    issues.push({ col: 'salary', severity: 'warning', message: "Salary missing — employee won't appear in payroll calculations" });
  } else if (isNaN(parseFloat(salary)) || parseFloat(salary) < 0) {
    issues.push({ col: 'salary', severity: 'error', message: `Salary "${salary}" is not a valid number` });
  } else if (parseFloat(salary) < 5000) {
    issues.push({ col: 'salary', severity: 'warning', message: `Salary KSh ${salary} seems low — confirm it's correct` });
  }

  // ── payday ──
  const payday = v('payday');
  if (payday) {
    const n = parseInt(payday);
    if (isNaN(n) || n < 1 || n > 31) {
      issues.push({ col: 'payday', severity: 'warning', message: `Payday "${payday}" should be 1–31`, suggestion: '28', autoFix: true });
    }
  }

  // ── startDate ──
  const startDate = v('startDate');
  if (!startDate) {
    issues.push({ col: 'startDate', severity: 'error', message: 'Start date is required', suggestion: new Date().toISOString().slice(0,10), autoFix: true });
  } else if (!RE_DATE.test(startDate)) {
    issues.push({ col: 'startDate', severity: 'error', message: `Start date must be YYYY-MM-DD, got "${startDate}"` });
  }
  const endDate = v('endDate');
  if (endDate && !RE_DATE.test(endDate)) {
    issues.push({ col: 'endDate', severity: 'error', message: `End date must be YYYY-MM-DD, got "${endDate}"` });
  }
  if (startDate && endDate && RE_DATE.test(startDate) && RE_DATE.test(endDate) && endDate < startDate) {
    issues.push({ col: 'endDate', severity: 'error', message: 'Contract end date is before start date' });
  }

  // ── batches ──
  // Batch codes are validated server-side against the tenant's real batches
  // (POST /api/imports/validate) — there is nothing useful to check here
  // without the database.

  // ── active ──
  const active = v('active');
  if (active && active !== 'true' && active !== 'false') {
    issues.push({ col: 'active', severity: 'info', message: `"${active}" should be "true" or "false"`, suggestion: 'true', autoFix: true });
  }

  return issues;
}

function validateInventory(row: Record<string, string>, allRows: Record<string, string>[], rowIdx: number): CellIssue[] {
  const issues: CellIssue[] = [];
  const v = (col: string) => (row[col] ?? '').trim();

  // ── id ──
  const id = v('id');
  if (!id) {
    issues.push({ col: 'id', severity: 'error', message: 'Item ID is required (e.g. F001, M002)' });
  } else if (!RE_INV_ID.test(id)) {
    issues.push({ col: 'id', severity: 'warning', message: `ID "${id}" should be a letter + 3 digits (F001, M002, V003)` });
  }
  const dupeInBatch = allRows.some((r, i) => i !== rowIdx && (r.id ?? '') === id && id !== '');
  if (dupeInBatch) issues.push({ col: 'id', severity: 'error', message: 'Duplicate ID in this import file' });

  // ── name ──
  if (!v('name')) issues.push({ col: 'name', severity: 'error', message: 'Item name is required' });

  // ── category ──
  const category = v('category');
  const validCats = ['Feed','Medicine','Equipment','Seed','Chemical','Packaging','Other'];
  if (!category) {
    issues.push({ col: 'category', severity: 'warning', message: 'Category missing — will default to Other', suggestion: 'Other', autoFix: true });
  } else if (!validCats.includes(category)) {
    const match = validCats.find(c => c.toLowerCase() === category.toLowerCase());
    issues.push({ col: 'category', severity: 'info', message: `Category "${category}" — valid options: ${validCats.join(', ')}`, suggestion: match ?? 'Other', autoFix: !!match });
  }

  // ── qty ──
  const qty = v('qty');
  if (!qty) {
    issues.push({ col: 'qty', severity: 'error', message: 'Quantity is required' });
  } else if (isNaN(parseFloat(qty)) || parseFloat(qty) < 0) {
    issues.push({ col: 'qty', severity: 'error', message: `Quantity "${qty}" is not a valid positive number` });
  }

  // ── reorder ──
  const reorder = v('reorder');
  if (reorder && isNaN(parseFloat(reorder))) {
    issues.push({ col: 'reorder', severity: 'warning', message: `Reorder level "${reorder}" is not a number` });
  }
  if (qty && reorder && !isNaN(parseFloat(qty)) && !isNaN(parseFloat(reorder)) && parseFloat(qty) < parseFloat(reorder)) {
    issues.push({ col: 'qty', severity: 'info', message: `Current qty (${qty}) is below reorder level (${reorder}) — this item will show as low stock immediately` });
  }

  // ── costPerUnit ──
  const cost = v('costPerUnit');
  if (!cost) {
    issues.push({ col: 'costPerUnit', severity: 'warning', message: "Cost per unit missing — valuation reports won't include this item" });
  } else if (isNaN(parseFloat(cost)) || parseFloat(cost) < 0) {
    issues.push({ col: 'costPerUnit', severity: 'error', message: `Cost "${cost}" is not a valid number` });
  }

  // ── expiryDate ──
  const exp = v('expiryDate');
  if (exp && !RE_DATE.test(exp)) {
    issues.push({ col: 'expiryDate', severity: 'warning', message: `Expiry date "${exp}" should be YYYY-MM-DD` });
  }
  if (exp && RE_DATE.test(exp) && exp < new Date().toISOString().slice(0,10)) {
    issues.push({ col: 'expiryDate', severity: 'warning', message: `Item appears to have expired (${exp})` });
  }

  return issues;
}

export function validateRows(entity: ImportEntity, rows: Record<string, string>[]): RowResult[] {
  return rows.map((row, i) => {
    let issues: CellIssue[] = [];
    if (entity === 'tasks') issues = validateTask(row, rows, i);
    else if (entity === 'employees') issues = validateEmployee(row, rows, i);
    else if (entity === 'inventory') issues = validateInventory(row, rows, i);
    const hasErrors = issues.some(is => is.severity === 'error');
    return {
      rowIndex: i,
      original: { ...row },
      edited: { ...row },
      issues,
      importable: !hasErrors,
    };
  });
}

/* ─────────────────────────────────────────────────────────────
   Column definitions for display
───────────────────────────────────────────────────────────── */
const ENTITY_EXPECTED_COLS: Record<ImportEntity, string[]> = {
  tasks: ['code','title','type','assigneeCode','batchCode','unitCode','location','lat','lng','startDate','endDate','dueTime','frequency','requiresApproval','priority','maxPhotos','notes'],
  // Aligned to what POST /api/employees actually stores. The old template
  // demanded a `code` (employees have no code column at all), plus salary and
  // payday — there is no payroll table in this app, so those were collected
  // and silently dropped on import.
  employees: ['name','role','phone','batches','farmCode','active'],
  inventory: ['id','name','category','unit','qty','reorder','costPerUnit','lotNumber','expiryDate'],
  external_workers: ['taskCode','name','phone','email','portion','idNumber'],
};

const ENTITY_LABEL: Record<ImportEntity, string> = {
  tasks: 'Tasks', employees: 'Employees', inventory: 'Stock Items', external_workers: 'External Workers',
};

const SEV_CONFIG: Record<IssueSeverity, { color: string; bg: string; icon: string }> = {
  error:   { color: '#f87171', bg: 'rgba(248,113,113,0.1)',  icon: '✕' },
  warning: { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',   icon: '⚠' },
  info:    { color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',   icon: 'ℹ' },
};

/* ─────────────────────────────────────────────────────────────
   Main CsvImportModal component
───────────────────────────────────────────────────────────── */

/* Server-authoritative validation (POST /api/imports/validate).
 *
 * The local validateRows() above is FORMAT ONLY — it cannot know whether a
 * batch code, farm code or role actually exists for this tenant. It used to
 * "know" by consulting static fixtures, which is why real batch codes were
 * rejected. Anything requiring the database is answered here, and the two
 * sets are merged so the reviewer sees one list.
 *
 * Only entities the endpoint supports are sent; the rest keep local-only
 * checking. A network failure degrades to local checks plus an explicit
 * warning rather than silently claiming the file is clean — and the import
 * writes (POST /api/employees, /api/purchases) validate independently
 * regardless. */
const SERVER_VALIDATED: ImportEntity[] = ['employees', 'inventory'];

export async function validateRowsWithServer(
  entity: ImportEntity,
  rows: Record<string, string>[],
): Promise<RowResult[]> {
  const local = validateRows(entity, rows);
  if (!SERVER_VALIDATED.includes(entity) || rows.length === 0) return local;

  const res = await apiClient.post<{ rows: { index: number; issues: CellIssue[] }[] }>(
    '/api/imports/validate',
    { entity, rows },
  );
  if (!res.success) {
    return local.map((r, i) => i === 0
      ? { ...r, issues: [...r.issues, { col: '_row', severity: 'warning' as IssueSeverity, message: `Could not reach the server to check batch and farm codes (${res.error}). Format problems are still shown.` }] }
      : r);
  }
  const byIndex = new Map(res.data.rows.map(r => [r.index, r.issues]));
  return local.map((r, i) => ({ ...r, issues: [...r.issues, ...(byIndex.get(i) ?? [])] }));
}

interface CsvImportModalProps {
  entity: ImportEntity;
  onClose: () => void;
  onImport: (rows: Record<string, string>[]) => void;
}

export function CsvImportModal({ entity, onClose, onImport }: CsvImportModalProps) {
  const [phase, setPhase] = useState<'upload' | 'review' | 'done'>('upload');
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [results, setResults] = useState<RowResult[]>([]);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [editingCell, setEditingCell] = useState<{ row: number; col: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const expectedCols = ENTITY_EXPECTED_COLS[entity];

  /* ── Missing / extra column detection ── */
  const missingCols = expectedCols.filter(c => !headers.includes(c));
  const extraCols   = headers.filter(c => !expectedCols.includes(c));

  const errorRows   = results.filter(r => !r.importable).length;
  const warningRows = results.filter(r => r.importable && r.issues.some(i => i.severity === 'warning')).length;
  const cleanRows   = results.filter(r => r.importable && !r.issues.some(i => i.severity !== 'info')).length;
  const importableRows = results.filter(r => r.importable);

  /* ── File upload ── */
  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = async ev => {
      const text = ev.target?.result as string;
      const { headers: h, rows } = parseCSVText(text);
      setHeaders(h);
      // Show the file immediately with format checks, then fold in the
      // server's reference checks — the preview should not sit blank while a
      // round-trip happens.
      setResults(validateRows(entity, rows));
      setPhase('review');
      setResults(await validateRowsWithServer(entity, rows));
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  /* ── Auto-fix all safe corrections ── */
  function fixAll() {
    setResults(prev => prev.map(row => {
      const newEdited = { ...row.edited };
      row.issues.forEach(issue => {
        if (issue.autoFix && issue.suggestion !== undefined) {
          newEdited[issue.col] = issue.suggestion;
        }
      });
      // Re-validate with fixed values
      const newResults = validateRows(entity, [newEdited]);
      return { ...row, edited: newEdited, issues: newResults[0].issues, importable: newResults[0].importable };
    }));
  }

  /* ── Inline cell edit ── */
  function startEdit(rowIdx: number, col: string) {
    setEditingCell({ row: rowIdx, col });
    setEditValue(results[rowIdx].edited[col] ?? '');
  }

  function commitEdit() {
    if (!editingCell) return;
    setResults(prev => prev.map((row, i) => {
      if (i !== editingCell.row) return row;
      const newEdited = { ...row.edited, [editingCell.col]: editValue };
      const newResults = validateRows(entity, [newEdited]);
      return { ...row, edited: newEdited, issues: newResults[0].issues, importable: newResults[0].importable };
    }));
    setEditingCell(null);
  }

  function applySuggestion(rowIdx: number, col: string, suggestion: string) {
    setResults(prev => prev.map((row, i) => {
      if (i !== rowIdx) return row;
      const newEdited = { ...row.edited, [col]: suggestion };
      const newResults = validateRows(entity, [newEdited]);
      return { ...row, edited: newEdited, issues: newResults[0].issues, importable: newResults[0].importable };
    }));
  }

  /* ── Final import ──
   * Re-check against the server before writing. Cell edits only re-run the
   * local format checks, so a row fixed in the reviewer could still carry a
   * stale reference error (a batch code corrected to one that does not
   * exist). Re-validating here means the server has the last word on what
   * gets imported, not the browser. */
  async function confirmImport() {
    const candidates = importableRows.map(r => r.edited);
    const checked = await validateRowsWithServer(entity, candidates);
    const clean = candidates.filter((_, i) => !checked[i]?.issues.some(x => x.severity === 'error'));

    if (clean.length < candidates.length) {
      // Put the rejected rows back in front of the reviewer instead of
      // dropping them silently.
      setResults(await validateRowsWithServer(entity, results.map(r => r.edited)));
      return;
    }
    onImport(clean);
    setPhase('done');
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.85)', display: 'flex', flexDirection: 'column', zIndex: 300 }} onClick={onClose}>
      <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'flex-end' }} onClick={e => e.stopPropagation()}>
        <div style={{ background: 'var(--surface)', borderRadius: '22px 22px 0 0', width: '100%', height: '95%', display: 'flex', flexDirection: 'column', border: '1px solid var(--border-subtle)' }}>

          {/* ── Header ── */}
          <div style={{ padding: '18px 20px 14px', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>Import {ENTITY_LABEL[entity]}</div>
                {fileName && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>📄 {fileName}</div>}
              </div>
              <button className="btn-icon" onClick={onClose}><X size={16} /></button>
            </div>

            {/* Phase tabs */}
            <div style={{ display: 'flex', gap: 4, marginTop: 12 }}>
              {(['upload','review','done'] as const).map((p, idx) => (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <div style={{ width: 24, height: 24, borderRadius: '50%', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', background: phase === p ? 'var(--primary-green)' : phases_done(phase, p) ? 'rgba(74,222,128,0.3)' : 'var(--card)', color: phase === p ? '#000' : 'var(--text-muted)', border: `1px solid ${phase === p ? 'var(--primary-green)' : 'var(--border-subtle)'}` }}>
                    {phases_done(phase, p) ? '✓' : idx + 1}
                  </div>
                  <span style={{ fontSize: 11, fontWeight: 600, color: phase === p ? 'var(--primary-green)' : 'var(--text-muted)', textTransform: 'capitalize' }}>{p}</span>
                  {idx < 2 && <span style={{ color: 'var(--border-subtle)', fontSize: 10, marginLeft: 2 }}>›</span>}
                </div>
              ))}
            </div>
          </div>

          {/* ── Body ── */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>

            {/* UPLOAD PHASE */}
            {phase === 'upload' && (
              <div>
                {/* Download template */}
                <div style={{ padding: 16, background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 14, marginBottom: 20 }}>
                  <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary-green)', marginBottom: 6 }}>📋 Use the export format</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 12 }}>
                    The best import file is one you previously exported from this app — it already has the correct column names and code formats. You can also download the blank template below.
                  </div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-dim)', marginBottom: 8 }}>Required columns:</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5, marginBottom: 12 }}>
                    {expectedCols.map(c => (
                      <span key={c} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace', background: 'var(--card)', border: '1px solid var(--border-subtle)', color: 'var(--accent-cyan)' }}>{c}</span>
                    ))}
                  </div>
                  <button onClick={() => downloadCSV(entity as keyof typeof import('./data').CSV_TEMPLATES)} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 14px', borderRadius: 9, fontSize: 12, fontWeight: 700, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: 'var(--primary-green)', cursor: 'pointer' }}>
                    <Download size={13} /> Download blank template
                  </button>
                </div>

                {/* Upload area */}
                <input ref={fileRef} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={handleFile} />
                <button
                  onClick={() => fileRef.current?.click()}
                  style={{ width: '100%', padding: '32px 20px', borderRadius: 16, border: '2px dashed var(--border-subtle)', background: 'var(--card)', cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                  <div style={{ fontSize: 32 }}>📂</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Tap to select CSV file</div>
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Exported CSV or filled-in template</div>
                </button>
              </div>
            )}

            {/* REVIEW PHASE */}
            {phase === 'review' && (
              <div>
                {/* Column issues */}
                {(missingCols.length > 0 || extraCols.length > 0) && (
                  <div style={{ padding: 14, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.3)', borderRadius: 12, marginBottom: 16 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent-amber)', marginBottom: 8 }}>⚠ Column issues detected</div>
                    {missingCols.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Missing columns (will default to blank):</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {missingCols.map(c => <span key={c} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', color: '#f87171' }}>{c}</span>)}
                        </div>
                      </div>
                    )}
                    {extraCols.length > 0 && (
                      <div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>Extra columns (will be ignored):</div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {extraCols.map(c => <span key={c} style={{ fontSize: 10, padding: '2px 7px', borderRadius: 5, fontFamily: 'monospace', background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: 'var(--accent-cyan)' }}>{c}</span>)}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Summary bar */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8, marginBottom: 16 }}>
                  {[
                    { label: 'Errors', count: errorRows, color: '#f87171', bg: 'rgba(248,113,113,0.1)' },
                    { label: 'Warnings', count: warningRows, color: '#fbbf24', bg: 'rgba(251,191,36,0.1)' },
                    { label: 'Clean', count: cleanRows, color: 'var(--primary-green)', bg: 'rgba(74,222,128,0.1)' },
                  ].map(s => (
                    <div key={s.label} style={{ textAlign: 'center', padding: 10, borderRadius: 10, background: s.bg, border: `1px solid ${s.color}30` }}>
                      <div style={{ fontSize: 20, fontWeight: 700, color: s.color }}>{s.count}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 600 }}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {/* Fix All Auto button */}
                {results.some(r => r.issues.some(i => i.autoFix)) && (
                  <button onClick={fixAll} style={{ width: '100%', marginBottom: 14, padding: '10px', borderRadius: 10, fontSize: 12, fontWeight: 700, background: 'rgba(96,165,250,0.1)', border: '1px solid rgba(96,165,250,0.3)', color: 'var(--accent-cyan)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                    <RefreshCw size={13} /> Apply All Auto-Fixes ({results.flatMap(r => r.issues.filter(i => i.autoFix)).length} corrections)
                  </button>
                )}

                {/* Row list */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 16 }}>
                  {results.map((row, ri) => {
                    const errors   = row.issues.filter(i => i.severity === 'error');
                    const warnings = row.issues.filter(i => i.severity === 'warning');
                    const infos    = row.issues.filter(i => i.severity === 'info');
                    const isExpanded = expandedRow === ri;
                    const dominantSev: IssueSeverity = errors.length ? 'error' : warnings.length ? 'warning' : infos.length ? 'info' : 'info';
                    const borderColor = row.importable ? (warnings.length ? '#fbbf24' : 'rgba(74,222,128,0.5)') : '#f87171';

                    // Key display value (first meaningful col)
                    const keyCol = entity === 'inventory' ? 'id' : 'code';
                    const keyVal = row.edited[keyCol] || row.edited[Object.keys(row.edited)[0]] || `Row ${ri + 1}`;
                    const nameCol = entity === 'inventory' ? 'name' : entity === 'external_workers' ? 'name' : 'title';
                    const nameVal = row.edited[nameCol] || '';

                    return (
                      <div key={ri} style={{ border: `1px solid ${borderColor}`, borderRadius: 12, overflow: 'hidden' }}>
                        {/* Row header */}
                        <button
                          onClick={() => setExpandedRow(isExpanded ? null : ri)}
                          style={{ width: '100%', padding: '12px 14px', background: `${row.importable ? 'var(--card)' : 'rgba(248,113,113,0.06)'}`, display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', border: 'none', textAlign: 'left' }}>
                          <div style={{ width: 28, height: 28, borderRadius: 8, flexShrink: 0, background: SEV_CONFIG[dominantSev].bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, color: SEV_CONFIG[dominantSev].color }}>
                            {row.importable ? (warnings.length ? '⚠' : '✓') : '✕'}
                          </div>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', gap: 6, alignItems: 'center' }}>
                              <span style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)', fontSize: 11 }}>{keyVal}</span>
                              <span style={{ color: 'var(--text-muted)', fontWeight: 400, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{nameVal}</span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, marginTop: 4, flexWrap: 'wrap' }}>
                              {errors.length > 0 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 100, background: 'rgba(248,113,113,0.15)', color: '#f87171', fontWeight: 700 }}>{errors.length} error{errors.length > 1 ? 's' : ''}</span>}
                              {warnings.length > 0 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 100, background: 'rgba(251,191,36,0.15)', color: '#fbbf24', fontWeight: 700 }}>{warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>}
                              {infos.length > 0 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 100, background: 'rgba(96,165,250,0.12)', color: 'var(--accent-cyan)', fontWeight: 700 }}>{infos.length} info</span>}
                              {row.issues.length === 0 && <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 100, background: 'rgba(74,222,128,0.15)', color: 'var(--primary-green)', fontWeight: 700 }}>✓ Clean</span>}
                            </div>
                          </div>
                          {isExpanded ? <ChevronUp size={14} color="var(--text-dim)" /> : <ChevronDown size={14} color="var(--text-dim)" />}
                        </button>

                        {/* Expanded: issues + cell editor */}
                        {isExpanded && (
                          <div style={{ padding: '0 14px 14px', background: 'var(--surface)' }}>
                            {/* Issues list */}
                            {row.issues.length > 0 && (
                              <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 6, marginTop: 10 }}>
                                {row.issues.map((issue, ii) => (
                                  <div key={ii} style={{ padding: '8px 12px', borderRadius: 10, background: SEV_CONFIG[issue.severity].bg, border: `1px solid ${SEV_CONFIG[issue.severity].color}30`, display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                                    <span style={{ fontSize: 12, color: SEV_CONFIG[issue.severity].color, flexShrink: 0 }}>{SEV_CONFIG[issue.severity].icon}</span>
                                    <div style={{ flex: 1 }}>
                                      <div style={{ fontSize: 11, color: 'var(--text-primary)', fontWeight: 600 }}>
                                        <span style={{ fontFamily: 'monospace', color: 'var(--accent-cyan)', fontSize: 10, marginRight: 4 }}>{issue.col}</span>
                                        {issue.message}
                                      </div>
                                      {issue.suggestion !== undefined && (
                                        <div style={{ marginTop: 4, display: 'flex', gap: 6, alignItems: 'center' }}>
                                          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>Suggestion:</span>
                                          <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--primary-green)', background: 'rgba(74,222,128,0.1)', padding: '1px 6px', borderRadius: 4 }}>{issue.suggestion || '(blank)'}</span>
                                          <button
                                            onClick={() => applySuggestion(ri, issue.col, issue.suggestion!)}
                                            style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 6, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)', cursor: 'pointer' }}>
                                            Apply
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* Cell editor grid */}
                            <div style={{ marginTop: row.issues.length === 0 ? 10 : 0 }}>
                              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-dim)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>Edit Fields</div>
                              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                {Object.entries(row.edited).map(([col, val]) => {
                                  const colIssues = row.issues.filter(i => i.col === col);
                                  const hasError = colIssues.some(i => i.severity === 'error');
                                  const hasWarn  = colIssues.some(i => i.severity === 'warning');
                                  const isEditing = editingCell?.row === ri && editingCell?.col === col;
                                  return (
                                    <div key={col} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <div style={{ width: 90, fontSize: 10, fontFamily: 'monospace', color: hasError ? '#f87171' : hasWarn ? '#fbbf24' : 'var(--accent-cyan)', flexShrink: 0, fontWeight: 600 }}>
                                        {col}{hasError ? ' ✕' : hasWarn ? ' ⚠' : ''}
                                      </div>
                                      {isEditing ? (
                                        <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                                          <input
                                            autoFocus
                                            className="farm-input"
                                            style={{ flex: 1, fontSize: 12 }}
                                            value={editValue}
                                            onChange={e => setEditValue(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') commitEdit(); if (e.key === 'Escape') setEditingCell(null); }}
                                          />
                                          <button onClick={commitEdit} style={{ padding: '5px 10px', borderRadius: 7, fontSize: 11, fontWeight: 700, background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', color: 'var(--primary-green)', cursor: 'pointer' }}><Check size={11} /></button>
                                          <button onClick={() => setEditingCell(null)} style={{ padding: '5px 8px', borderRadius: 7, background: 'var(--card)', border: '1px solid var(--border-subtle)', cursor: 'pointer', color: 'var(--text-muted)' }}><X size={11} /></button>
                                        </div>
                                      ) : (
                                        <div style={{ flex: 1, display: 'flex', gap: 6, alignItems: 'center', padding: '6px 10px', borderRadius: 8, background: hasError ? 'rgba(248,113,113,0.08)' : hasWarn ? 'rgba(251,191,36,0.06)' : 'var(--card)', border: `1px solid ${hasError ? 'rgba(248,113,113,0.3)' : hasWarn ? 'rgba(251,191,36,0.2)' : 'var(--border-subtle)'}` }}>
                                          <span style={{ flex: 1, fontSize: 12, color: val ? 'var(--text-primary)' : 'var(--text-dim)', fontStyle: val ? 'normal' : 'italic' }}>{val || '(empty)'}</span>
                                          <button onClick={() => startEdit(ri, col)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-dim)', display: 'flex', alignItems: 'center' }}><Edit2 size={11} /></button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* DONE PHASE */}
            {phase === 'done' && (
              <div style={{ textAlign: 'center', padding: '40px 20px' }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--primary-green)', marginBottom: 8 }}>Import Complete</div>
                <div style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 6 }}>
                  {importableRows.length} {ENTITY_LABEL[entity].toLowerCase()} imported successfully.
                </div>
                {errorRows > 0 && (
                  <div style={{ fontSize: 12, color: '#f87171', marginBottom: 16 }}>
                    {errorRows} row{errorRows > 1 ? 's' : ''} skipped due to errors.
                  </div>
                )}
                <button className="btn-primary" style={{ justifyContent: 'center' }} onClick={onClose}>
                  <Check size={14} /> Done
                </button>
              </div>
            )}
          </div>

          {/* ── Footer ── */}
          {phase === 'review' && (
            <div style={{ padding: '14px 20px', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', gap: 10 }}>
              <button className="btn-secondary" style={{ flex: 1, justifyContent: 'center' }} onClick={() => setPhase('upload')}>
                ← Upload New
              </button>
              <button
                onClick={confirmImport}
                disabled={importableRows.length === 0}
                style={{ flex: 2, padding: '12px', borderRadius: 12, fontSize: 13, fontWeight: 700, cursor: importableRows.length === 0 ? 'not-allowed' : 'pointer', background: importableRows.length === 0 ? 'var(--card)' : 'rgba(74,222,128,0.15)', border: importableRows.length === 0 ? '1px solid var(--border-subtle)' : '1px solid rgba(74,222,128,0.4)', color: importableRows.length === 0 ? 'var(--text-dim)' : 'var(--primary-green)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                <Check size={14} />
                Import {importableRows.length} of {results.length} rows
                {errorRows > 0 && <span style={{ fontSize: 10, color: '#f87171', marginLeft: 2 }}>({errorRows} skipped)</span>}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* helper for phase indicator */
function phases_done(current: string, check: string) {
  const order = ['upload','review','done'];
  return order.indexOf(current) > order.indexOf(check);
}
