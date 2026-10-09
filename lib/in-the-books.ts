// A document with no approval status was posted when it was recorded.
// Pending and rejected documents are not in the books. Anything else,
// including a later 'approved', is included.
import { isNull, notInArray, or, type SQL } from 'drizzle-orm'

const HELD = ['pending', 'rejected']

export function inTheBooks(column: Parameters<typeof isNull>[0]): SQL {
  return or(isNull(column), notInArray(column, HELD))!
}

export function isUnbooked(status: string | null | undefined): boolean {
  return status === 'pending' || status === 'rejected'
}
