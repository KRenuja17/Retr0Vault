import { useCallback, useEffect, useRef, useState } from "react";

import { ActionButton, type ActionButtonVariant } from "./ActionButton";

type CopyState = "idle" | "copied" | "failed";

/** How long the button holds its confirmation before returning to its label. */
const RESET_AFTER_MS = 1_600;

export interface CopyActionButtonProps {
  readonly label: string;
  readonly text: string;
  readonly variant?: ActionButtonVariant;
  readonly disabled?: boolean;
  readonly title?: string | undefined;
}

/**
 * A copy control that confirms in place. No toast, no floating notification:
 * the label becomes COPIED and returns on its own, which is the whole feedback.
 */
export function CopyActionButton({
  label,
  text,
  variant = "solid",
  disabled = false,
  title,
}: CopyActionButtonProps) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      if (timer.current !== undefined) {
        clearTimeout(timer.current);
      }
    },
    [],
  );

  const copy = useCallback(async () => {
    if (timer.current !== undefined) {
      clearTimeout(timer.current);
    }

    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch {
      // Clipboard access can be refused outright; say so rather than claiming success.
      setState("failed");
    }

    timer.current = setTimeout(() => setState("idle"), RESET_AFTER_MS);
  }, [text]);

  const shown =
    state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;

  return (
    <>
      <ActionButton
        variant={variant}
        disabled={disabled || text.length === 0}
        onClick={() => void copy()}
        {...(title === undefined ? {} : { title })}
      >
        {shown}
      </ActionButton>
      <span className="rv-visually-hidden" role="status">
        {state === "copied"
          ? `${label} copied to the clipboard`
          : state === "failed"
            ? `${label} could not be copied`
            : ""}
      </span>
    </>
  );
}
