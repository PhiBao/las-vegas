import "server-only";

import { createRequire } from "node:module";

const isVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV);

if (isVercel) {
  const require = createRequire(import.meta.url);
  try {
    const nodeFs = require("node:fs") as typeof import("node:fs");

    const origMkdirSync = nodeFs.mkdirSync;
    nodeFs.mkdirSync = function patchedMkdirSync(
      p: string | Buffer | URL,
      options?: { recursive?: boolean; mode?: string | number } | number
    ): string | undefined {
      const s = typeof p === "string" ? p : String(p);
      if (s === ".data" || s.endsWith("/.data") || s.includes("/.data/")) {
        try { origMkdirSync("/tmp/.data", { recursive: true }); } catch {}
        return undefined;
      }
      return origMkdirSync.call(nodeFs, p, options as { recursive?: boolean });
    } as typeof nodeFs.mkdirSync;

    const fsPromises = require("node:fs/promises") as typeof import("node:fs/promises");

    const origMkdir = fsPromises.mkdir;
    (fsPromises as unknown as Record<string, unknown>).mkdir = async function patchedMkdir(
      p: string | Buffer | URL,
      options?: { recursive?: boolean; mode?: string | number } | number
    ): Promise<string | undefined> {
      const s = typeof p === "string" ? p : String(p);
      if (s === ".data" || s.endsWith("/.data") || s.includes("/.data/")) {
        try { await origMkdir("/tmp/.data", { recursive: true }); } catch {}
        return undefined;
      }
      return origMkdir.call(fsPromises, p, options as { recursive?: boolean });
    };
  } catch {}
}
