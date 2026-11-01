/**
 * ASKbro Domain Guard (Slice 4.3)
 *
 * Deterministic URL and domain blacklist guardrail.
 * Hardcoded blacklist for domains containing:
 * - bank
 * - paytm
 * - phonepe
 * - razorpay
 * - upi
 * - checkout
 * - billing
 * - stripe
 *
 * If current URL matches, disables browser agent automation and displays a protective shield badge.
 */

/**
 * Hardcoded sensitive keywords for financial, banking, and payment domains
 */
export const RESTRICTED_DOMAINS: readonly string[] = [
  'bank',
  'paytm',
  'phonepe',
  'razorpay',
  'upi',
  'checkout',
  'billing',
  'stripe',
] as const;

/**
 * Extended financial & checkout keywords for comprehensive defense
 */
export const EXTENDED_RESTRICTED_DOMAINS: readonly string[] = [
  ...RESTRICTED_DOMAINS,
  'paypal',
  'netbanking',
] as const;

export interface DomainSafetyResult {
  /** Whether the domain/URL is safe for agent automation */
  isSafe: boolean;
  /** Whether the domain/URL is blocked by safety guardrails */
  isBlocked: boolean;
  /** Parsed hostname of the URL if valid */
  domain?: string;
  /** The specific blacklist keyword that triggered the block */
  matchedKeyword?: string;
  /** Human-readable explanation of the block */
  reason?: string;
}

/**
 * Generates an informative explanation for blocked domains
 */
export function getRestrictedDomainReason(keyword?: string): string {
  if (!keyword) {
    return 'Sensitive financial, payment, or checkout domain is blocked to protect user security.';
  }

  const upper = keyword.toUpperCase();
  if (keyword === 'bank' || keyword === 'netbanking') {
    return `Banking domain detected (${upper}). Automation is blocked to safeguard your banking credentials and account funds.`;
  }
  if (['paytm', 'phonepe', 'razorpay', 'upi', 'paypal', 'stripe'].includes(keyword.toLowerCase())) {
    return `Payment gateway detected (${upper}). Automation is blocked to prevent unauthorized financial transactions.`;
  }
  if (['checkout', 'billing'].includes(keyword.toLowerCase())) {
    return `Checkout / Billing page detected (${upper}). Automation is blocked to prevent accidental orders or charges.`;
  }
  return `Sensitive domain keyword detected (${upper}). Automation is blocked by safety guardrails.`;
}

/**
 * Parses and extracts normalized hostname and path components from a URL string
 */
function parseUrlComponents(urlStr?: string | null): { hostname: string; pathname: string; full: string } | null {
  if (!urlStr || typeof urlStr !== 'string') {
    return null;
  }

  const clean = urlStr.trim();
  if (!clean) return null;

  try {
    const parsed = new URL(clean);
    return {
      hostname: parsed.hostname.toLowerCase(),
      pathname: parsed.pathname.toLowerCase(),
      full: parsed.href.toLowerCase(),
    };
  } catch {
    // If not a full URL, try prepending https://
    try {
      const parsed = new URL(`https://${clean}`);
      return {
        hostname: parsed.hostname.toLowerCase(),
        pathname: parsed.pathname.toLowerCase(),
        full: parsed.href.toLowerCase(),
      };
    } catch {
      // Return raw lowercase string for pattern inspection
      const lower = clean.toLowerCase();
      return {
        hostname: lower,
        pathname: lower,
        full: lower,
      };
    }
  }
}

/**
 * Deterministically checks whether a URL or domain matches the restricted blacklist.
 * Returns true if blocked, false if safe.
 */
export function isRestrictedDomain(urlStr?: string | null): boolean {
  return checkDomainSafety(urlStr).isBlocked;
}

/**
 * Alias for isRestrictedDomain
 */
export function isBlockedDomain(urlStr?: string | null): boolean {
  return isRestrictedDomain(urlStr);
}

/**
 * Checks safety of a given URL and returns detailed diagnostic results.
 */
export function checkDomainSafety(urlStr?: string | null): DomainSafetyResult {
  if (!urlStr || typeof urlStr !== 'string' || !urlStr.trim()) {
    return {
      isSafe: true,
      isBlocked: false,
    };
  }

  const components = parseUrlComponents(urlStr);
  if (!components) {
    return {
      isSafe: true,
      isBlocked: false,
    };
  }

  const { hostname, pathname, full } = components;

  // 1. Check hostname against restricted keywords
  for (const keyword of EXTENDED_RESTRICTED_DOMAINS) {
    const pattern = new RegExp(`(^|\\.|-)${keyword}(\\.|-|$)|${keyword}`, 'i');
    if (pattern.test(hostname)) {
      return {
        isSafe: false,
        isBlocked: true,
        domain: hostname,
        matchedKeyword: keyword,
        reason: getRestrictedDomainReason(keyword),
      };
    }
  }

  // 2. Check path segments for sensitive endpoints (e.g. /checkout, /billing, /upi, /bank)
  for (const keyword of EXTENDED_RESTRICTED_DOMAINS) {
    // Match /keyword, /keyword/, or keyword in path segments
    const pathPattern = new RegExp(`(^|/|-)(${keyword})(/|-|\\?|$)`, 'i');
    if (pathPattern.test(pathname)) {
      return {
        isSafe: false,
        isBlocked: true,
        domain: hostname,
        matchedKeyword: keyword,
        reason: getRestrictedDomainReason(keyword),
      };
    }
  }

  return {
    isSafe: true,
    isBlocked: false,
    domain: hostname,
  };
}
