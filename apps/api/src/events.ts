import { EventEmitter } from 'node:events';
import type { TraceRec } from './db/types';

export type CaseEvent =
  | { type: 'trace'; trace: TraceRec }
  | { type: 'status'; status: string }
  | { type: 'run'; state: string; error?: string };

/** In-process pub/sub that feeds the SSE endpoint. The worker runs inside the API process. */
export class EventBus {
  private em = new EventEmitter();
  constructor() {
    this.em.setMaxListeners(200);
  }
  emit(caseId: string, e: CaseEvent) {
    this.em.emit(caseId, e);
  }
  subscribe(caseId: string, fn: (e: CaseEvent) => void): () => void {
    this.em.on(caseId, fn);
    return () => this.em.off(caseId, fn);
  }
}
