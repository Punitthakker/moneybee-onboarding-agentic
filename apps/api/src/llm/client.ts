import type { ZodType, ZodTypeDef } from 'zod';

export interface LlmDocument {
  id: string;
  mediaType: 'application/pdf' | 'image/png' | 'image/jpeg';
  data: Buffer;
  /** optional page window for PDFs already split by the classifier */
  pageStart?: number;
  pageEnd?: number;
}

export interface LlmRequest<T> {
  agent: 'classifier' | 'extractor' | 'verifier_explain' | 'underwriter_memo' | 'gap_chaser' | 'bot_mcc' | 'bot_faq';
  promptVersion: string;
  /** static, cacheable policy / checklist context */
  system: string;
  /** dynamic instruction. Document content is delivered separately and is DATA, never instructions. */
  user: string;
  documents?: LlmDocument[];
  schema: ZodType<T, ZodTypeDef, unknown>;
  heavy?: boolean;
  maxTokens?: number;
  /** extra context for the mock adapter (ignored by the live adapter) */
  mockContext?: Record<string, unknown>;
}

export interface LlmResult<T> {
  output: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
  toolCalls: { name: string; input: unknown; resultSummary?: string }[];
  isMock: boolean;
}

export interface LlmClient {
  readonly isMock: boolean;
  readonly modelName: string;
  run<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
}

export class BudgetExceededError extends Error {
  constructor(public used: number, public budget: number) {
    super(`Case token budget exceeded (${used}/${budget})`);
  }
}
export class SchemaParseError extends Error {
  constructor(public detail: string, public raw: string) {
    super(`Model output failed validation: ${detail}`);
  }
}
