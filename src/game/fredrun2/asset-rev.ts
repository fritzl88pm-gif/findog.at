/**
 * Cache-Busting für Assets unter /fredrun2/: `withRev("/fredrun2/props/manifest.json")` → `…?v=<Hash der Gruppe>`.
 * Die Hashes erzeugt `tools/fredrun2/asset-rev.mjs` (asset-rev.generated.ts); nach jeder Änderung an public/fredrun2 neu ausführen –
 * `asset-rev.test.ts` schlägt sonst fehl.
 */
import { ASSET_REVS } from "./asset-rev.generated";

const PREFIX = "/fredrun2/";

/** Gruppe einer Asset-URL (erstes Verzeichnis unter /fredrun2, Dateien direkt darunter → „root“). */
function groupOf(url: string): string {
  const rest = url.slice(PREFIX.length).split("?")[0];
  const i = rest.indexOf("/");
  return i < 0 ? "root" : rest.slice(0, i);
}

export function withRev(url: string): string {
  if (!url.startsWith(PREFIX) || /[?&]v=/.test(url)) return url;
  const rev = ASSET_REVS[groupOf(url)];
  if (!rev) return url;
  return url + (url.includes("?") ? "&" : "?") + "v=" + rev;
}
