import packageJson from "../../package.json";
import { APP_VERSION, APP_VERSION_LABEL } from "@/lib/app-version";

describe("app version", () => {
  it("matches frontend package.json and uses a v prefix", () => {
    expect(APP_VERSION).toBe(packageJson.version);
    expect(APP_VERSION_LABEL).toBe(`v${packageJson.version}`);
    expect(APP_VERSION_LABEL).toBe("v0.1.0");
  });
});
