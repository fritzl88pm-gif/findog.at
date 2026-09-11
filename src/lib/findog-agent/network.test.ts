import { createServer, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { FindogAgentNetworkError } from "./errors";
import {
  assertFindogAgentPublicUrl,
  createFindogAgentHttpTransport,
  hostMatchesAllowedDomain,
  isFindogAgentBlockedAddress,
  parseFindogAgentAllowedPrivateOrigins,
} from "./network";

let server: Server;
let port = 0;
let requestLog: string[] = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    requestLog.push(`${request.method} ${request.url}`);
    if (request.url === "/redirect-same") {
      response.writeHead(302, { location: "/ok" });
      response.end();
      return;
    }
    if (request.url === "/redirect-cross") {
      response.writeHead(302, { location: "https://evil.example.com/steal" });
      response.end();
      return;
    }
    if (request.url === "/big") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end("x".repeat(5000));
      return;
    }
    if (request.url === "/slow") {
      setTimeout(() => {
        try {
          response.writeHead(200, { "content-type": "text/plain" });
          response.end("late");
        } catch {
          // client already destroyed the socket
        }
      }, 300);
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, path: request.url }));
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  port = typeof address === "object" && address ? address.port : 0;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
});

function origin(): string {
  return `http://127.0.0.1:${port}`;
}

function allowedTransport() {
  return createFindogAgentHttpTransport({ allowedPrivateOrigins: [origin()] });
}

describe("findog agent network policy", () => {
  it("allows the explicitly configured private origin", async () => {
    const response = await allowedTransport().send({ url: `${origin()}/ok`, method: "GET" });
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true, path: "/ok" });
  });

  it("denies private, local and metadata destinations by default", async () => {
    const transport = createFindogAgentHttpTransport();
    requestLog = [];
    await expect(transport.send({ url: `${origin()}/ok`, method: "GET" }))
      .rejects.toMatchObject({ code: "blocked_destination" });
    await expect(transport.send({ url: "https://169.254.169.254/latest/meta-data/", method: "GET" }))
      .rejects.toMatchObject({ code: "blocked_destination" });
    expect(requestLog).toEqual([]);
  });

  it("denies a public host that resolves to a private address (rebinding guard)", async () => {
    const transport = createFindogAgentHttpTransport({
      resolveHost: async () => [{ address: "10.4.5.6", family: 4 }],
    });
    await expect(transport.send({ url: "https://rebind.example.com/data", method: "GET" }))
      .rejects.toMatchObject({ code: "blocked_destination" });
  });

  it("refuses plain http, credential-bearing urls and other schemes", async () => {
    const transport = createFindogAgentHttpTransport();
    await expect(transport.send({ url: "http://example.com/", method: "GET" }))
      .rejects.toMatchObject({ code: "insecure_transport" });
    await expect(transport.send({ url: "https://user:secret@example.com/", method: "GET" }))
      .rejects.toMatchObject({ code: "url_credentials" });
    await expect(transport.send({ url: "ftp://example.com/file", method: "GET" }))
      .rejects.toMatchObject({ code: "invalid_url" });
  });

  it("follows same-origin redirects and refuses cross-origin redirects", async () => {
    const transport = allowedTransport();
    const followed = await transport.send({ url: `${origin()}/redirect-same`, method: "GET" });
    expect(followed.status).toBe(200);
    expect(JSON.parse(followed.body).path).toBe("/ok");

    await expect(transport.send({ url: `${origin()}/redirect-cross`, method: "GET" }))
      .rejects.toMatchObject({ code: "redirect_denied" });
  });

  it("bounds response bodies, timeouts and aborts", async () => {
    const transport = allowedTransport();
    const big = await transport.send({
      url: `${origin()}/big`,
      method: "GET",
      maxResponseBytes: 100,
    });
    expect(big.truncated).toBe(true);
    expect(big.body).toHaveLength(100);

    await expect(transport.send({ url: `${origin()}/slow`, method: "GET", timeoutMs: 20 }))
      .rejects.toMatchObject({ code: "timeout" });

    const controller = new AbortController();
    controller.abort();
    await expect(transport.send({
      url: `${origin()}/ok`,
      method: "GET",
      signal: controller.signal,
    })).rejects.toMatchObject({ code: "aborted" });
  });

  it("parses server-side allowlists and validates hosts and addresses", () => {
    expect(parseFindogAgentAllowedPrivateOrigins(
      " http://127.0.0.1:3000 , https://internal.example.com/path ",
    )).toEqual(["http://127.0.0.1:3000", "https://internal.example.com"]);
    expect(parseFindogAgentAllowedPrivateOrigins(undefined)).toEqual([]);

    expect(isFindogAgentBlockedAddress("169.254.169.254")).toBe(true);
    expect(isFindogAgentBlockedAddress("127.0.0.1")).toBe(true);
    expect(isFindogAgentBlockedAddress("::ffff:10.0.0.1")).toBe(true);
    expect(isFindogAgentBlockedAddress("fd00::1")).toBe(true);
    expect(isFindogAgentBlockedAddress("8.8.8.8")).toBe(false);
    expect(isFindogAgentBlockedAddress("2606:4700::1111")).toBe(false);

    expect(hostMatchesAllowedDomain("example.com", ["example.com"])).toBe(true);
    expect(hostMatchesAllowedDomain("docs.example.com", ["example.com"])).toBe(true);
    expect(hostMatchesAllowedDomain("evil-example.com", ["example.com"])).toBe(false);
    expect(hostMatchesAllowedDomain("example.com.attacker.net", ["example.com"])).toBe(false);

    expect(() => assertFindogAgentPublicUrl("https://localhost/x"))
      .toThrowError(FindogAgentNetworkError);
  });
});
