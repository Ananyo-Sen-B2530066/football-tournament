// Tiny Chrome DevTools Protocol driver: open a page at a given width, run JS,
// report overflowing elements, and screenshot. Dev-only helper.
//
//   node scripts/inspect.mjs <url> [width] [height] [screenshotPath] [jsFile] [profileDir] [initJsFile]
//
// Pass profileDir to reuse a Chrome profile across runs, so localStorage
// (e.g. the unsaved score drafts) survives a page reload. initJsFile runs
// BEFORE the page's own scripts, which is how you seed sessionStorage to
// emulate a reload where a code was already entered.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const URL_ = process.argv[2] || "http://localhost:8000/editor";
const W = Number(process.argv[3] || 430);
const H = Number(process.argv[4] || 900);
const SHOT = process.argv[5] || "";
const JSFILE = process.argv[6] || "";
const PROFILE = process.argv[7] || "";
const INITJS = process.argv[8] || "";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9222 + Math.floor(Math.random() * 500);
const profile = PROFILE ? (mkdirSync(PROFILE, { recursive: true }), PROFILE) : mkdtempSync(join(tmpdir(), "cdp-"));

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  `--window-size=${W},${H}`, "about:blank",
], { stdio: "ignore" });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const j = await r.json();
      const page = j.find((t) => t.type === "page");
      if (page) return page;
    } catch {}
    await sleep(250);
  }
  throw new Error("chrome did not start");
}

(async () => {
  const page = await targets();
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((r) => (ws.onopen = r));
  // Console output is where React reports hydration failures (a console.error,
  // not a thrown exception), so it has to be collected rather than discarded.
  const consoleErrors = [];
  const exceptions = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
    if (m.method === "Runtime.consoleAPICalled") {
      const type = m.params?.type;
      if (type === "error" || type === "warning") {
        const text = (m.params.args || []).map((a) => a.value ?? a.description ?? a.className ?? "").join(" ");
        consoleErrors.push({ type, text });
      }
    }
    if (m.method === "Runtime.exceptionThrown") {
      const d = m.params?.exceptionDetails;
      // Pushed as an OBJECT with a .text field, like the console entries above.
      // React reports hydration failures through exceptionThrown, not console.error,
      // so a bare-string push here made the whole filter silently miss them.
      const desc = d?.exception?.description ?? d?.exception?.value ?? d?.text ?? "unknown exception";
      exceptions.push({ type: "exception", text: String(desc) });
    }
  };
  const send = (method, params = {}) =>
    new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Log.enable");
  if (INITJS) {
    const src = readFileSync(INITJS, "utf8");
    await send("Page.addScriptToEvaluateOnNewDocument", { source: src });
  }
  await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: W < 600 });
  await send("Page.navigate", { url: URL_ });
  await sleep(2500);

  if (JSFILE && existsSync(JSFILE)) {
    const js = readFileSync(JSFILE, "utf8");
    const r = await send("Runtime.evaluate", { expression: js, returnByValue: true, awaitPromise: true });
    console.log(typeof r.result?.result?.value === "string"
      ? r.result.result.value
      : JSON.stringify(r.result?.result?.value ?? r.result, null, 2));
  }

  // Report anything the page complained about. This is the signal that a
  // hydration mismatch is (or is not) happening.
  // A page that never loaded reports zero console errors, which reads as a pass.
  // Refuse to report a hydration verdict for a page that is not actually here.
  const loaded = await send("Runtime.evaluate", {
    expression: "location.protocol + '//' + location.host + location.pathname",
    returnByValue: true,
  });
  const here = loaded?.result?.result?.value ?? "";
  if (!here.startsWith("http")) {
    console.log(`PAGE DID NOT LOAD: ${here || "(unknown)"} — hydration verdict is meaningless`);
    console.log(`  (the server must be running before this tool can judge anything)`);
    if (SHOT) { try { ws.close(); chrome.kill(); } catch {} }
    process.exit(2);
  }

  const hydration = [...consoleErrors, ...exceptions].filter((c) =>
    /hydrat|did not match|server rendered|tree will be regenerated|Text content does not match/i.test(c.text)
  );
  const other = [...consoleErrors, ...exceptions].filter((c) => !hydration.includes(c));
  if (hydration.length) {
    console.log(`HYDRATION ERRORS: ${hydration.length}`);
    for (const h of hydration) console.log(`  ! ${String(h.text).slice(0, 600)}`);
  } else {
    console.log(`HYDRATION ERRORS: 0  (on ${here})`);
  }
  if (other.length && process.env.SHOW_ALL_CONSOLE) {
    console.log(`other console output: ${other.length}`);
    for (const o of other.slice(0, 12)) console.log(`  - [${o.type ?? "exception"}] ${String(o.text).slice(0, 300)}`);
  }

  if (SHOT) {
    const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
    const data = r?.result?.data;
    if (!data) { console.error("screenshot failed:", JSON.stringify(r).slice(0, 300)); }
    else {
      writeFileSync(SHOT, Buffer.from(data, "base64"));
      console.log(`screenshot -> ${SHOT}`);
    }
  }
  ws.close();
  chrome.kill();
  process.exit(0);
})().catch((e) => { console.error(e); chrome.kill(); process.exit(1); });
