import { API_BASE_URL } from "./client";

/**
 * Reference images are addressed by reference ID, never by the `originalPath`
 * or `thumbnailPath` fields on the reference record — those are storage-root
 * relative filesystem paths and the storage directory is not served.
 *
 * Both URLs are same-origin so the Vite `/api` proxy carries them, which keeps
 * the request inside the API's loopback Origin allow-list without needing
 * `crossOrigin` on the element.
 */

/** WebP thumbnail. The only image the catalogue grid is allowed to request. */
export function referenceThumbnailUrl(referenceId: string): string {
  return `${API_BASE_URL}/media/${encodeURIComponent(referenceId)}/thumbnail`;
}

/**
 * Full-size original (JPEG/PNG/WebP); for website captures this is the primary
 * viewport frame. Detail views only — never the catalogue grid.
 */
export function referenceOriginalUrl(referenceId: string): string {
  return `${API_BASE_URL}/media/${encodeURIComponent(referenceId)}/original`;
}

export type MotionMediaKind = "clip" | "preview" | "poster" | "energy" | "regions" | "contact-sheet";

/**
 * Motion media is addressed by clip ID. `clip` and `preview` are served with
 * byte ranges, so a <video> can seek and scrub without downloading the file.
 * Catalogue plates play `preview` only; the full `clip` is for the detail sheet.
 */
export function motionMediaUrl(clipId: string, kind: MotionMediaKind): string {
  return `${API_BASE_URL}/media/motion/${encodeURIComponent(clipId)}/${kind}`;
}

export function motionKeyframeUrl(clipId: string, index: number): string {
  return `${API_BASE_URL}/media/motion/${encodeURIComponent(clipId)}/keyframes/${index}`;
}

export function motionBurstUrl(clipId: string, index: number): string {
  return `${API_BASE_URL}/media/motion/${encodeURIComponent(clipId)}/bursts/${index}`;
}
