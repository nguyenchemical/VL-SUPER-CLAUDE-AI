// GitHub Actions / Node 20 — chạy cùng logic với worker.js nhưng ghi thẳng data/*.json (đã bỏ phần Worker)
// (gốc: Cloudflare Worker "super-claude" — lấy kết quả THẬT từ vietlott.vn, kiểm tra hợp lệ, ghi data/*.json vào repo.
// Secrets/Vars: GITHUB_TOKEN (fine-grained PAT, Contents: read/write). Tùy chọn: GITHUB_OWNER, GITHUB_REPO, GITHUB_BRANCH.
// Cron: "0 1,5,9,13,17,21 * * *"  |  Test: ?action=run-now  |  ?action=diagnose  |  ?action=status
// Lưu ý: tên WebPart bên dưới là tên AJAX của vietlott.vn; Worker KHÔNG ghi bất cứ gì chưa qua kiểm tra hợp lệ.
const G = {
  mega645:  { cls: "Game645CompareWebPart", dn: 6, max: 45 },
  power655: { cls: "Game655CompareWebPart", dn: 6, max: 55, bonus: 1 },
  lotto535: { cls: "Game535CompareWebPart", dn: 5, max: 35, bonus: 1 },
  max3d:    { cls: "GameMax3DCompareWebPart", d3: 1 },
  max3dpro: { cls: "GameMax3DProCompareWebPart", d3: 1 },
  keno:     { cls: "GameKenoCompareWebPart", dn: 20, max: 80 },
  bingo18:  { cls: "GameBingo18CompareWebPart", dn: 3, max: 6, rep: 1 },
};
const CORS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json; charset=utf-8" };
const out = (o, s = 200) => new Response(JSON.stringify(o, null, 1), { status: s, headers: CORS });

