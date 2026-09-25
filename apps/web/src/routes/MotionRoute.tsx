import { useCallback, useRef } from "react";
import { useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { MotionModal } from "@/components/motion/MotionModal";
import { MotionView } from "@/components/motion/MotionView";

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
 * `/motion/:referenceId` — the motion sheet raised over the Motion grid. The
 * address carries `?clip=` and `?t=` so a moment in a recording can be linked;
 * it is kept in step (replace, not push) as the reader scrubs.
 */
export function MotionStudyRoute() {
  const { referenceId = "" } = useParams<{ referenceId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const origin = originFromState(location.state);
  /*
   * Decided once, on arrival: the player rewrites `?clip=&t=` with replace
   * navigations, which change the location key, and a direct visit must still
   * close to the grid rather than stepping back out of the app.
   */
  const openedFromGrid = useRef(location.key !== "default").current;

  // The first address wins; later updates only follow the player.
  const initial = useRef({
    clip: searchParams.get("clip"),
    ms: Number.isFinite(Number(searchParams.get("t"))) && searchParams.get("t") !== null ? Number(searchParams.get("t")) : null,
  });
  const lastWrite = useRef(0);

  const close = useCallback(() => {
    if (openedFromGrid) navigate(-1);
    else navigate(origin, { replace: true });
  }, [navigate, openedFromGrid, origin]);

  const deleted = useCallback(() => navigate(origin, { replace: true }), [navigate, origin]);

  const onMoment = useCallback((clipId: string, ms: number) => {
    // Throttled: the player reports several times a second while playing.
    const now = Date.now();
    if (now - lastWrite.current < 750) return;
    lastWrite.current = now;
    setSearchParams({ clip: clipId, t: String(Math.round(ms)) }, { replace: true, state: location.state });
  }, [location.state, setSearchParams]);

  return (
    <>
      <MotionView address={origin} />
      <MotionModal
        referenceId={referenceId}
        initialClipId={initial.current.clip}
        initialMs={initial.current.ms}
        onClose={close}
        onDeleted={deleted}
        onMoment={onMoment}
      />
    </>
  );
}
