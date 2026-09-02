import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

import ipaddr from "ipaddr.js";

import { captureUrlSchema } from "@retr0vault/shared";

import { ApiError } from "../errors.js";
import { parseRequest } from "../http/validation.js";

export interface CaptureTarget { readonly address: string; readonly family: 4 | 6; readonly port?: number }
export type ResolveCaptureTarget = (url: URL) => Promise<CaptureTarget>;
export type CaptureLookup = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

export function isPublicAddress(value: string): boolean {
  if (!isIP(value)) return false;
  const address = ipaddr.parse(value);
  // Mapped, transition, documentation, multicast and reserved ranges are not
  // public capture targets, even when they encode a public-looking IPv4 address.
  return address.range() === "unicast" &&
    (address.kind() === "ipv4" || address.match(ipaddr.parse("2000::"), 3));
}

export function validateCaptureUrl(value: string): URL {
  const url = new URL(parseRequest(captureUrlSchema, value));
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if ((!hostname.includes(".") && !isIP(hostname)) ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid|onion)$/.test(hostname) ||
      (isIP(hostname) && !isPublicAddress(hostname))) {
    throw new ApiError(400, "UNSAFE_CAPTURE_URL", "Website capture requires a public internet address");
  }
  return url;
}

export async function resolvePublicTarget(
  url: URL,
  resolve: CaptureLookup = (hostname) => lookup(hostname, { all: true, verbatim: true }),
): Promise<CaptureTarget> {
  validateCaptureUrl(url.href);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname);
  } catch {
    throw new ApiError(502, "CAPTURE_DNS_FAILED", "Could not resolve the website hostname");
  }
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new ApiError(400, "UNSAFE_CAPTURE_URL", "Website hostname resolves to a non-public address");
  }
  const first = addresses[0]!;
  return { address: first.address, family: first.family === 6 ? 6 : 4 };
}
