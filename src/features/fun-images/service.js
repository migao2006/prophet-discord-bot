const ENDPOINTS = {
  meal: 'https://www.themealdb.com/api/json/v1/1/random.php',
  cat: 'https://api.thecatapi.com/v1/images/search?limit=1&order=RANDOM',
};

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_COOLDOWN_MS = 5_000;

export class FunImageError extends Error {
  constructor(code, cause) {
    super(code, cause ? { cause } : undefined);
    this.name = 'FunImageError';
    this.code = code;
  }
}

function parseHttpsUrl(value) {
  if (typeof value !== 'string') throw new FunImageError('invalid_image_url');
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) {
      throw new FunImageError('invalid_image_url');
    }
    return url.href;
  } catch (error) {
    if (error instanceof FunImageError) throw error;
    throw new FunImageError('invalid_image_url', error);
  }
}

function extractImageUrl(kind, body) {
  if (kind === 'meal') return parseHttpsUrl(body?.meals?.[0]?.strMealThumb);
  if (kind === 'cat') return parseHttpsUrl(body?.[0]?.url);
  throw new FunImageError('unknown_image_kind');
}

export class FunImageService {
  constructor({
    logger,
    fetchImpl = globalThis.fetch,
    now = () => Date.now(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cooldownMs = DEFAULT_COOLDOWN_MS,
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl is required');
    this.logger = logger;
    this.fetchImpl = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.cooldownMs = cooldownMs;
    this.cooldowns = new Map();
  }

  acquire(kind, guildId, userId) {
    const currentTime = this.now();
    for (const [key, value] of this.cooldowns) {
      if (value.expiresAt <= currentTime) this.cooldowns.delete(key);
    }

    const key = `${kind}:${guildId}:${userId}`;
    const existing = this.cooldowns.get(key);
    if (existing) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.expiresAt - currentTime) / 1_000)),
      };
    }

    const leaseId = Symbol(key);
    this.cooldowns.set(key, { expiresAt: currentTime + this.cooldownMs, leaseId });
    return { allowed: true, leaseId };
  }

  release(kind, guildId, userId, leaseId) {
    const key = `${kind}:${guildId}:${userId}`;
    if (this.cooldowns.get(key)?.leaseId === leaseId) this.cooldowns.delete(key);
  }

  async getImage(kind) {
    const endpoint = ENDPOINTS[kind];
    if (!endpoint) throw new FunImageError('unknown_image_kind');

    try {
      const response = await this.fetchImpl(endpoint, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'prophet-discord-bot/1.0',
        },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!response.ok) throw new FunImageError('image_api_status');

      let body;
      try {
        body = await response.json();
      } catch (error) {
        throw new FunImageError('invalid_image_response', error);
      }
      return extractImageUrl(kind, body);
    } catch (error) {
      const wrapped = error instanceof FunImageError
        ? error
        : new FunImageError('image_api_request_failed', error);
      this.logger?.error('fun_image_request_failed', {
        kind,
        errorCode: wrapped.code,
      });
      throw wrapped;
    }
  }
}
