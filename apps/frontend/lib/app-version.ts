import packageJson from "../package.json";

/** Product version. Source of truth is `apps/frontend/package.json`. */
export const APP_VERSION = packageJson.version;

export const APP_VERSION_LABEL = `v${APP_VERSION}`;
