#!/usr/bin/env node
/**
 * Telegram simulator: talk to the onboarding bot from your terminal without a BotFather token.
 *   TELEGRAM_MODE=mock npm run dev      # terminal 1
 *   npm run tg:sim                      # terminal 2
 * Commands: /start <code>   deep link with a partner code
 *           /btn <id>       press an inline keyboard button (ids printed with each prompt)
 *           /file <path>    send a PDF or image
 *           /chat <id>      switch chat id (new merchant)
 *           /quit
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

const API = process.env.API_URL ?? 'http://localhost:4000';
const SECRET = process.env.TELEGRAM_WEBHOOK_SECRET ?? 'mock-telegram-secret';
let chat = Number(process.env.TG_CHAT ?? 9000001);
let upd = Date.now();
let seen = 0;

async function send(update) {
  const res = await fetch(`${API}/api/v1/channels/telegram/webhook`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': SECRET }, body: JSON.stringify({ update_id: ++upd, ...update }) });
  if (!res.ok) console.log(`! webhook returned ${res.status}`);
  await new Promise((r) => setTimeout(r, 400));
  const out = await fetch(`${API}/api/v1/channels/telegram/mock/outbox?chat=${chat}`).then((r) => r.json()).catch(() => ({ sent: [] }));
  for (const m of out.sent.slice(seen)) {
    console.log(`\n\x1b[36mMoneyBee:\x1b[0m ${m.body}`);
    if (m.options?.length) console.log('  ' + m.options.map((o) => `[${o.id}] ${o.title}`).join('   '));
  }
  seen = out.sent.length;
}
const msg = (body) => ({ message: { message_id: upd, from: { id: chat, is_bot: false, first_name: 'Sim', language_code: 'en' }, chat: { id: chat, type: 'private' }, date: Math.floor(Date.now() / 1000), ...body } });

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: `\x1b[33mchat ${chat}>\x1b[0m ` });
console.log(`Telegram simulator -> ${API}. Type a message, /start <code>, /btn <id>, /file <path>, /chat <id>, /quit`);
rl.prompt();
rl.on('line', async (line) => {
  const s = line.trim();
  try {
    if (s === '/quit') return rl.close();
    else if (s.startsWith('/chat ')) {
      chat = Number(s.slice(6).trim());
      seen = 0;
      rl.setPrompt(`\x1b[33mchat ${chat}>\x1b[0m `);
    } else if (s.startsWith('/btn ')) {
      const data = s.slice(5).trim();
      await send({ callback_query: { id: `cq${upd}`, from: { id: chat, is_bot: false, first_name: 'Sim' }, message: { message_id: upd - 1, chat: { id: chat, type: 'private' }, date: 1 }, chat_instance: 'x', data } });
    } else if (s.startsWith('/file ')) {
      const p = s.slice(6).trim();
      const mime = p.endsWith('.pdf') ? 'application/pdf' : p.endsWith('.png') ? 'image/png' : 'image/jpeg';
      const up = await fetch(`${API}/api/v1/channels/telegram/mock/file`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'x-filename': path.basename(p), 'x-mime': mime }, body: fs.readFileSync(p) });
      const { id } = await up.json();
      await send(msg({ document: { file_id: id, file_unique_id: id, file_name: path.basename(p), mime_type: mime } }));
    } else if (s) await send(msg({ text: s }));
  } catch (e) {
    console.log(`! ${e.message}`);
  }
  rl.prompt();
});
rl.on('close', () => process.exit(0));
