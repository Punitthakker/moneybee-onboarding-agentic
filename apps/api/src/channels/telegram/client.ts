import type { Logger } from '../../logger';

/** Telegram Bot API client. Only what the bot needs. JSON over fetch. */
export interface TgButton {
  id: string;
  title: string;
}
export interface TelegramClient {
  sendText(chatId: string, text: string): Promise<number | null>;
  sendKeyboard(chatId: string, text: string, buttons: TgButton[]): Promise<number | null>;
  /** remove the inline keyboard from a message once a choice was made */
  clearKeyboard(chatId: string, messageId: number): Promise<void>;
  answerCallback(callbackQueryId: string): Promise<void>;
  downloadFile(fileId: string): Promise<{ data: Buffer; name: string; mime: string }>;
  setWebhook(url: string, secret: string): Promise<boolean>;
}

export const TG = { text: 4096, buttonTitle: 64, perRow: 2 } as const;
export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

/** Lay buttons out: short labels two per row, long ones one per row. */
export function keyboardRows(buttons: TgButton[]): { text: string; callback_data: string }[][] {
  const rows: { text: string; callback_data: string }[][] = [];
  let row: { text: string; callback_data: string }[] = [];
  for (const b of buttons) {
    const btn = { text: clip(b.title, TG.buttonTitle), callback_data: b.id.slice(0, 64) };
    if (b.title.length > 18) {
      if (row.length) rows.push(row);
      rows.push([btn]);
      row = [];
    } else {
      row.push(btn);
      if (row.length === TG.perRow) {
        rows.push(row);
        row = [];
      }
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

export function createTelegramClient(token: string, log: Logger, baseUrl = 'https://api.telegram.org'): TelegramClient {
  const api = `${baseUrl}/bot${token}`;
  async function call<T>(method: string, body: Record<string, unknown>): Promise<T | null> {
    const res = await fetch(`${api}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const j = (await res.json().catch(() => ({}))) as { ok: boolean; result?: T; description?: string };
    if (!res.ok || !j.ok) {
      log.warn(`telegram ${method} failed ${res.status}: ${j.description ?? 'unknown'}`);
      return null;
    }
    return j.result ?? null;
  }
  return {
    async sendText(chatId, text) {
      const r = await call<{ message_id: number }>('sendMessage', { chat_id: chatId, text: clip(text, TG.text) });
      return r?.message_id ?? null;
    },
    async sendKeyboard(chatId, text, buttons) {
      const r = await call<{ message_id: number }>('sendMessage', { chat_id: chatId, text: clip(text, TG.text), reply_markup: { inline_keyboard: keyboardRows(buttons) } });
      return r?.message_id ?? null;
    },
    async clearKeyboard(chatId, messageId) {
      await call('editMessageReplyMarkup', { chat_id: chatId, message_id: messageId, reply_markup: { inline_keyboard: [] } });
    },
    async answerCallback(id) {
      await call('answerCallbackQuery', { callback_query_id: id });
    },
    async downloadFile(fileId) {
      const f = await call<{ file_path: string; file_size?: number }>('getFile', { file_id: fileId });
      if (!f?.file_path) throw new Error('getFile failed');
      const res = await fetch(`${baseUrl}/file/bot${token}/${f.file_path}`);
      if (!res.ok) throw new Error(`file download failed ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      const name = f.file_path.split('/').pop() ?? 'file';
      const mime = name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : name.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
      return { data, name, mime };
    },
    async setWebhook(url, secret) {
      const r = await call<boolean>('setWebhook', { url, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
      return r === true;
    },
  };
}

/** In-memory client for tests and TELEGRAM_MODE=mock. */
export function createMockTelegramClient(files: Record<string, { data: Buffer; name: string; mime: string }> = {}) {
  const sent: { chatId: string; kind: 'text' | 'keyboard'; body: string; options?: TgButton[] }[] = [];
  let n = 0;
  const client: TelegramClient & { sent: typeof sent; files: typeof files; reset(): void } = {
    sent,
    files,
    reset: () => void sent.splice(0),
    async sendText(chatId, text) {
      sent.push({ chatId, kind: 'text', body: text });
      return ++n;
    },
    async sendKeyboard(chatId, text, buttons) {
      sent.push({ chatId, kind: 'keyboard', body: text, options: buttons });
      return ++n;
    },
    async clearKeyboard() {},
    async answerCallback() {},
    async downloadFile(id) {
      const f = files[id];
      if (!f) throw new Error(`mock file ${id} not found`);
      return f;
    },
    async setWebhook() {
      return true;
    },
  };
  return client;
}