async function pull(k) {
  const g = G[k];
  const body = {
    ORenderInfo: { SiteId: "main.frontend.vi", SiteAlias: "main.vi", UserSessionId: "", SiteLang: "vi", IsPageDesign: false,
      ExtraParam1: "", ExtraParam2: "", ExtraParam3: "", SiteURL: "", WebPage: null, SiteName: "Vietlott",
      OrgPageAlias: null, PageAlias: null, RefKey: null, FullPageAlias: null },
    GameDrawId: "", ArrayNumbers: Array(5).fill(Array(g.dn || 6).fill("")), CheckMulti: false, PageIndex: 0,
  };
  const r = await fetch(`https://vietlott.vn/ajaxpro/Vietlott.PlugIn.WebParts.${g.cls},Vietlott.PlugIn.WebParts.ashx`, {
    method: "POST",
    headers: { "Content-Type": "text/plain; charset=UTF-8", "X-AjaxPro-Method": "ServerSideDrawResult",
      Origin: "https://vietlott.vn", Referer: "https://vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong/",
      "User-Agent": "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  if (!r.ok) throw new Error("vietlott.vn HTTP " + r.status + " " + t.slice(0, 150));
  let html;
  try { html = JSON.parse(t)?.value?.HtmlContent; } catch { /* không phải JSON */ }
  if (!html) throw new Error("vietlott.vn không trả HtmlContent: " + t.slice(0, 150));
  return html;
}

function parse(html) {
  const rows = [];
  for (const tr of html.split(/<tr/i).slice(1)) {
    const d = tr.match(/(\d{2})\/(\d{2})\/(\d{4})/), id = tr.match(/>\s*#?(\d{3,7})\s*</);
    const nums = [...tr.matchAll(/bong_tron[^>]*>\s*(\d{1,2})\s*</g)].map((m) => +m[1]);
    const jp = tr.match(/(\d{1,3}(?:\.\d{3}){2,})/);
    if (d && id && nums.length) rows.push({ id: id[1], date: `${d[3]}-${d[2]}-${d[1]}`, nums, jp: jp ? +jp[1].replace(/\./g, "") : null });
  }
  return rows;
}

function valid(r, g) {
  const a = r.nums;
  if (g.d3) return a.length >= 6 && a.length % 3 === 0 && a.every((x) => x >= 0 && x <= 9);
  if (a.length !== g.dn + (g.bonus || 0) || a.some((x) => x < 1 || x > g.max)) return false;
  return g.rep || new Set(a.slice(0, g.dn)).size === g.dn;
}

import fs from "node:fs";
import { chromium } from "playwright";
// vietlott.vn nằm sau Cloudflare "Just a moment..." nên HTTP thuần bị 403 → dùng trình duyệt thật (Chromium + xvfb), gọi AJAX cùng origin.
const ORI = { SiteId: "main.frontend.vi", SiteAlias: "main.vi", UserSessionId: "", SiteLang: "vi", IsPageDesign: false, ExtraParam1: "", ExtraParam2: "", ExtraParam3: "", SiteURL: "", WebPage: null, SiteName: "Vietlott", OrgPageAlias: null, PageAlias: null, RefKey: null, FullPageAlias: null };
const body = (g) => JSON.stringify({ ORenderInfo: ORI, GameDrawId: "", ArrayNumbers: Array(5).fill(Array(g.dn || 6).fill("")), CheckMulti: false, PageIndex: 0 });
const isCh = (t) => /Just a moment|Attention Required|Checking your browser/i.test(t);
fs.mkdirSync("data", { recursive: true });
const status = { updated: new Date().toISOString(), games: {} };
let browser, ctx, page, blocked = null;
try {
  browser = await chromium.launch({ headless: false, args: ["--disable-blink-features=AutomationControlled"] });
  ctx = await browser.newContext({ locale: "vi-VN", timezoneId: "Asia/Ho_Chi_Minh", viewport: { width: 1280, height: 900 } });
  page = await ctx.newPage();
  await page.goto("https://vietlott.vn/vi/trung-thuong/ket-qua-trung-thuong/645", { waitUntil: "domcontentloaded", timeout: 60000 });
  for (let i = 0; i < 30 && isCh(await page.title()); i++) await page.waitForTimeout(2000);
  const t = await page.title();
  if (isCh(t)) blocked = `Cloudflare challenge không vượt qua (title: ${t})`;
  await page.screenshot({ path: "data/debug.png" });
  fs.writeFileSync("data/debug.json", JSON.stringify({ title: t, url: page.url(), cookies: (await ctx.cookies()).map((c) => c.name), blocked }));
} catch (e) { blocked = "Không mở được vietlott.vn bằng trình duyệt: " + String(e.message || e).slice(0, 200); }

async function pullB(k) {
  const g = G[k];
  const r = await page.evaluate(async ([u, b]) => {
    const x = await fetch(u, { method: "POST", headers: { "Content-Type": "text/plain; charset=UTF-8", "X-AjaxPro-Method": "ServerSideDrawResult" }, body: b });
    return { s: x.status, t: await x.text() };
  }, [`/ajaxpro/Vietlott.PlugIn.WebParts.${g.cls},Vietlott.PlugIn.WebParts.ashx`, body(g)]);
  if (r.s !== 200) throw new Error("vietlott.vn HTTP " + r.s + " " + r.t.slice(0, 150));
  let html;
  try { html = JSON.parse(r.t)?.value?.HtmlContent; } catch { /* không phải JSON */ }
  if (!html) throw new Error("vietlott.vn không trả HtmlContent: " + r.t.slice(0, 150));
  return html;
}

for (const k of Object.keys(G)) {
  try {
    if (blocked) throw new Error(blocked);
    const fresh = parse(await pullB(k)).filter((r) => valid(r, G[k]));
    if (!fresh.length) throw new Error("Không có kỳ quay hợp lệ sau khi phân tích");
    const f = `data/${k}.json`;
    const prev = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")).draws || [] : [];
    const map = new Map(prev.map((d) => [d.id, d]));
    fresh.forEach((d) => map.set(d.id, d));
    const draws = [...map.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)).slice(0, 600);
    fs.writeFileSync(f, JSON.stringify({ game: k, draws }));
    status.games[k] = { ok: true, count: draws.length, latestId: draws[0].id, latestDate: draws[0].date };
    await page.waitForTimeout(1500);
  } catch (e) { status.games[k] = { ok: false, error: String(e.message || e) }; }
}
await browser?.close();
fs.writeFileSync("data/status.json", JSON.stringify(status));
console.log(JSON.stringify(status, null, 1));
