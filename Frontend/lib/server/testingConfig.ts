import 'server-only';
import { db } from '@/db';
import { platformSettings } from '@/db/schemas';
import { eq } from 'drizzle-orm';
import { TEST_STEPS, type TestStepDef } from '@/lib/testing';

// The checklist new runs are built from: the admin-edited list if one exists and
// is non-empty, otherwise the built-in defaults.
export async function getActiveSteps(): Promise<TestStepDef[]> {
  const [row] = await db.select({ steps: platformSettings.testSteps }).from(platformSettings)
    .where(eq(platformSettings.id, 'global')).limit(1);
  const steps = row?.steps;
  return Array.isArray(steps) && steps.length > 0 ? steps : [...TEST_STEPS];
}

export async function saveActiveSteps(defs: TestStepDef[]): Promise<void> {
  await db.insert(platformSettings).values({ id: 'global', testSteps: defs })
    .onConflictDoUpdate({ target: platformSettings.id, set: { testSteps: defs } });
}
