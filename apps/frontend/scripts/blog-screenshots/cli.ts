import { BLOG_SHOT_IDS, formatCatalog, getShotById, type BlogShot, type BlogShotId } from "./catalog";

export type BlogScreenshotArgs = {
  help: boolean;
  list: boolean;
  only: BlogShot[] | null;
  outDir: string | null;
};

const USAGE = `Usage: npm run blog:screenshots -- [options]

Capture named patient-UI screenshots from the real stub app into public/blog/.

Options:
  --list              Print the shot catalog and exit
  --only id[,id...]   Capture only these shot ids (catalog order)
  --out <dir>         Output directory (default: apps/frontend/public/blog)
  --help              Show this help

Examples:
  npm run blog:screenshots
  npm run blog:screenshots -- --list
  npm run blog:screenshots -- --only home,result

Requires \`npm run dev\` with NEXT_PUBLIC_LIFF_ID unset, seeded /dev/personas,
and the backend. ffmpeg is optional (fake camera for the capture viewfinder).
`;

function parseOnly(raw: string): BlogShot[] {
  const ids = raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    throw new Error("--only needs at least one shot id. Use --list to see the catalog.");
  }
  const unknown = ids.filter((id) => !getShotById(id));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown shot id(s): ${unknown.join(", ")}.\nKnown ids: ${BLOG_SHOT_IDS.join(", ")}`
    );
  }
  const selected = new Set(ids as BlogShotId[]);
  return BLOG_SHOT_IDS.filter((id) => selected.has(id)).map((id) => getShotById(id)!);
}

export function parseArgs(argv: string[]): BlogScreenshotArgs {
  const args: BlogScreenshotArgs = {
    help: false,
    list: false,
    only: null,
    outDir: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--help" || token === "-h") {
      args.help = true;
      continue;
    }
    if (token === "--list") {
      args.list = true;
      continue;
    }
    if (token === "--only") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--only requires a comma-separated list of shot ids.");
      }
      args.only = parseOnly(value);
      index += 1;
      continue;
    }
    if (token.startsWith("--only=")) {
      args.only = parseOnly(token.slice("--only=".length));
      continue;
    }
    if (token === "--out") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--out requires a directory path.");
      }
      args.outDir = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--out=")) {
      args.outDir = token.slice("--out=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${token}\n\n${USAGE}`);
  }

  return args;
}

export { formatCatalog, USAGE };
