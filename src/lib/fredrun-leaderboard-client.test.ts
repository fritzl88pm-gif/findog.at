// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { useFredRunLeaderboard } from "./fredrun-leaderboard-client";
import type { FredRunWorldId } from "./fredrun-worlds";

let root: Root;
let board: ReturnType<typeof useFredRunLeaderboard>;
let gameWorld: FredRunWorldId;
const requests: {url: string; resolve: (response: Response) => void}[] = [];
const onPlayerName = vi.fn();
const onBlocked = vi.fn();
function Harness() {
  board = useFredRunLeaderboard("test-token", gameWorld, onPlayerName, onBlocked);
  return createElement("div", null, `${board.world}:${board.state}:${board.entries.map(e => e.name).join()}`);
}
async function render() { await act(async () => root.render(createElement(Harness))); }
async function reply(index: number, world: FredRunWorldId, name: string = world, status = 200) {
  await act(async () => requests[index].resolve(new Response(JSON.stringify({world, entries: [{rank: 1, name, score: 10}], playerName: "Fred"}), {status})));
}
beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  gameWorld = "vienna";
  requests.length = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => new Promise<Response>(resolve => requests.push({url, resolve}))));
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllGlobals(); });
it("ignores late GET completion even when fetch ignores abort, and switches immediately to an empty loading view", async () => {
  await render();
  await act(async () => board.selectWorld("alps"));
  expect(board.world).toBe("alps");
  expect(board.entries).toEqual([]);
  expect(board.state).toBe("loading");
  expect(requests.map(r => r.url)).toEqual(["/api/fredrun/highscores?world=vienna", "/api/fredrun/highscores?world=alps"]);
  await reply(1, "alps");
  await reply(0, "vienna");
  expect(board.entries[0].name).toBe("alps");
  expect(board.world).toBe("alps");
});
it("rejects a response for a different world and ignores a stale error", async () => {
  await render();
  await act(async () => board.selectWorld("alps"));
  await reply(1, "vienna");
  expect(board.state).toBe("error");
  expect(board.entries).toEqual([]);
  await act(async () => board.retry());
  await reply(2, "alps");
  await reply(0, "vienna", "old", 503);
  expect(board.state).toBe("ready");
});
it("browses independently, follows a newly selected game world, and refreshes only the submitted world's board", async () => {
  await render();
  await reply(0, "vienna");
  await act(async () => board.selectWorld("finanzamt-night"));
  expect(gameWorld).toBe("vienna");
  await reply(1, "finanzamt-night");
  await act(async () => board.refreshWorld("vienna")); // Late POST for the completed Vienna run.
  expect(board.world).toBe("finanzamt-night");
  expect(board.entries[0].name).toBe("finanzamt-night");
  expect(requests).toHaveLength(2);
  gameWorld = "alps";
  await render();
  expect(board.world).toBe("alps");
  await reply(2, "alps");
  await act(async () => board.refreshWorld("alps"));
  expect(requests).toHaveLength(4);
  await reply(3, "alps", "New run");
  expect(board.entries[0].name).toBe("New run");
});
