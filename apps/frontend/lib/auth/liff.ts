"use client";

declare global {
  interface Window {
    liff?: {
      init: (config: { liffId: string }) => Promise<void>;
      isLoggedIn: () => boolean;
      login: (config?: { redirectUri?: string }) => void;
      getProfile: () => Promise<{
        userId: string;
        displayName: string;
        pictureUrl?: string;
      }>;
    };
  }
}

type LiffProfile = {
  userId: string;
  displayName: string;
  pictureUrl?: string;
};

let liffReadyPromise: Promise<void> | null = null;

function loadLiffSdk(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("LIFF SDK is only available in the browser"));
  }
  if (window.liff) {
    return Promise.resolve();
  }
  if (liffReadyPromise) {
    return liffReadyPromise;
  }

  liffReadyPromise = new Promise<void>((resolve, reject) => {
    const existing = document.getElementById("line-liff-sdk");
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Failed to load LIFF SDK")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "line-liff-sdk";
    script.src = "https://static.line-scdn.net/liff/edge/2/sdk.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load LIFF SDK"));
    document.head.appendChild(script);
  });

  return liffReadyPromise;
}

export async function getLiffProfile(): Promise<LiffProfile> {
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    throw new Error("尚未設定 NEXT_PUBLIC_LIFF_ID，請先完成 LIFF 環境設定。");
  }

  await loadLiffSdk();
  if (!window.liff) {
    throw new Error("LIFF SDK 尚未初始化完成");
  }

  await window.liff.init({ liffId });
  if (!window.liff.isLoggedIn()) {
    window.liff.login({ redirectUri: window.location.href });
    throw new Error("正在導向 LINE 登入...");
  }

  const profile = await window.liff.getProfile();
  return {
    userId: profile.userId,
    displayName: profile.displayName,
    pictureUrl: profile.pictureUrl,
  };
}
