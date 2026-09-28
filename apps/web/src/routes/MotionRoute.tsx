import { useCallback, useRef } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { CatalogueView } from "@/components/catalogue/CatalogueView";
import { MotionModal } from "@/components/motion/MotionModal";
import { MotionView } from "@/components/motion/MotionView";
import { filterLabel } from "@/lib/catalogue/filters";
import { requestPlateFocus } from "@/lib/catalogue/plateFocus";
import {
  backdropPath,
  sheetStackFromState,
  SheetStackProvider,
  type SheetStack,
} from "@/lib/navigation/sheetStack";

/** `/motion` — the moving plates. */
export function MotionRoute() {
  return <MotionView />;
}

function originFromState(state: unknown): string {
  if (typeof state === "object" && state !== null && "origin" in state) {
    const origin = (state as { origin: unknown }).origin;
    if (typeof origin === "string" && origin.startsWith("/motion")) return origin;
  }
  return "/motion";
}

/**
 * `/motion/:referenceId` — the motion sheet raised over the Motion grid (or
 * over the catalogue, when the reader turned to it from a reference sheet
 * opened there). The address carries `?clip=` and `?t=` so a moment in a
 * recording can be linked; it is kept in step (replace, not push) as the
 * reader scrubs.
 */
export function MotionStudyRoute() {
  const { referenceId = "" } = useParams<{ referenceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  /*
   * Decided once, on arrival: the player rewrites `?clip=&t=` with replace
   * navigations, which change the location key, and a direct visit must still
   * close to the grid rather than stepping back out of the app. Turned to from
   * a reference sheet, the study inherits that sheet's stack instead; the
   * player keeps the state, so it survives the rewrites.
   */
  const arrival = useRef<SheetStack>({
    backdrop: { kind: "motion", path: originFromState(location.state) },
    inHistory: location.key !== "default",
  }).current;
  const stack = sheetStackFromState(location.state) ?? arrival;
  const origin = backdropPath(stack.backdrop);

  // The first address wins; later updates only follow the player.
  const initial = useRef({
    clip: searchParams.get("clip"),
    ms: Number.isFinite(Number(searchParams.get("t"))) && searchParams.get("t") !== null ? Number(searchParams.get("t")) : null,
  });
  const lastWrite = useRef(0);

  const close = useCallback(() => {
    // Back over the catalogue, the plate the stack was opened from takes focus.
    if (stack.backdrop.kind === "catalogue") requestPlateFocus(referenceId);
    if (stack.inHistory) navigate(-1);
    else navigate(origin, { replace: true });
  }, [navigate, origin, referenceId, stack]);

  const deleted = useCallback(() => navigate(origin, { replace: true }), [navigate, origin]);

  const onMoment = useCallback((clipId: string, ms: number) => {
    // Throttled: the player reports several times a second while playing.
    const now = Date.now();
    if (now - lastWrite.current < 750) return;
    lastWrite.current = now;
    setSearchParams({ clip: clipId, t: String(Math.round(ms)) }, { replace: true, state: location.state });
  }, [location.state, setSearchParams]);

  return (
    <SheetStackProvider value={stack}>
      {stack.backdrop.kind === "catalogue" ? (
        <CatalogueView filter={stack.backdrop.filter} label={filterLabel(stack.backdrop.filter)} />
      ) : (
        <MotionView address={stack.backdrop.path} />
      )}
      <MotionModal
        referenceId={referenceId}
        initialClipId={initial.current.clip}
        initialMs={initial.current.ms}
        onClose={close}
        onDeleted={deleted}
        onMoment={onMoment}
      />
    </SheetStackProvider>
  );
}
