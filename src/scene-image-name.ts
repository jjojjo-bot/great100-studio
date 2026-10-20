import type { Scene } from "./types";

const encode = (value: string) => btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function decode(value: string): string {
  const raw = value.replace(/-/g, "+").replace(/_/g, "/");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(raw + "=".repeat((4 - raw.length % 4) % 4)), char => char.charCodeAt(0)));
  if (encode(text) !== value) throw new Error("Invalid filename identity");
  return text;
}

export function sceneImageFilename(projectId: string, scene: Pick<Scene, "id" | "number">): string {
  return `scene_${String(scene.number).padStart(2, "0")}__g100[${encode(projectId)}.${encode(scene.id)}].png`;
}

// undefined permits legacy scene-number inference. Any Great100 marker must
// resolve by both identities, even when malformed, copied to another project,
// or referring to a scene removed by a merge. Never fall back to its old number.
export function sceneFromImageFilename(name: string, scenes: Scene[], projectId?: string): string | undefined {
  if (!/__g100/i.test(name)) return undefined;
  const markers = name.match(/__g100/gi), matches = [...name.matchAll(/__g100\[([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\]/gi)];
  if (!projectId || markers?.length !== 1 || matches.length !== 1) return "";
  try {
    if (decode(matches[0][1]) !== projectId) return "";
    const id = decode(matches[0][2]), found = scenes.filter(scene => scene.id === id);
    return found.length === 1 ? found[0].id : "";
  } catch { return ""; }
}
