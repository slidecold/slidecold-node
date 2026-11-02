import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Verifies the `X-SlideCold-Signature` header: hex HMAC-SHA256 of the raw request body keyed with the
 * endpoint secret (`whsec_...`). Pass the body exactly as received, before JSON parsing.
 */
export function verifyWebhookSignature(
  rawBody: string | Buffer | Uint8Array,
  signatureHeader: string | null | undefined,
  secret: string,
): boolean {
  if (!signatureHeader || !secret) return false;
  const signature = signatureHeader.trim().toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
}
