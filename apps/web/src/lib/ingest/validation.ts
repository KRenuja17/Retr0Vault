/*
 * Client-side checks for the accession forms.
 *
 * None of these are the authority — the API re-validates every field, sniffs
 * the real image format and enforces its own upload limit. They exist so an
 * obvious mistake is answered on the page instead of after a 25 MB round trip.
 */

/** Formats the backend accepts, verified there by content rather than by name. */
export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** Extensions used only when the browser reports no MIME type at all. */
const ACCEPTED_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"] as const;

/** The `accept` attribute for the file input. */
export const IMAGE_ACCEPT_ATTRIBUTE = [
  ...ACCEPTED_IMAGE_TYPES,
  ...ACCEPTED_EXTENSIONS,
].join(",");

/** Mirrors the API's MAX_UPLOAD_BYTES default (25 MiB). */
export const MAX_UPLOAD_BYTES = 25 * 1_024 * 1_024;

/**
 * Spaces, backslashes and control characters, all rejected by the capture
 * route. Written as a scan rather than a regex so the literal control
 * characters never have to appear in this file.
 */
function hasUnsafeUrlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code <= 0x20 || code === 0x7f || character === "\\") {
      return true;
    }
  }
  return false;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 KB";
  if (bytes < 1_024) return `${bytes} B`;
  const kilobytes = bytes / 1_024;
  if (kilobytes < 1_024) return `${Math.round(kilobytes)} KB`;
  return `${(kilobytes / 1_024).toFixed(1)} MB`;
}

function hasAcceptedExtension(name: string): boolean {
  const lower = name.toLocaleLowerCase("en-US");
  return ACCEPTED_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** A human-readable reason the file cannot be sent, or null when it can. */
export function validateImageFile(file: File): string | null {
  if (file.size === 0) {
    return `${file.name} is empty. Choose an image with content in it.`;
  }

  const type = file.type.toLocaleLowerCase("en-US");
  const acceptedType = (ACCEPTED_IMAGE_TYPES as readonly string[]).includes(type);
  if (!acceptedType && !(type === "" && hasAcceptedExtension(file.name))) {
    return `Only JPEG, PNG and WebP images are accepted. ${file.name} is ${
      type === "" ? "an unrecognised file type" : type
    }.`;
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return `${file.name} is ${formatBytes(file.size)}. The archive accepts up to ${formatBytes(
      MAX_UPLOAD_BYTES,
    )} per plate.`;
  }

  return null;
}

/**
 * Mirrors the shared `captureUrlSchema` rules: HTTP(S) only, standard port, no
 * credentials, no whitespace/backslashes/control characters. Kept as a local
 * check rather than importing the schema so the browser bundle carries no
 * validation library; the backend rejects anything this misses.
 */
export function validateCaptureUrl(value: string): string | null {
  const candidate = value.trim();
  if (candidate.length === 0) {
    return "Enter the address of a public page to capture.";
  }
  if (candidate.length > 2_048) {
    return "That address is longer than 2048 characters.";
  }
  if (hasUnsafeUrlCharacter(candidate)) {
    return "An address cannot contain spaces, backslashes or control characters.";
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return "That is not a complete address. Include https:// at the front.";
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "Only http:// and https:// addresses can be captured.";
  }
  if (url.username !== "" || url.password !== "") {
    return "An address with credentials in it cannot be captured.";
  }
  if (url.port !== "") {
    return "Capture uses the standard port; remove the port from the address.";
  }

  return null;
}

/** The optional source-URL field on the image form; blank is allowed there. */
export function validateSourceUrl(value: string): string | null {
  const candidate = value.trim();
  if (candidate.length === 0) return null;

  if (hasUnsafeUrlCharacter(candidate)) {
    return "A source address cannot contain spaces or backslashes.";
  }

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return "Leave the source blank, or give a complete https:// address.";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return "A source must be an http:// or https:// address.";
  }
  if (url.username !== "" || url.password !== "") {
    return "A source address cannot carry credentials.";
  }
  return null;
}
