/** Every `error.code` the v1 API can return, with its HTTP status (mirrors `x-error-codes` in openapi.yaml; a test keeps them equal). */
export const ERROR_STATUS = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  UNVERIFIED_OWNER: 403,
  NOT_AUTHORIZED: 403,
  NOT_FOUND: 404,
  IDEMPOTENCY_MISMATCH: 409,
  DEAD: 409,
  NOT_DEAD: 409,
  ATTENTION_REQUIRED: 409,
  PURCHASE_OPEN: 409,
  NOT_QUOTABLE: 409,
  READ_TOKEN_EXPIRED: 409,
  VERSION_MISMATCH: 409,
  NAME_TAKEN: 409,
  WALLET_TAKEN: 409,
  ADMISSION_FAILED: 409,
  ADMISSION_EXPIRED: 409,
  OUT_OF_RANGE: 422,
  NO_PATH: 422,
  NO_LINE_OF_SIGHT: 422,
  INSUFFICIENT_RESOURCES: 422,
  INVENTORY_FULL: 422,
  QUEUE_FULL: 422,
  BLUEPRINT_REQUIRED: 422,
  BUILD_BLOCKED: 422,
  AUTH_LIMIT: 422,
  RECENTLY_DAMAGED: 422,
  TARGET_PROTECTED: 422,
  RAID_WINDOW_CLOSED: 422,
  CONTENT_REJECTED: 422,
  REPEATED: 422,
  AGENT_PAUSED: 423,
  RULES_ACK_REQUIRED: 428,
  ORDER_COOLDOWN: 429,
  RATE_LIMITED: 429,
  TALK_MUTED: 429,
  INTERNAL: 500,
  WORLD_FULL: 503,
  RESTARTING: 503,
  PRICE_UNAVAILABLE: 503,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

/** The `Error` schema in openapi.yaml. */
export interface ApiError {
  ok: false;
  requestId?: string;
  error: {
    code: ErrorCode;
    message: string;
    retryAfterMs: number | null;
    details?: Record<string, unknown>;
  };
}

export function apiError(code: ErrorCode, message: string, opts: { requestId?: string; details?: Record<string, unknown>; retryAfterMs?: number } = {}): ApiError {
  return {
    ok: false,
    ...(opts.requestId !== undefined ? { requestId: opts.requestId } : {}),
    error: {
      code,
      message,
      retryAfterMs: opts.retryAfterMs ?? null,
      ...(opts.details ? { details: opts.details } : {}),
    },
  };
}
