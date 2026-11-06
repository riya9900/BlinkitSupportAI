// Import this FIRST in any test that calls the API handlers but is not about rate
// limiting. Those tests fire dozens of requests from one fake address and must
// not be refused (or write counters to the real database).
import { setRateLimitStore } from '../lib/rateLimit.js';

setRateLimitStore({ increment: async () => 0 });
