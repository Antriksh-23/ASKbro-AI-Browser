/**
 * Deterministic Safety Guardrails Engine
 */

export const RESTRICTED_DOMAINS = [
  'bank',
  'paytm',
  'phonepe',
  'razorpay',
  'upi',
  'checkout',
  'billing',
  'stripe',
];

export function isRestrictedDomain(urlStr: string): boolean {
  try {
    const parsed = new URL(urlStr);
    const host = parsed.hostname.toLowerCase();
    return RESTRICTED_DOMAINS.some((domain) => host.includes(domain));
  } catch {
    return false;
  }
}
