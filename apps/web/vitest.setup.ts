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

afterEach(() => {
  cleanup();
});
