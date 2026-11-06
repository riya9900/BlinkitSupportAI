// The ONLY things Gemini is allowed to do. Each tool wraps backend logic that is
// already validated and tested. Gemini sees tool results as data; it has no
// database access and cannot change refund rules.
import { HttpError } from './http.js';
import { getOrderStatus } from './orders.js';
import { searchProducts } from './products.js';
import { checkRefundEligibility, getRefundStatus, requestRefund } from './refunds.js';
import { createHandoff, createQuery } from './support.js';
import {
  parseHandoffInput,
  parseOrderStatusInput,
  parseProductSearchInput,
  parseQueryInput,
  parseRefundRequestInput,
} from './validation.js';

const phoneProp = {
  type: 'string',
  description:
    'The 10-digit phone number registered on the order, exactly as the customer gave it. Never guess or invent it.',
};
const orderIdProp = {
  type: 'string',
  description: 'The order ID, like ORD1001, exactly as the customer gave it. Never guess it.',
};

export const toolDeclarations = [
  {
    name: 'get_order_status',
    description: 'Look up the current status, items and total of ONE order. Needs the order ID and the phone number on the order.',
    parametersJsonSchema: {
      type: 'object',
      properties: { orderId: orderIdProp, phone: phoneProp },
      required: ['orderId', 'phone'],
    },
  },
  {
    name: 'search_products',
    description: 'Search the product catalogue by name/keyword and/or category. Provide query or category.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search words, e.g. "milk".' },
        category: { type: 'string', description: 'Single lowercase category word, e.g. "dairy".' },
        inStockOnly: { type: 'boolean', description: 'Only return items that are in stock.' },
      },
    },
  },
  {
    name: 'check_refund_eligibility',
    description: 'Check (read-only) whether an order can be refunded right now. Always call this BEFORE request_refund.',
    parametersJsonSchema: {
      type: 'object',
      properties: { orderId: orderIdProp, phone: phoneProp },
      required: ['orderId', 'phone'],
    },
  },
  {
    name: 'request_refund',
    description:
      'Submit a refund request. Only call after check_refund_eligibility says eligible AND the customer has explicitly said yes to the order and amount. The system, not you, decides the outcome.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        orderId: orderIdProp,
        phone: phoneProp,
        reason: { type: 'string', description: "The customer's reason, in their words (5-300 characters)." },
        amount: { type: 'number', description: 'Optional partial amount in rupees. Omit for a full refund.' },
        customerConfirmed: {
          type: 'boolean',
          description: 'true ONLY if the customer explicitly confirmed this refund in the conversation.',
        },
      },
      required: ['orderId', 'phone', 'reason', 'customerConfirmed'],
    },
  },
  {
    name: 'get_refund_status',
    description: 'List refunds already filed for an order, with their status.',
    parametersJsonSchema: {
      type: 'object',
      properties: { orderId: orderIdProp, phone: phoneProp },
      required: ['orderId', 'phone'],
    },
  },
  {
    name: 'create_query',
    description: 'Record a customer complaint or general query for the support team.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        phone: phoneProp,
        type: { type: 'string', enum: ['complaint', 'query'] },
        subject: { type: 'string', description: 'Short title, 3-100 characters.' },
        message: { type: 'string', description: 'Details from the customer, 10-1000 characters.' },
        orderId: { ...orderIdProp, description: 'Optional: the related order ID.' },
      },
      required: ['phone', 'type', 'subject', 'message'],
    },
  },
  {
    name: 'escalate_to_human',
    description:
      'Hand the conversation to a human support agent. Use when the customer asks for a person, is very upset, or the problem is outside your tools.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        phone: phoneProp,
        reason: { type: 'string', description: 'Why a human is needed (5-300 characters).' },
        conversationSummary: {
          type: 'string',
          description: 'Brief factual summary of the conversation so far for the human agent (10-2000 characters).',
        },
        orderId: { ...orderIdProp, description: 'Optional: the related order ID.' },
      },
      required: ['phone', 'reason', 'conversationSummary'],
    },
  },
];

