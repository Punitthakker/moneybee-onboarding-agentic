import { expect, test } from '@playwright/test';

// UAE PASS journey against the MOCK provider. Requires the stack running with UAEPASS_MODE=mock and
// E2E_EMAIL / E2E_PASSWORD for an UNDERWRITER or ADMIN. UAEPASS_SIGNING_ENABLED=true also exercises signing.
const EMAIL = process.env.E2E_EMAIL ?? 'admin@moneybee.local';
const PASSWORD = process.env.E2E_PASSWORD ?? '';
const CSRF = { 'x-moneybee-csrf': '1' };

test('merchant signs in with UAE PASS, shares documents, and ops sees them as issuer verified', async ({ browser, request }, info) => {
  test.skip(!PASSWORD, 'set E2E_PASSWORD');
  test.skip(info.project.name === 'mobile', 'desktop only');
  const login = await request.post('/api/v1/auth/login', { headers: CSRF, data: { email: EMAIL, password: PASSWORD } });
  expect(login.ok()).toBeTruthy();
  const c = await (await request.post('/api/v1/cases', { headers: CSRF, data: { acquirerCode: 'EXAMPLE_ACQUIRER_A', entityType: 'auto', name: 'E2E UAE PASS merchant' } })).json();
  const inv = await (await request.post(`/api/v1/cases/${c.id}/uaepass/invite`, { headers: CSRF })).json();

  const merchant = await (await browser.newContext()).newPage();
  await merchant.goto(inv.url);
  await merchant.getByTestId('continue-uaepass').click();
  await merchant.getByTestId('sim-signin').click(); // SOP3 persona is preselected
  await expect(merchant.getByTestId('masked-eid')).toHaveText('784-****-*******-3');

  await merchant.getByTestId('send-request').click();
  const pending = merchant.locator('[data-testid=share-card][data-status=pending]');
  await expect(pending).toBeVisible();
  const app = await (await browser.newContext()).newPage();
  await app.goto((await merchant.getByTestId('open-app').getAttribute('href'))!);
  await app.getByTestId('sim-approve').click();
  await expect(app.locator('[data-testid=share-card][data-status=shared]')).toBeVisible();
  await expect(merchant.locator('[data-testid=share-card][data-status=shared]')).toBeVisible({ timeout: 15_000 });
  await expect(merchant.getByTestId('vault').getByText('Issuer verified').first()).toBeVisible();

  // expiry: advance the simulated clock past the request lifetime
  const sess = await merchant.evaluate(() => sessionStorage.getItem('mb_invite'));
  const r = await merchant.request.post('/api/v1/merchant/share-requests', { headers: { ...CSRF, 'x-invite': sess! }, data: { documents: ['emirates_id'] } });
  expect(r.ok()).toBeTruthy();
  const no = (await r.json()).requestNo as string;
  await app.goto(`/sim/uaepass/share/${no}`);
  await app.getByTestId('advance-clock').click();
  await expect(app.locator('[data-testid=share-card][data-status=expired]')).toBeVisible({ timeout: 10_000 });
  await app.request.post('/api/v1/mock/uaepass/clock', { headers: CSRF, data: { reset: true } });

  const ops = await request.get(`/api/v1/cases/${c.id}`);
  const body = await ops.json();
  expect(body.case.documents.filter((d: { provenance?: string }) => d.provenance === 'issuer_verified').length).toBe(1);
});
