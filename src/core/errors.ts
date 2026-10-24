export interface ErrorDetail {
  field: string;
  code: string;
  message: string;
}

/** Error thrown anywhere in the pipeline or a handler. Rendered into the error envelope. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: ErrorDetail[],
    public readonly headers: Record<string, string> = {},
    /** 'oauth' renders RFC 6749 token endpoint errors. */
    public readonly format: 'envelope' | 'oauth' = 'envelope',
  ) {
    super(message);
  }
}

export const E = {
  invalidRequest: (message: string, details?: ErrorDetail[]) => new ApiError(400, 'invalid_request', message, details),
  invalidJson: () => new ApiError(400, 'invalid_json', 'The request body is not valid JSON.'),
  invalidCursor: () => new ApiError(400, 'invalid_cursor', 'The cursor is invalid or was issued for a different filter or sort.'),
  unsupportedVersion: (v: string) => new ApiError(400, 'unsupported_version', `MoneyBee-Version ${v} is not served by this API.`),
  idempotencyKeyMissing: () =>
    new ApiError(400, 'idempotency_key_missing', 'State-changing requests need an Idempotency-Key header.', [
      { field: 'header.Idempotency-Key', code: 'required', message: 'Required for this operation.' },
    ]),
  unauthenticated: (message = 'A valid bearer token is required.') =>
    new ApiError(401, 'unauthenticated', message, undefined, { 'WWW-Authenticate': 'Bearer' }),
  insufficientScope: (required: string[]) =>
    new ApiError(403, 'insufficient_scope', `This operation needs scope: ${required.join(', ')}.`),
  humanActorRequired: () =>
    new ApiError(403, 'human_actor_required', 'Only an authenticated human user can perform this operation.'),
  roleRequired: (roles: string[]) =>
    new ApiError(403, 'role_required', `This operation needs one of the roles: ${roles.join(', ')}.`),
  notFound: (what = 'Resource') => new ApiError(404, 'not_found', `${what} not found.`),
  idempotencyConflict: () =>
    new ApiError(409, 'idempotency_key_conflict', 'This Idempotency-Key was already used with a different request.'),
  idempotencyInProgress: () =>
    new ApiError(409, 'idempotency_request_in_progress', 'A request with this Idempotency-Key is still being processed.', undefined, {
      'Retry-After': '1',
    }),
  unsupportedMediaType: (allowed: string[]) =>
    new ApiError(415, 'unsupported_media_type', `Content-Type must be one of: ${allowed.join(', ')}.`),
  validation: (details: ErrorDetail[]) => new ApiError(422, 'validation_failed', 'One or more fields are invalid.', details),
  rateLimited: (retryAfter: number) =>
    new ApiError(429, 'rate_limited', 'Too many requests.', undefined, { 'Retry-After': String(retryAfter) }),
  internal: () => new ApiError(500, 'internal_error', 'An unexpected error occurred.'),
  contractViolation: () => new ApiError(500, 'contract_violation', 'The response did not match the API specification.'),
  /** RFC 6749 token endpoint error. */
  oauth: (status: number, error: string, description: string) =>
    new ApiError(status, error, description, undefined, status === 401 ? { 'WWW-Authenticate': 'Basic' } : {}, 'oauth'),
};
