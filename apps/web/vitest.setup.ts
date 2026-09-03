import "@testing-library/jest-dom/vitest";

import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

/*
 * jsdom installs its own AbortController/AbortSignal, but `Request` comes from
 * Node's undici, which brand-checks `init.signal` against Node's AbortSignal
 * and throws "Expected signal to be an instance of AbortSignal". React Router
 * builds a Request for every client-side navigation, so the mismatch breaks any
 * test that navigates. Nothing here exercises cancellation, so the signal is
 * dropped rather than reconciled.
 */
const BaseRequest = globalThis.Request;

class TestRequest extends BaseRequest {
  constructor(input: RequestInfo | URL, init?: RequestInit) {
    if (init && "signal" in init) {
      const withoutSignal: RequestInit = { ...init };
      delete withoutSignal.signal;
      super(input, withoutSignal);
      return;
    }
    super(input, init);
  }
}

globalThis.Request = TestRequest as unknown as typeof Request;

/*
 * jsdom's Blob implements neither text() nor arrayBuffer(), although every
 * browser this app targets has shipped both since 2019. Analysis files chosen
 * on the desk are read with Blob.text(), so the standard reader is supplied
 * here rather than the source being written around a test-environment gap.
 */
if (typeof Blob.prototype.text !== "function") {
  Blob.prototype.text = function text(this: Blob): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("load", () => resolve(String(reader.result)));
      reader.addEventListener("error", () =>
        reject(reader.error ?? new Error("The file could not be read")),
      );
      reader.readAsText(this);
    });
  };
}

/*
 * jsdom has no 2D canvas and logs a "not implemented" jsdomError the first time
 * anything asks for a context, which would fire on every route render now that
 * the environment layer is part of the shell. A quiet null is the honest answer
 * — the layer treats it as "no canvas here" and draws nothing. The reactive
 * grid suite installs a recording stub over this to exercise the real path.
 */
HTMLCanvasElement.prototype.getContext = function getContext(): null {
  return null;
} as typeof HTMLCanvasElement.prototype.getContext;

afterEach(() => {
  cleanup();
});
