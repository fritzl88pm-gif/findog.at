#!/usr/bin/env node
/**
 * Audio-Erzeugung über kie.ai (nur Entwicklungswerkzeug – der Schlüssel kommt aus der Umgebung, nie ins Repo).
 *   KIE_API_KEY=… node tools/fredrun2/kie-audio.mjs music menu wien alpen --out /tmp/audio
 *   KIE_API_KEY=… node tools/fredrun2/kie-audio.mjs credits
 * Suno: POST /api/v1/generate → Polling /api/v1/generate/record-info (2 Kandidaten je Aufruf, 12 Credits).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = process.env.KIE_API_KEY;
if (!KEY) {
  console.error("KIE_API_KEY fehlt");
  process.exit(2);
}
const API = "https://api.kie.ai/api/v1";
const [cmd, ...rest] = process.argv.slice(2);
const outIdx = rest.indexOf("--out");
const outDir = outIdx >= 0 ? rest.splice(outIdx, 2)[1] : "/tmp/fr2-audio";
const modelIdx = rest.indexOf("--model");
const modelOverride = modelIdx >= 0 ? rest.splice(modelIdx, 2)[1] : null;
const prompts = JSON.parse(await readFile(path.join(here, "audio_prompts.json"), "utf8"));

const headers = { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(method, url, body) {
  const res = await fetch(url.startsWith("http") ? url : `${API}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Antwort kein JSON (${res.status}): ${text.slice(0, 200)}`);
  }
}
const credits = async () => (await api("GET", "/chat/credit")).data;

async function downloadTo(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download ${res.status}: ${url}`);
  await writeFile(file, Buffer.from(await res.arrayBuffer()));
}

async function music(id) {
  const p = prompts.music[id];
  if (!p) throw new Error(`Unbekanntes Stück: ${id}`);
  const started = await api("POST", "/generate", {
    customMode: true,
    instrumental: true,
    model: modelOverride ?? prompts.model,
    title: p.title,
    style: p.style,
    prompt: "",
    callBackUrl: "https://example.com/cb",
  });
  if (started.code !== 200) throw new Error(`${id}: ${JSON.stringify(started).slice(0, 300)}`);
  const taskId = started.data.taskId;
  console.log(`[${id}] Task ${taskId}`);
  for (let i = 0; i < 80; i++) {
    await sleep(10000);
    const r = await api("GET", `/generate/record-info?taskId=${taskId}`);
    const st = r.data?.status;
    if (st === "SUCCESS") {
      const tracks = r.data.response?.sunoData ?? [];
      const res = [];
      for (let k = 0; k < tracks.length; k++) {
        const t = tracks[k];
        const file = path.join(outDir, `${id}-${String.fromCharCode(97 + k)}.mp3`);
        await downloadTo(t.audioUrl || t.audio_url, file);
        res.push({ file, id: t.id, duration: t.duration, tags: t.tags });
        console.log(`[${id}] ${file} (${Math.round(t.duration)} s)`);
      }
      await writeFile(path.join(outDir, `${id}.json`), JSON.stringify({ taskId, tracks: res }, null, 2));
      return res;
    }
    if (st && /FAIL|ERROR/.test(st)) throw new Error(`${id}: ${st} ${r.data?.errorMessage ?? ""}`);
  }
  throw new Error(`${id}: Zeitüberschreitung`);
}

await mkdir(outDir, { recursive: true });
if (cmd === "credits") {
  console.log("Credits:", await credits());
} else if (cmd === "music") {
  const ids = rest.length ? rest : Object.keys(prompts.music);
  console.log("Credits vorher:", await credits());
  const results = await Promise.allSettled(ids.map(music));
  results.forEach((r, i) => r.status === "rejected" && console.error(`FEHLER ${ids[i]}: ${r.reason?.message}`));
  console.log("Credits nachher:", await credits());
} else {
  console.error("Verwendung: credits | music [ids…] [--out dir] [--model V5]");
  process.exit(1);
}
