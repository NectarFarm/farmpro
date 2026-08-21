// Shared report envelope shape — split out of lib/reports.ts (which is
// `server-only`) so client components (components/farm/reports.tsx) can
// import just the type without pulling in server-only DB code.
export type ReportRow = (string | number)[]

export type ReportPayload = {
  title: string
  meta: Record<string, unknown>
  columns: string[]
  rows: ReportRow[]
}