// The backend functions the tools call. Injectable so tests can use fakes.
export interface ToolDeps {
  getOrderStatus: typeof getOrderStatus;
  searchProducts: typeof searchProducts;
  checkRefundEligibility: typeof checkRefundEligibility;
  requestRefund: typeof requestRefund;
  getRefundStatus: typeof getRefundStatus;
  createQuery: typeof createQuery;
  createHandoff: typeof createHandoff;
}

export const realToolDeps: ToolDeps = {
  getOrderStatus,
  searchProducts,
  checkRefundEligibility,
  requestRefund,
  getRefundStatus,
  createQuery,
  createHandoff,
};

export type ToolResult = Record<string, unknown>;

// Dates and other values become plain JSON before going back to the model.
const plain = (value: unknown): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

function searchParamsFrom(args: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  const take = (arg: string, param: string) => {
    const v = args[arg];
    if (v === undefined || v === null || v === '') return;
    if (typeof v !== 'string' && typeof v !== 'boolean') {
      throw new HttpError(400, `${arg} must be text or true/false.`);
    }
    params.set(param, String(v));
  };
  take('query', 'q');
  take('category', 'category');
  take('inStockOnly', 'inStockOnly');
  return params;
}

// Runs one tool. Never throws: problems come back as { ok: false, error, code? }
// so the model can explain them to the customer.
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  deps: ToolDeps = realToolDeps,
): Promise<ToolResult> {
  try {
    switch (name) {
      case 'get_order_status': {
        const input = parseOrderStatusInput(args);
        const order = await deps.getOrderStatus(input.orderId, input.phone);
        if (!order) return { ok: false, error: 'No order found with that order ID and phone number.' };
        return { ok: true, order: plain(order) };
      }
      case 'search_products': {
        const products = await deps.searchProducts(parseProductSearchInput(searchParamsFrom(args)));
        const slim = products.map((p) => ({
          productId: p._id, name: p.name, category: p.category, price: p.price, unit: p.unit, inStock: p.inStock,
        }));
        return { ok: true, count: slim.length, products: slim };
      }
      case 'check_refund_eligibility': {
        const input = parseOrderStatusInput(args);
        const { order, decision } = await deps.checkRefundEligibility(input.orderId, input.phone);
        return { ok: true, orderId: order._id, ...plain(decision) };
      }
      case 'request_refund': {
        if (args.customerConfirmed !== true) {
          return {
            ok: false,
            code: 'CONFIRMATION_REQUIRED',
            error: 'Not submitted. Ask the customer to confirm the order and amount, then call again with customerConfirmed true.',
          };
        }
        const refund = await deps.requestRefund(parseRefundRequestInput(args));
        return {
          ok: true,
          refund: plain({
            refundId: refund._id, orderId: refund.orderId, amount: refund.amount,
            status: refund.status, decisionNote: refund.decisionNote,
          }),
        };
      }
      case 'get_refund_status': {
        const input = parseOrderStatusInput(args);
        const refunds = await deps.getRefundStatus(input.orderId, input.phone);
        return { ok: true, count: refunds.length, refunds: plain(refunds) };
      }
      case 'create_query': {
        const q = await deps.createQuery(parseQueryInput(args));
        return { ok: true, query: plain({ queryId: q._id, type: q.type, subject: q.subject, status: q.status }) };
      }
      case 'escalate_to_human': {
        const { handoff, created } = await deps.createHandoff(parseHandoffInput(args));
        return {
          ok: true,
          created,
          handoff: plain({ handoffId: handoff._id, status: handoff.status }),
        };
      }
      default:
        return { ok: false, error: `Unknown tool "${name}".` };
    }
  } catch (err) {
    if (err instanceof HttpError) {
      return err.code ? { ok: false, error: err.message, code: err.code } : { ok: false, error: err.message };
    }
    console.error(`Tool ${name} failed:`, err);
    return { ok: false, error: 'An internal error occurred. Please try again or ask for a human agent.' };
  }
}
