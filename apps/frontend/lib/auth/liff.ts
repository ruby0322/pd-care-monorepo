"use client";

declare global {
  interface Window {
    liff?: {
      init: (config: { liffId: string }) => Promise<void>;
      isLoggedIn: () => boolean;
      login: (config?: { redirectUri?: string }) => void;
      getIDToken: () => string | null;
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

const DEV_LINE_USER_STORAGE_KEY = "pdCare.devLineUserId";

/**
 * Dev-only: when NEXT_PUBLIC_LIFF_ID is unset and NODE_ENV is development,
 * resolve a fake LINE user id so patient flows (e.g. calendar) can call the backend.
 * Production builds never use this path.
 *
 * Priority: URL ?dev_line_user_id= → NEXT_PUBLIC_DEV_LINE_USER_ID → localStorage.
 */
function resolveDevBypassLineUserId(): string | null {
  if (typeof window !== "undefined") {
    const fromQuery = new URLSearchParams(window.location.search).get("dev_line_user_id");
    if (fromQuery?.trim()) {
      return fromQuery.trim();
    }
  }

  const fromEnv = process.env.NEXT_PUBLIC_DEV_LINE_USER_ID?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  if (typeof window !== "undefined") {
    const fromStorage = window.localStorage.getItem(DEV_LINE_USER_STORAGE_KEY)?.trim();
    if (fromStorage) {
      return fromStorage;
    }
  }

  return null;
}

function devBypassProfile(): LiffProfile | null {
  if (process.env.NODE_ENV !== "development") {
    return null;
  }
  if (process.env.NEXT_PUBLIC_LIFF_ID) {
    return null;
  }

  const userId = resolveDevBypassLineUserId();
  if (!userId) {
    return null;
  }

  return {
    userId,
    displayName: process.env.NEXT_PUBLIC_DEV_DISPLAY_NAME?.trim() || "開發模式使用者",
    pictureUrl: process.env.NEXT_PUBLIC_DEV_PICTURE_URL?.trim() || undefined,
  };
}

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
  const bypass = devBypassProfile();
  if (bypass) {
    return bypass;
  }

  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  if (!liffId) {
    if (process.env.NODE_ENV === "development") {
      throw new Error(
        "開發模式：未設定 NEXT_PUBLIC_LIFF_ID。請在網址加上 ?dev_line_user_id=你的測試_ID、" +
          "或設定環境變數 NEXT_PUBLIC_DEV_LINE_USER_ID、" +
          `或在瀏覽器 console 執行 localStorage.setItem("${DEV_LINE_USER_STORAGE_KEY}", "你的測試_ID")。`
      );
    }
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

export async function getLiffLoginProof(): Promise<{ profile: LiffProfile; idToken: string }> {
  const profile = await getLiffProfile();
  const idToken = window.liff?.getIDToken?.();
  if (!idToken) {
    throw new Error("LINE 登入憑證不足，請確認 LIFF scope 包含 openid。");
  }
  return { profile, idToken };
}
