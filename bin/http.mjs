// Shared polite HTTP for cv-* CLIs: GET only, manual redirect following (reported), per-host spacing,
// SSRF guard (private / loopback / link-local / metadata addresses refused unless allowPrivate), size cap, deadline.
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export const UA = "cv-audit/0.4 (crawler-visibility; raw HTML, no JS)";
const lastHit = new Map();
let delayMs = 1000;
let allowPrivate = false;
export const MAX_BYTES_DEFAULT = 5 * 1024 * 1024;
export const setDelay = (ms) => { delayMs = ms; };
export const setAllowPrivate = (v) => { allowPrivate = !!v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Wait so requests to the same host are at least delayMs apart. */
export async function pace(host) {
  const wait = (lastHit.get(host) ?? 0) + delayMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/** True for addresses a public-site audit has no business fetching. 198.18.0.0/15 is deliberately allowed:
 *  fake-IP DNS proxies (common on corporate and sandboxed networks) hand out addresses from it for public hosts. */
export function isPrivateAddress(ip) {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 192 && b === 0) || a >= 224;
  }
  if (v === 6) {
    const s = ip.toLowerCase().replace(/^\[|\]$/g, "");
    if (s === "::" || s === "::1") return true;
    const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/); if (m) return isPrivateAddress(m[1]);
    return /^(fc|fd|fe[89ab]|ff)/.test(s) || s.startsWith("64:ff9b:") || s.startsWith("2001:db8");
  }
  return true; // not an IP: caller must resolve first
}

/** Refuse non-http(s) schemes, credentials in URLs, and hosts resolving to private addresses. */
export async function assertPublicUrl(raw) {
  let u; try { u = new URL(raw); } catch { throw new Error(`not a URL: ${raw}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Error(`only http(s) URLs are fetched (got ${u.protocol})`);
  if (u.username || u.password) throw new Error("URLs with embedded credentials are refused");
  if (allowPrivate) return u;
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch((e) => { throw new Error(`DNS lookup failed for ${host}: ${e.code ?? e.message}`); })).map((a) => a.address);
  const bad = addrs.find(isPrivateAddress);
  if (bad) throw new Error(`${host} resolves to a private or reserved address (${bad}); pass --allow-private to audit local or internal servers`);
  return u;
}

async function readCapped(res, maxBytes) {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > maxBytes) { await res.body?.cancel(); throw new Error(`response is ${len} bytes, over the ${maxBytes}-byte limit (--max-bytes)`); }
  if (!res.body) return "";
  const reader = res.body.getReader(); const chunks = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    n += value.byteLength;
    if (n > maxBytes) { await reader.cancel(); throw new Error(`response exceeded the ${maxBytes}-byte limit (--max-bytes)`); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** GET with up to 5 redirects followed by hand (each hop re-checked), so the chain is visible. */
export async function get(url, { timeout = 20000, max = 5, maxBytes = MAX_BYTES_DEFAULT } = {}) {
  const chain = [];
  let cur = url; const t0 = performance.now(); const deadline = Date.now() + timeout * 2;
  for (let i = 0; i <= max; i++) {
    await assertPublicUrl(cur);
    await pace(new URL(cur).host);
    const left = Math.min(timeout, deadline - Date.now());
    if (left <= 0) throw new Error(`gave up on ${url}: redirects took longer than ${timeout * 2} ms`);
    const res = await fetch(cur, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,text/plain,application/xml;q=0.9,*/*;q=0.5" }, redirect: "manual", signal: AbortSignal.timeout(left) });
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      await res.body?.cancel();
      const next = new URL(res.headers.get("location"), cur).toString();
      chain.push({ from: cur, status: res.status, to: next });
      if (chain.some((c, j) => j < chain.length - 1 && c.from === next)) throw new Error(`redirect loop at ${next}`);
      cur = next; continue;
    }
    const text = await readCapped(res, maxBytes);
    return { status: res.status, url: cur, chain, text, timeMs: performance.now() - t0, headers: res.headers };
  }
  throw new Error(`more than ${max} redirects from ${url}`);
}

/** GET that returns body text only on 200, else null (used for robots.txt / sitemap.xml). */
export async function getOptional(url, opts) {
  try { const r = await get(url, opts); return r.status === 200 ? r.text : null; } catch { return null; }
}

/** Strip terminal control characters from remote text before printing it. */
export const safe = (s) => String(s ?? "").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "");
