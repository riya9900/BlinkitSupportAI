// GET /api/products-search?q=milk&category=dairy&inStockOnly=true&limit=5
// All parameters are optional, but at least one of q or category is required.
import { handle, json, requireMethod } from '../lib/http.js';
import { searchProducts } from '../lib/products.js';
import { parseProductSearchInput } from '../lib/validation.js';
import { limitRequest } from '../lib/rateLimit.js';

export const GET = handle(async (request) => {
  requireMethod(request, 'GET');
  await limitRequest(request, 'search');
  const input = parseProductSearchInput(new URL(request.url).searchParams);
  const products = await searchProducts(input);
  return json({ count: products.length, products });
});

const methodNotAllowed = handle(async (request) => {
  requireMethod(request, 'GET');
  return json({});
});
export const POST = methodNotAllowed;
export const PUT = methodNotAllowed;
export const DELETE = methodNotAllowed;
