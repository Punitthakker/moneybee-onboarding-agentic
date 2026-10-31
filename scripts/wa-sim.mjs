#!/usr/bin/env node
/**
 * WhatsApp simulator: talk to the onboarding bot from your terminal without a Meta account.
 * Posts Meta-shaped webhook events (signed with WHATSAPP_APP_SECRET) to the API and prints what the bot
 * would send back (the API logs it as [WHATSAPP MOCK]; this script also tails the mock outbox through /api/v1/channels/whatsapp/mock/outbox).
 *
 *   WHATSAPP_MODE=mock npm run dev          # in one terminal
 *   node scripts/wa-sim.mjs                 # in another
 *
 * Commands inside the simulator:
 *   /file <path>      send a PDF or image as a document message
 *   /btn <id>         press a reply button or list row by id (ids are printed with each prompt)
 *   /from <number>    switch the sending phone number (new session)
 *   /quit
 */
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const API = process.env.API_URL ?? 'http://localhost:4000';
const SECRET = process.env.WHATSAPP_APP_SECRET ?? 'mock-app-secret';
let from = process.env.WA_FROM ?? '971500000001';
let n = 0;

const env = (message) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'sim', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: 'sim' }, messages: [{ from, id: `wamid.sim.${Date.now()}.${++n}`, timestamp: String(Math.floor(Date.now() / 1000)), ...message }] } }] }],
});

async function send(message) {
  const body = JSON.stringify(env(message));
  const sig = 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
  const res = await fetch(`${API}/api/v1/channels/whatsapp/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': sig }, body });
  if (!res.ok) console.log(`! webhook returned ${res.status}`);
  await new Promise((r) => setTimeout(r, 400));
  await drain();
}

let seen = 0;
async function drain() {
  const res = await fetch(`${API}/api/v1/channels/whatsapp/mock/outbox?from=${from}`).catch(() => null);
  if (!res || !res.ok) return;
  const { sent } = await res.json();
  for (const m of sent.slice(seen)) {
    console.log(`\n\x1b[36mMoneyBee:\x1b[0m ${m.body}`);
    if (m.options?.length) console.log('  ' + m.options.map((o) => `[${o.id}] ${o.title}`).join('   '));
    if (m.template) console.log(`  (template ${m.template.name}: ${m.template.bodyParams.join(' | ')})`);
  }
  seen = sent.length;
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `\x1b[33m${from}>\x1b[0m ` });
console.log(`WhatsApp simulator -> ${API}. Type a message, /btn <id>, /file <path>, /from <number>, /quit`);
rl.prompt();
rl.on('line', async (line) => {
  const s = line.trim();
  try {
    if (s === '/quit') return rl.close();
    else if (s.startsWith('/from ')) {
      from = s.slice(6).trim();
      seen = 0;
      rl.setPrompt(`\x1b[33m${from}>\x1b[0m `);
    } else if (s.startsWith('/btn ')) {
      const id = s.slice(5).trim();
      await send({ type: 'interactive', interactive: { type: 'button_reply', button_reply: { id, title: id } } });
    } else if (s.startsWith('/file ')) {
      const p = s.slice(6).trim();
      const data = fs.readFileSync(p);
      const mime = p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const up = await fetch(`${API}/api/v1/channels/whatsapp/mock/media`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-filename': path.basename(p), 'x-mime': mime }, body: data });
      const { id } = await up.json();
      await send({ type: 'document', document: { id, mime_type: mime, filename: path.basename(p) } });
    } else if (s) await send({ type: 'text', text: { body: s } });
  } catch (e) {
    console.log(`! ${e.message}`);
  }
  rl.prompt();
});
rl.on('close', () => process.exit(0));
