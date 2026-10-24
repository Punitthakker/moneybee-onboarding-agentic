import type { Config } from './config.js';
import type { DeliveryRec, EventRec, MemoryStore } from './store.js';
import type { LoadedSpec } from './spec.js';
import type { TenantScope } from './types.js';
import { type Clock, newId } from './util.js';

export function eventToApi(e: EventRec) {
  return {
    id: e.id,
    object: 'event' as const,
    type: e.type,
    api_version: e.apiVersion,
    data_version: e.dataVersion,
    created_at: e.createdAt,
    tenant_id: e.tenantId,
    livemode: e.livemode,
    data: e.data,
  };
}

/**
 * Creates events and queues their deliveries. A webhook endpoint receives events from its own tenant and from
 * every tenant below it, so a partner can watch its merchants.
 */
export class EventBus {
  constructor(
    private store: MemoryStore,
    private spec: LoadedSpec,
    private cfg: Config,
    private clock: Clock,
  ) {}

  emit(
    tenantId: string,
    type: string,
    data: Record<string, unknown>,
    opts: { onlyEndpointId?: string; ignoreSubscription?: boolean } = {},
  ): { event: EventRec; deliveries: DeliveryRec[] } {
    const def = this.spec.events.get(type);
    if (!def) throw new Error(`Unknown event type "${type}". Add it to the module's webhooks section first.`);
    const event: EventRec = {
      id: newId('evt'),
      type,
      apiVersion: this.cfg.supportedVersions[0]!,
      dataVersion: def.version,
      createdAt: this.clock.now().toISOString(),
      tenantId,
      livemode: this.cfg.env !== 'sandbox',
      data,
    };
    if (this.cfg.responseValidation !== 'off') this.checkAgainstSpec(event);
    this.store.insertEvent(event);
    return { event, deliveries: this.queue(event, this.targets(event, opts.onlyEndpointId, undefined, opts.ignoreSubscription)) };
  }

  /**
   * Re-sends an existing event. Returns the new deliveries, or null if the event is not visible to the caller.
   * Naming an endpoint replays to it even if it does not subscribe to the type; otherwise subscriptions apply.
   */
  replay(scope: TenantScope, eventId: string, endpointId?: string): DeliveryRec[] | null {
    const event = this.store.getEvent(scope, eventId);
    if (!event) return null;
    return this.queue(event, this.targets(event, endpointId, scope, !!endpointId));
  }

  private targets(event: EventRec, onlyEndpointId?: string, scope?: TenantScope, ignoreSubscription = false) {
    let eps = this.store.endpointsForEventTenant(event.tenantId);
    if (!ignoreSubscription) eps = eps.filter((e) => e.events.includes('*') || e.events.includes(event.type));
    // A replay can only target endpoints the caller can see.
    if (scope) eps = eps.filter((e) => scope.visible.has(e.tenantId));
    if (onlyEndpointId) eps = eps.filter((e) => e.id === onlyEndpointId);
    return eps;
  }

  private queue(event: EventRec, endpoints: { id: string; tenantId: string }[]): DeliveryRec[] {
    const now = this.clock.now();
    return endpoints.map((ep) => {
      const d: DeliveryRec = {
        id: newId('dlv'),
        eventId: event.id,
        endpointId: ep.id,
        tenantId: ep.tenantId,
        status: 'pending',
        attempts: [],
        nextAttemptAt: new Date(now.getTime() + (this.cfg.webhookBackoffSeconds[0] ?? 0) * 1000).toISOString(),
        createdAt: now.toISOString(),
      };
      this.store.insertDelivery(d);
      return d;
    });
  }

  private checkAgainstSpec(event: EventRec) {
    const v = this.spec.eventValidator(event.type);
    if (v && !v(eventToApi(event))) {
      const msg = `Event ${event.type} does not match its webhook schema: ${JSON.stringify(v.errors)}`;
      if (this.cfg.responseValidation === 'strict') throw new Error(msg);
      console.warn(msg);
    }
  }
}
