// Demo receiver for the MoneyBee onboarding webhook. Verifies HMAC-SHA256 and the 5 minute replay window.
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';

const secret = process.env.ONBOARDING_WEBHOOK_SECRET ?? '';
const port = Number(process.env.PORT ?? 9999);
const seen = new Set();

http.createServer((req, res) => {
  if (req.method !== 'POST') { res.writeHead(200).end('MoneyBee webhook sink'); return; }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const ts = String(req.headers['x-moneybee-timestamp'] ?? '');
    const sig = String(req.headers['x-moneybee-signature'] ?? '');
    const delivery = String(req.headers['x-moneybee-delivery'] ?? '');
    const expected = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${body}`).digest('hex');
    const fresh = Math.abs(Date.now() - Number(ts) * 1000) <= 5 * 60 * 1000;
    const ok = fresh && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!ok) { console.log(JSON.stringify({ at: new Date().toISOString(), verified: false, fresh })); res.writeHead(401).end('bad signature'); return; }
    const p = JSON.parse(body);
    console.log(JSON.stringify({ at: new Date().toISOString(), verified: true, delivery, replay: seen.has(delivery), event: p.event, caseId: p.caseId, merchantId: p.merchantId, token: p.token ? p.token.slice(0, 10) + '...[redacted]' : null, tokenExpiresAt: p.tokenExpiresAt }));
    seen.add(delivery);
    res.writeHead(200).end('ok');
  });
}).listen(port, () => console.log(`webhook sink on :${port}`));
