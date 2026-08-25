import { BLOG_SHOT_CATALOG, BLOG_SHOT_IDS } from "./catalog";
import { parseArgs } from "./cli";

describe("blog screenshot catalog", () => {
  it("has unique ids and output files", () => {
    const ids = BLOG_SHOT_CATALOG.map((shot) => shot.id);
    const files = BLOG_SHOT_CATALOG.map((shot) => shot.file);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(files).size).toBe(files.length);
    expect(ids).toEqual([...BLOG_SHOT_IDS]);
  });
});

describe("parseArgs", () => {
  it("parses --list and --help", () => {
    expect(parseArgs(["--list"]).list).toBe(true);
    expect(parseArgs(["--help"]).help).toBe(true);
    expect(parseArgs(["-h"]).help).toBe(true);
  });

  it("keeps catalog order for gallery flow ids", () => {
    const parsed = parseArgs(["--only", "gallery-calendar,gallery"]);
    expect(parsed.only?.map((shot) => shot.id)).toEqual(["gallery", "gallery-calendar"]);
  });

  it("rejects unknown shot ids", () => {
    expect(() => parseArgs(["--only", "home,nope"])).toThrow(/Unknown shot id/);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["--foo"])).toThrow(/Unknown argument/);
  });
});
