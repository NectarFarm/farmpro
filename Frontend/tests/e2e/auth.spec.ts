import { test, expect } from '@playwright/test';

// End-to-end (real browser) smoke of the unified login + auth gate.

test('owner signs in through the single login and lands on the dashboard', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill('kutswa@ifms.farm');
  await page.locator('input[type="password"]').fill('demo1234');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/owner\/dashboard/);
});

test('worker signs in with phone + PIN and lands on the worker home', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill('+254700333444');
  await page.locator('input[type="password"]').fill('1234');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/worker\/home/);
});

test('a logged-out visitor is redirected to /login from a protected page', async ({ page }) => {
  await page.goto('/owner/dashboard');
  await expect(page).toHaveURL(/\/login/);
});

test('wrong password shows an error and stays on /login', async ({ page }) => {
  await page.goto('/login');
  await page.locator('input[autocomplete="username"]').fill('kutswa@ifms.farm');
  await page.locator('input[type="password"]').fill('WRONG');
  await page.getByRole('button', { name: /sign in/i }).click();
  await expect(page.getByText(/invalid email or password/i)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
