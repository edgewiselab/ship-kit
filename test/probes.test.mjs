// Live URL checks, against a fake fetch so the tests never touch the network.
import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";
import { runProbes } from "../lib/probes.mjs";
import { VERSION } from "../lib/version.mjs";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

// routes: { "https://x.test/path": { status, body, headers, url (final URL after redirects), error } }
function fakeSite(routes, seen = []) {
  globalThis.fetch = async (url, opts) => {
    seen.push({ url, ua: opts && opts.headers && opts.headers["user-agent"] });
    const r = routes[url] || routes["*"] || { status: 404, body: "" };
    if (r.error) { const e = new Error(r.error); if (r.error === "timeout") e.name = "AbortError"; throw e; }
    const headers = new Headers({ "content-type": "text/html", ...(r.headers || {}) });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, url: r.url || url, headers, text: async () => r.body || "" };
  };
}

const HOME = `<html><head><meta property="og:image" content="/og.png"></head></html>`;
const SPA = `<!doctype html><html><div id="root"></div></html>`;

describe("runProbes", () => {
  test("https site with headers, og, robots, sitemap and a real 404", async () => {
    const seen = [];
    fakeSite({
      "https://app.test": { status: 200, body: HOME, headers: { "strict-transport-security": "max-age=1", "content-security-policy": "default-src 'self'" } },
      "https://app.test/robots.txt": { status: 200, body: "User-agent: *\nAllow: /", headers: { "content-type": "text/plain" } },
      "https://app.test/sitemap.xml": { status: 200, body: "<urlset></urlset>", headers: { "content-type": "application/xml" } },
      "*": { status: 404, body: "not found" },
    }, seen);
    const p = await runProbes("app.test");
    assert.equal(p.base, "https://app.test");
    assert.equal(p.https, true);
    assert.equal(p.og, true);
    assert.equal(p.robots, true);
    assert.equal(p.robotsBlocksAll, false);
    assert.equal(p.sitemap, true);
    assert.equal(p.notFound, true);
    assert.ok(p.headers["strict-transport-security"]);
    assert.ok(p.envPaths.every((e) => !e.exposed));
    assert.equal(seen[0].ua, `ship-kit-scan/${VERSION}`);
  });

  test("an http URL that redirects to https counts as https", async () => {
    fakeSite({ "http://app.test": { status: 200, body: HOME, url: "https://app.test/" }, "*": { status: 404 } });
    const p = await runProbes("http://app.test");
    assert.equal(p.https, true);
  });

  test("plain http with no redirect is NOT https (the old false pass)", async () => {
    fakeSite({ "http://app.test": { status: 200, body: HOME }, "https://app.test": { status: 200, body: HOME }, "*": { status: 404 } });
    const p = await runProbes("http://app.test");
    assert.equal(p.https, false);
    assert.equal(p.httpsAvailable, true);
    assert.equal(p.reachable, true);
  });

  test("plain http where https does not exist at all", async () => {
    fakeSite({ "http://app.test": { status: 200, body: HOME }, "https://app.test": { error: "ECONNREFUSED" }, "*": { status: 404 } });
    const p = await runProbes("http://app.test");
    assert.equal(p.https, false);
    assert.equal(p.httpsAvailable, false);
  });

  test("a TLS or connection failure stops early", async () => {
    fakeSite({ "https://app.test": { error: "certificate has expired" } });
    const p = await runProbes("https://app.test");
    assert.equal(p.https, false);
    assert.equal(p.reachable, false);
    assert.equal(p.envPaths, undefined);
  });

  test("an exposed .env is detected", async () => {
    fakeSite({
      "https://app.test": { status: 200, body: HOME },
      "https://app.test/.env": { status: 200, body: "DATABASE_URL=postgres://x\nSTRIPE_SECRET=sk", headers: { "content-type": "text/plain" } },
      "*": { status: 404 },
    });
    const p = await runProbes("https://app.test");
    assert.deepEqual(p.envPaths.filter((e) => e.exposed).map((e) => e.path), ["/.env"]);
  });

  test("an exposed .git/config is detected", async () => {
    fakeSite({
      "https://app.test": { status: 200, body: HOME },
      "https://app.test/.git/config": { status: 200, body: "[core]\n\trepositoryformatversion = 0\n[remote \"origin\"]", headers: { "content-type": "text/plain" } },
      "*": { status: 404 },
    });
    const p = await runProbes("https://app.test");
    assert.ok(p.envPaths.find((e) => e.path === "/.git/config").exposed);
  });

  test("an SPA that answers every path with index.html is not an exposed .env", async () => {
    fakeSite({ "*": { status: 200, body: SPA } });
    const p = await runProbes("https://app.test");
    assert.ok(p.envPaths.every((e) => !e.exposed));
    assert.equal(p.robots, false); // an HTML page at /robots.txt is not a robots file
    assert.equal(p.notFound, false); // soft 404
  });

  test("robots.txt blocking the whole site is flagged", async () => {
    fakeSite({
      "https://app.test": { status: 200, body: HOME },
      "https://app.test/robots.txt": { status: 200, body: "User-agent: *\nDisallow: /\n", headers: { "content-type": "text/plain" } },
      "*": { status: 404 },
    });
    assert.equal((await runProbes("https://app.test")).robotsBlocksAll, true);
  });

  test("trailing slashes are normalised and an empty URL returns null", async () => {
    fakeSite({ "*": { status: 404 } });
    assert.equal((await runProbes("https://app.test///")).base, "https://app.test");
    assert.equal(await runProbes(""), null);
  });
});
