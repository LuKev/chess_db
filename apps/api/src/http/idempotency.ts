const IDEMPOTENCY_KEY_MAX_LENGTH = 128;
const IDEMPOTENCY_KEY_MIN_LENGTH = 8;

export function parseIdempotencyKey(
  value: string | string[] | undefined
): { key: string | null; error: string | null } {
  if (!value) {
    return { key: null, error: null };
  }

  const raw = Array.isArray(value) ? value[0] : value;
  const key = raw.trim();

  if (!key) {
    return { key: null, error: null };
  }

  if (key.length < IDEMPOTENCY_KEY_MIN_LENGTH || key.length > IDEMPOTENCY_KEY_MAX_LENGTH) {
    return {
      key: null,
      error: `Idempotency-Key length must be between ${IDEMPOTENCY_KEY_MIN_LENGTH} and ${IDEMPOTENCY_KEY_MAX_LENGTH}`,
    };
  }

  if (/\s/.test(key)) {
    return {
      key: null,
      error: "Idempotency-Key cannot contain whitespace",
    };
  }

  return { key, error: null };
}
