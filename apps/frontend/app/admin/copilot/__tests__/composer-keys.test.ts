import type { KeyboardEvent } from "react";

import { shouldSendOnEnter } from "@/app/admin/copilot/_components/composer-keys";

function keyEvent(
  overrides: { key?: string; shiftKey?: boolean; isComposing?: boolean; keyCode?: number } = {},
): KeyboardEvent<HTMLElement> {
  const { key = "Enter", shiftKey = false, isComposing = false, keyCode = 13 } = overrides;
  return {
    key,
    shiftKey,
    nativeEvent: { isComposing, keyCode },
  } as KeyboardEvent<HTMLElement>;
}

describe("shouldSendOnEnter", () => {
  it("sends on a plain Enter", () => {
    expect(shouldSendOnEnter(keyEvent(), false)).toBe(true);
  });

  it("does not send on Shift+Enter", () => {
    expect(shouldSendOnEnter(keyEvent({ shiftKey: true }), false)).toBe(false);
  });

  it("does not send on any other key", () => {
    expect(shouldSendOnEnter(keyEvent({ key: "a", keyCode: 65 }), false)).toBe(false);
  });

  it("does not send the Enter that picks an IME candidate", () => {
    expect(shouldSendOnEnter(keyEvent({ isComposing: true, keyCode: 229 }), true)).toBe(false);
  });

  it("does not send when only the native isComposing flag is set", () => {
    expect(shouldSendOnEnter(keyEvent({ isComposing: true }), false)).toBe(false);
  });

  it("does not send when only keyCode 229 marks the key as IME-handled", () => {
    expect(shouldSendOnEnter(keyEvent({ keyCode: 229 }), false)).toBe(false);
  });

  it("does not send a key the IME claimed as its own (reported as \"Process\")", () => {
    expect(shouldSendOnEnter(keyEvent({ key: "Process", keyCode: 229 }), false)).toBe(false);
  });

  it("does not send when Safari has already ended composition before the keydown", () => {
    expect(shouldSendOnEnter(keyEvent(), true)).toBe(false);
  });

  it("sends the Enter that follows a finished composition", () => {
    expect(shouldSendOnEnter(keyEvent(), false)).toBe(true);
  });
});
