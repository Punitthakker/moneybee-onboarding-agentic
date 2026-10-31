import path from 'node:path';
import fs from 'node:fs';
import { expect, test } from '@playwright/test';

// Requires the stack running (docker compose up) and E2E_EMAIL / E2E_PASSWORD for an UNDERWRITER or ADMIN.
const EMAIL = process.env.E2E_EMAIL ?? 'admin@moneybee.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const FIX = path.resolve(__dirname, '../fixtures/merchants/01-sole-establishment');

test('drop documents, agents prepare, reviewer approves, token is minted and claimed once', async ({ page, request }) => {
  test.skip(!PASSWORD, 'set E2E_PASSWORD');
  await page.goto('/');
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText('Merchant cases.')).toBeVisible();

  await page.goto('/new');
  const files = fs.readdirSync(FIX).filter((f) => f.endsWith('.pdf')).map((f) => path.join(FIX, f));
  await page.locator('input[type=file][multiple]').first().setInputFiles(files);
  await page.getByRole('button', { name: /Create case and run agents/ }).click();

  await expect(page.getByText('AWAITING REVIEW').first()).toBeVisible({ timeout: 90_000 });
  await page.getByRole('tab', { name: 'Risk and decision' }).click();
  await page.getByLabel('Notes (mandatory, internal)').fill('E2E: checked all policy checks');
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect(page.getByText('APPROVED').first()).toBeVisible();

  await page.getByRole('tab', { name: 'Output' }).click();
  await page.getByRole('button', { name: 'Complete and mint token' }).click();
  const token = (await page.locator('.tokenbox').textContent())!.trim();
  expect(token).toMatch(/^mb_onb_/);

  const first = await request.post(`/api/v1/onboarding/${token}/claim`);
  expect(first.status()).toBe(200);
  expect((await first.json()).merchant.legalName).toBeTruthy();
  const second = await request.post(`/api/v1/onboarding/${token}/claim`);
  expect(second.status()).toBe(409);
});
