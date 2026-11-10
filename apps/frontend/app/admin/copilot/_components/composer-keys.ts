import type { KeyboardEvent } from "react";

// A CJK IME uses Enter to pick a candidate, and browsers disagree on how that keydown
// looks: Chromium reports keyCode 229 with isComposing set, Firefox reports isComposing,
// and Safari fires compositionend *before* the keydown so both flags are already clear.
// `isComposing` covers the first two; the caller's own composition flag covers Safari.
function isImeCandidateKey(event: KeyboardEvent<HTMLElement>): boolean {
  return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229 || event.key === "Process";
}

export function shouldSendOnEnter(event: KeyboardEvent<HTMLElement>, isComposing: boolean): boolean {
  if (event.key !== "Enter" || event.shiftKey) {
    return false;
  }
  return !isComposing && !isImeCandidateKey(event);
}
