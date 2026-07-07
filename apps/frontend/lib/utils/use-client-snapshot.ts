"use client";

import { useSyncExternalStore } from "react";

function subscribeNever(): () => void {
  return () => {};
}

/**
 * Reads a client-only value (e.g. localStorage-backed session state) without causing a
 * hydration mismatch: the server (and the client's first render, before hydration settles)
 * always sees `serverSnapshot`, and `getSnapshot` only runs once mounted in the browser.
 *
 * The value is read once per render and does not re-subscribe to external changes; callers
 * that need to react to session changes made elsewhere (e.g. another tab) should trigger a
 * re-render themselves (e.g. via navigation) rather than relying on this hook to notify them.
 */
export function useClientSnapshot<T>(getSnapshot: () => T, serverSnapshot: T): T {
  return useSyncExternalStore(subscribeNever, getSnapshot, () => serverSnapshot);
}
