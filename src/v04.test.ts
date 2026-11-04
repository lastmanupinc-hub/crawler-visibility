import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
// @ts-ignore plain JS helpers shared by the CLIs
import { get, isPrivateAddress, assertPublicUrl, setAllowPrivate, setDelay, safe } from "../bin/http.mjs";
// @ts-ignore
import { md, auditMarkdown, gradeMarkdown } from "../bin/report.mjs";

describe("SSRF guard", () => {
  it("classifies private, loopback, link-local, metadata, CGNAT, ULA, mapped", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "::", "fd00::1", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"])
      expect(isPrivateAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700::1111", "198.18.0.1"]) expect(isPrivateAddress(ip), ip).toBe(false);
  });
  it("refuses private hosts, odd schemes and credentials; --allow-private opens it", async () => {
    setAllowPrivate(false);
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("http://localhost/")).rejects.toThrow(/private/);
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toThrow(/http/);
    await expect(assertPublicUrl("https://u:p@example.com/")).rejects.toThrow(/credentials/);
    setAllowPrivate(true); await expect(assertPublicUrl("http://127.0.0.1/")).resolves.toBeTruthy(); setAllowPrivate(false);
  });
});

describe("redirect re-check, size cap, timeout", () => {
  let srv: Server; let base = "";
  beforeAll(async () => {
    srv = createServer((q, r) => {
      if (q.url === "/big") { r.writeHead(200, { "content-type": "text/html" }); r.end("x".repeat(5000)); return; }
      if (q.url === "/biglen") { r.writeHead(200, { "content-length": "999999999" }); r.end(); return; }
      if (q.url === "/slow") return; // never answers
      if (q.url === "/to-meta") { r.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }); return r.end(); }
      r.end("ok");
    });
    await new Promise<void>((res) => srv.listen(0, "127.0.0.1", () => res()));
    base = `http://127.0.0.1:${(srv.address() as any).port}`; setDelay(0);
  });
  afterAll(() => { srv.closeAllConnections?.(); srv.close(); setAllowPrivate(false); setDelay(1000); });
  it("caps body size (streamed and declared)", async () => {
    setAllowPrivate(true);
    await expect(get(`${base}/big`, { maxBytes: 1024 })).rejects.toThrow(/limit/);
    await expect(get(`${base}/biglen`, { maxBytes: 1024 })).rejects.toThrow(/limit/);
    expect((await get(`${base}/big`, { maxBytes: 10000 })).text).toHaveLength(5000);
  });
  it("times out", async () => { setAllowPrivate(true); await expect(get(`${base}/slow`, { timeout: 300 })).rejects.toThrow(); });
  it("re-checks every redirect hop", async () => {
    // Allow the local server itself, but the guard must still be applied to the redirect target when private is off.
    setAllowPrivate(false);
    await expect(get(`${base}/to-meta`)).rejects.toThrow(/private/);
  });
});

describe("markdown report + terminal safety", () => {
  it("escapes markdown and strips control chars", () => {
    expect(md("a|b<script>`x`\n[l](j)")).toBe("a\\|b\\<script\\>\\`x\\` \\[l\\]\\(j\\)");
    expect(safe("ok\u001b[31mred\u0007")).toBe("ok[31mred");
  });
  it("renders audit and grade tables", () => {
    const a = auditMarkdown([{ url: "https://a.test/|x", ok: false, bodyTextLength: 0, headingCount: 0, jsonLdBlocks: 0, problems: ["No <title>."] }]);
    expect(a).toContain("0/1 pages"); expect(a).toContain("a.test/\\|x"); expect(a).toContain("No \\<title\\>.");
    const g = gradeMarkdown([{ url: "https://a.test/", grade: "B", score: 7, checks: [{ id: "text", label: "text", pass: false, detail: "317" }], notes: [] }]);
    expect(g).toContain("| **B** | 7/10 |"); expect(g).toContain("text \\(317\\)");
  });
});
