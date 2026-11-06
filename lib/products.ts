// Business logic for product search. Reads the database only; never writes.
import type { Filter } from 'mongodb';
import { collections } from './db.js';
import type { Product } from './types.js';
import { escapeRegex, type ProductSearchInput } from './validation.js';

export async function searchProducts(input: ProductSearchInput): Promise<Product[]> {
  const filter: Filter<Product> = {};

  if (input.q) {
    const pattern = new RegExp(escapeRegex(input.q), 'i');
    filter.$or = [{ name: pattern }, { category: pattern }, { description: pattern }];
  }
  if (input.category) filter.category = input.category;
  if (input.inStockOnly) filter.inStock = true;

  return (await collections.products())
    .find(filter)
    .sort({ name: 1 })
    .limit(input.limit)
    .toArray();
}
