import type { Logger } from '../../logger';

/**
 * Meta WhatsApp Cloud API client (official Graph API, no third-party library).
 * Only the handful of calls the bot needs. Everything is JSON over fetch (Node 20+).
 */
export interface WaButton {
  id: string;
  title: string;
}
export interface WaListRow {
  id: string;
  title: string;
  description?: string;
}
export interface WaTemplate {
  name: string;
  lang: string;
  bodyParams: string[];
}

export interface WhatsAppClient {
  sendText(to: string, text: string): Promise<string | null>;
  sendButtons(to: string, body: string, buttons: WaButton[]): Promise<string | null>;
  sendList(to: string, body: string, buttonLabel: string, rows: WaListRow[]): Promise<string | null>;
  sendTemplate(to: string, t: WaTemplate): Promise<string | null>;
  downloadMedia(mediaId: string): Promise<{ data: Buffer; mime: string; name: string }>;
  markRead(messageId: string): Promise<void>;
}

export interface WhatsAppConfig {
  accessToken: string;
  phoneNumberId: string;
  apiVersion: string;
  baseUrl?: string;
}

/** WhatsApp hard limits */
export const WA = { buttonTitle: 20, listRowTitle: 24, listRowDesc: 72, listButton: 20, maxButtons: 3, maxRows: 10, body: 1024 } as const;
export const clip = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1) + '…');

export function createWhatsAppClient(cfg: WhatsAppConfig, log: Logger): WhatsAppClient {
  const base = cfg.baseUrl ?? 'https://graph.facebook.com';
  const url = (p: string) => `${base}/${cfg.apiVersion}/${p}`;
  const headers = { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' };

  async function send(payload: Record<string, unknown>): Promise<string | null> {
    const res = await fetch(url(`${cfg.phoneNumberId}/messages`), { method: 'POST', headers, body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...payload }) });
    const body = (await res.json().catch(() => ({}))) as { messages?: { id: string }[]; error?: { message: string; code: number } };
    if (!res.ok) {
      log.warn(`whatsapp send failed ${res.status}: ${body.error?.message ?? 'unknown'}`);
      return null;
    }
    return body.messages?.[0]?.id ?? null;
  }

  return {
    sendText: (to, text) => send({ to, type: 'text', text: { body: clip(text, WA.body), preview_url: false } }),
    sendButtons: (to, body, buttons) =>
      send({
        to,
        type: 'interactive',
        interactive: { type: 'button', body: { text: clip(body, WA.body) }, action: { buttons: buttons.slice(0, WA.maxButtons).map((b) => ({ type: 'reply', reply: { id: b.id, title: clip(b.title, WA.buttonTitle) } })) } },
      }),
    sendList: (to, body, buttonLabel, rows) =>
      send({
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: clip(body, WA.body) },
          action: { button: clip(buttonLabel, WA.listButton), sections: [{ title: clip(buttonLabel, WA.listRowTitle), rows: rows.slice(0, WA.maxRows).map((r) => ({ id: r.id, title: clip(r.title, WA.listRowTitle), ...(r.description ? { description: clip(r.description, WA.listRowDesc) } : {}) })) }] },
        },
      }),
    sendTemplate: (to, t) =>
      send({ to, type: 'template', template: { name: t.name, language: { code: t.lang }, components: t.bodyParams.length ? [{ type: 'body', parameters: t.bodyParams.map((p) => ({ type: 'text', text: p })) }] : [] } }),
    async downloadMedia(mediaId) {
      const meta = await fetch(url(mediaId), { headers: { Authorization: headers.Authorization } });
      if (!meta.ok) throw new Error(`media lookup failed ${meta.status}`);
      const m = (await meta.json()) as { url: string; mime_type: string; file_size?: number };
      const file = await fetch(m.url, { headers: { Authorization: headers.Authorization } });
      if (!file.ok) throw new Error(`media download failed ${file.status}`);
      const data = Buffer.from(await file.arrayBuffer());
      const ext = m.mime_type === 'application/pdf' ? 'pdf' : m.mime_type === 'image/png' ? 'png' : 'jpg';
      return { data, mime: m.mime_type, name: `wa-${mediaId}.${ext}` };
    },
    async markRead(messageId) {
      await fetch(url(`${cfg.phoneNumberId}/messages`), { method: 'POST', headers, body: JSON.stringify({ messaging_product: 'whatsapp', status: 'read', message_id: messageId }) }).catch(() => undefined);
    },
  };
}

/** In-memory client for tests and WHATSAPP_MODE=mock: records what would have been sent. */
export function createMockWhatsAppClient(media: Record<string, { data: Buffer; mime: string; name: string }> = {}) {
  const sent: { to: string; kind: 'text' | 'buttons' | 'list' | 'template'; body: string; options?: { id: string; title: string }[]; template?: WaTemplate }[] = [];
  let n = 0;
  const client: WhatsAppClient & { sent: typeof sent; media: typeof media; reset(): void } = {
    sent,
    media,
    reset: () => void sent.splice(0),
    async sendText(to, text) {
      sent.push({ to, kind: 'text', body: text });
      return `wamid.mock.${++n}`;
    },
    async sendButtons(to, body, buttons) {
      sent.push({ to, kind: 'buttons', body, options: buttons.map((b) => ({ id: b.id, title: clip(b.title, WA.buttonTitle) })) });
      return `wamid.mock.${++n}`;
    },
    async sendList(to, body, _label, rows) {
      sent.push({ to, kind: 'list', body, options: rows.map((r) => ({ id: r.id, title: clip(r.title, WA.listRowTitle) })) });
      return `wamid.mock.${++n}`;
    },
    async sendTemplate(to, t) {
      sent.push({ to, kind: 'template', body: t.name, template: t });
      return `wamid.mock.${++n}`;
    },
    async downloadMedia(id) {
      const m = media[id];
      if (!m) throw new Error(`mock media ${id} not found`);
      return m;
    },
    async markRead() {},
  };
  return client;
}
