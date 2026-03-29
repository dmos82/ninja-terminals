'use strict';

// ---------------------------------------------------------------------------
// Auth module — Token validation and session middleware for Ninja Terminals
// ---------------------------------------------------------------------------

const BACKEND_URL = process.env.NINJA_BACKEND_URL || 'https://emtchat-backend.onrender.com';

// In-memory cache for validated sessions (token -> session data)
// Used as fallback when network is unavailable
const validationCache = new Map();

/**
 * Validate a token against the backend.
 *
 * @param {string} token - Bearer token to validate
 * @returns {Promise<{valid: boolean, tier: string, terminalsMax: number, features: string[]}|null>}
 */
async function validateToken(token) {
  if (!token) return null;

  try {
    const response = await fetch(`${BACKEND_URL}/api/ninja/validate`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    if (!response.ok) {
      // Token invalid or expired
      return null;
    }

    const data = await response.json();

    // Cache the result
    const result = {
      valid: true,
      tier: data.tier || 'free',
      terminalsMax: data.terminalsMax || 1,
      features: data.features || [],
      validatedAt: Date.now(),
    };

    validationCache.set(token, result);
    return result;

  } catch (err) {
    // Network error — check cache for fallback
    const cached = validationCache.get(token);
    if (cached && cached.valid) {
      console.warn(`[auth] Network error validating token, using cache: ${err.message}`);
      return cached;
    }
    return null;
  }
}

/**
 * Create Express middleware that validates Authorization Bearer tokens.
 *
 * @param {Map} sessionCache - Shared session cache (token -> session data)
 * @returns {import('express').RequestHandler}
 */
function createAuthMiddleware(sessionCache) {
  return async function authMiddleware(req, res, next) {
    // Extract Bearer token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Missing or invalid Authorization header' });
    }

    const token = authHeader.slice(7); // Remove 'Bearer ' prefix
    if (!token) {
      return res.status(401).json({ error: 'Empty token' });
    }

    // Check session cache first
    const cached = sessionCache.get(token);
    const now = Date.now();
    const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

    if (cached && (now - cached.validatedAt) < CACHE_TTL) {
      // Cache hit and fresh
      req.ninjaUser = {
        tier: cached.tier,
        terminalsMax: cached.terminalsMax,
        features: cached.features,
        token,
      };
      return next();
    }

    // Cache miss or stale — validate against backend
    const result = await validateToken(token);

    if (!result || !result.valid) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // Update cache
    sessionCache.set(token, {
      tier: result.tier,
      terminalsMax: result.terminalsMax,
      features: result.features,
      validatedAt: now,
    });

    req.ninjaUser = {
      tier: result.tier,
      terminalsMax: result.terminalsMax,
      features: result.features,
      token,
    };

    next();
  };
}

/**
 * WebSocket token validation for upgrade requests.
 *
 * @param {string} token - Token from query param
 * @param {Map} sessionCache - Shared session cache
 * @returns {Promise<{valid: boolean, tier?: string, terminalsMax?: number, features?: string[]}>}
 */
async function validateWebSocketToken(token, sessionCache) {
  if (!token) {
    return { valid: false };
  }

  // Check session cache first
  const cached = sessionCache.get(token);
  const now = Date.now();
  const CACHE_TTL = 5 * 60 * 1000;

  if (cached && (now - cached.validatedAt) < CACHE_TTL) {
    return { valid: true, ...cached };
  }

  // Validate against backend
  const result = await validateToken(token);
  if (!result || !result.valid) {
    return { valid: false };
  }

  // Update cache
  sessionCache.set(token, {
    tier: result.tier,
    terminalsMax: result.terminalsMax,
    features: result.features,
    validatedAt: now,
  });

  return { valid: true, ...result };
}

/**
 * Start heartbeat that re-validates stored sessions.
 * If a session becomes invalid, the callback is invoked to clean up.
 *
 * @param {Map} sessionCache - Shared session cache
 * @param {(token: string) => void} onInvalid - Callback when a session becomes invalid
 * @param {number} [intervalMs=300000] - Heartbeat interval (default 5 min)
 * @returns {NodeJS.Timeout} Interval handle
 */
function startSessionHeartbeat(sessionCache, onInvalid, intervalMs = 5 * 60 * 1000) {
  return setInterval(async () => {
    for (const [token, session] of sessionCache.entries()) {
      const result = await validateToken(token);
      if (!result || !result.valid) {
        console.log(`[auth] Session invalidated during heartbeat`);
        sessionCache.delete(token);
        onInvalid(token);
      } else {
        // Update cached data
        session.tier = result.tier;
        session.terminalsMax = result.terminalsMax;
        session.features = result.features;
        session.validatedAt = Date.now();
      }
    }
  }, intervalMs);
}

module.exports = {
  validateToken,
  createAuthMiddleware,
  validateWebSocketToken,
  startSessionHeartbeat,
  BACKEND_URL,
};
