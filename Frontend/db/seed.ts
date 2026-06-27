// Seed script — run with: pnpm db:seed  (needs DATABASE_URL set).
// Idempotent: re-running does not duplicate (onConflictDoNothing / DoUpdate).
//
// Always seeds the platform tenant + super-admin (the entry point for creating
// real farms). The demo farm (owner/workers/manager/vet/auditor + sample config)
// is seeded only when SEED_DEMO !== 'false', so production can start admin-only.
//
//   ADMIN_EMAIL / ADMIN_PASSWORD — override the super-admin login (set these in prod)
//   SEED_DEMO=false              — seed ONLY the admin (no demo accounts)
import 'dotenv/config';
import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { tenants, users, workerProfiles, alertRules } from './schemas';

async function hashSecret(secret: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: 100_000, hash: 'SHA-256' }, key, 256
  );
  const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `pbkdf2$100000$${hex(salt.buffer)}$${hex(bits)}`;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');
  const client = postgres(url, { prepare: false });
  const db = drizzle(client);
  const T = 't1';

  const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'admin@ifms.app';
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? 'demo1234';
  const SEED_DEMO = process.env.SEED_DEMO !== 'false';
  const usingDefaultAdminPw = ADMIN_PASSWORD === 'demo1234';

  // Platform tenant + super-admin — always present. onConflictDoUpdate so that a
  // changed ADMIN_EMAIL/ADMIN_PASSWORD is picked up on the next migrate/seed.
  await db.insert(tenants).values({ id: T, name: SEED_DEMO ? "Kutswa's Farm" : 'Platform' }).onConflictDoNothing();

  const adminHash = await hashSecret(ADMIN_PASSWORD);
  await db.insert(users).values({
    id: 'admin', tenantId: T, name: 'Platform Admin', phone: '+254000000001',
    email: ADMIN_EMAIL, role: 'super_admin', language: 'en', passwordHash: adminHash,
  }).onConflictDoUpdate({ target: users.id, set: { email: ADMIN_EMAIL, passwordHash: adminHash } });

  if (SEED_DEMO) {
    const demoFields = [
      { fieldKey: 'feed_unit_cost', label: 'Feed unit cost (KSh)', permission: 'hidden' as const },
      { fieldKey: 'feed_quantity', label: 'Feed quantity (kg)', permission: 'editable' as const, required: true },
      { fieldKey: 'egg_sale_price', label: 'Egg sale price', permission: 'hidden' as const },
      { fieldKey: 'mortality_cause', label: 'Mortality cause', permission: 'editable' as const },
      { fieldKey: 'batch_profit_loss', label: 'Batch profit/loss', permission: 'hidden' as const },
    ];
    const demoProfile = {
      name: 'Standard Worker', description: 'Hides all financial data',
      modules: ['morning_round', 'mortality', 'feeding', 'health', 'weight_sampling', 'physical_count', 'closing_stock'],
      mortalityPhotoThreshold: 1, alertThresholds: { mortalityRate: 2.0, lowStockKg: 50 }, fields: demoFields,
    };
    await db.insert(workerProfiles).values({ id: 'wp1', tenantId: T, ...demoProfile })
      .onConflictDoUpdate({ target: workerProfiles.id, set: demoProfile });

    await db.insert(users).values([
      { id: 'u1', tenantId: T, name: 'Kutswa', phone: '+254712345678', email: 'kutswa@ifms.farm', role: 'owner', language: 'en', passwordHash: await hashSecret('demo1234') },
      { id: 'u3', tenantId: T, name: 'John Otieno', phone: '+254700333444', role: 'worker', workerProfileId: 'wp1', language: 'en', pinHash: await hashSecret('1234') },
      { id: 'u4', tenantId: T, name: 'Mary Achieng', phone: '+254700555666', role: 'worker', workerProfileId: 'wp1', language: 'sw', pinHash: await hashSecret('5678') },
      { id: 'u2', tenantId: T, name: 'Amina Wanjiku', phone: '+254700111222', email: 'amina@ifms.farm', role: 'manager', language: 'en', passwordHash: await hashSecret('demo1234') },
      { id: 'u5', tenantId: T, name: 'Dr. Kuria Kamau', phone: '+254700777888', email: 'vet@ifms.farm', role: 'vet', language: 'en', passwordHash: await hashSecret('demo1234') },
      { id: 'u6', tenantId: T, name: 'Investor Link', phone: '+254700999000', email: 'investor@fund.ke', role: 'auditor', language: 'en', passwordHash: await hashSecret('demo1234') },
    ]).onConflictDoNothing();

    await db.insert(alertRules).values([
      { id: 'ar1', tenantId: T, metric: 'mortality_rate', label: 'Mortality spike', threshold: 2.0, unit: '%', severity: 'critical', enabled: true },
      { id: 'ar2', tenantId: T, metric: 'feed_qty', label: 'Low feed stock', threshold: 50, unit: 'kg', severity: 'warning', enabled: true },
      { id: 'ar3', tenantId: T, metric: 'task_overdue_hours', label: 'Overdue task', threshold: 24, unit: 'h', severity: 'warning', enabled: true },
      { id: 'ar4', tenantId: T, metric: 'do_mgl', label: 'Water quality (DO)', threshold: 4.0, unit: 'mg/L', severity: 'critical', enabled: true },
    ]).onConflictDoNothing();
  }

  await client.end();

  console.log('\n──────────────── IFMS seed complete ────────────────');
  console.log(`  Platform admin:   ${ADMIN_EMAIL}  /  ${ADMIN_PASSWORD}`);
  console.log('  → Sign in as admin to create farms and owner accounts.');
  if (usingDefaultAdminPw) {
    console.log('  ⚠  Default admin password in use. Set ADMIN_PASSWORD before production.');
  }
  if (SEED_DEMO) {
    console.log('  Demo owner:       kutswa@ifms.farm  /  demo1234');
    console.log('  Demo worker:      +254700333444  /  1234');
    console.log('  (set SEED_DEMO=false to seed ONLY the admin — no demo accounts)');
  }
  console.log('─────────────────────────────────────────────────────\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
