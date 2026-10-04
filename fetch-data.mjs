// Nạp dữ liệu kỳ quay THẬT từ bản sao công khai https://github.com/vietvudanh/vietlott-data (MIT) → data/*.json của app.
// Lưu ý: đây không phải trực tiếp vietlott.vn (trang này chặn bot bằng Cloudflare). Dữ liệu chỉ mới bằng bản sao đó.
import fs from "node:fs";
const SRC = "https://raw.githubusercontent.com/vietvudanh/vietlott-data/main/data/";
const flat = (r) => Object.values(r).flat().join("").split("").map(Number);
const G = {
  mega645:  { f: "power645", dn: 6, max: 45 },
  power655: { f: "power655", dn: 6, max: 55, bonus: 1 },
  lotto535: { f: "power535", dn: 5, max: 35, bonus: 1 },
  max3d:    { f: "3d", d3: 1, conv: flat },
  max3dpro: { f: "3d_pro", d3: 1, conv: flat },
};
function valid(r, g) {
  const a = r.nums;
  if (g.d3) return a.length >= 6 && a.length % 3 === 0 && a.every((x) => x >= 0 && x <= 9);
  if (a.length !== g.dn + (g.bonus || 0) || a.some((x) => !Number.isInteger(x) || x < 1 || x > g.max)) return false;
  return g.rep || new Set(a.slice(0, g.dn)).size === g.dn;
}
fs.mkdirSync("data", { recursive: true });
const status = { updated: new Date().toISOString(), source: "vietvudanh/vietlott-data", games: {} };
for (const k of Object.keys(G)) {
  const g = G[k];
  try {
    const r = await fetch(SRC + g.f + ".jsonl");
    if (!r.ok) throw new Error("HTTP " + r.status + " " + g.f + ".jsonl");
    const rows = (await r.text()).split("\n").filter(Boolean).slice(-700).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
    const draws = rows
      .map((x) => ({ id: String(x.id).replace(/\D/g, ""), date: x.date, nums: g.conv ? g.conv(x.result) : x.result, jp: null }))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.id && valid(d, g))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)).slice(0, 600);
    if (!draws.length) throw new Error("Không có kỳ hợp lệ");
    const file = `data/${k}.json`, prev = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")).draws || [] : [];
    const mp = new Map(prev.map((d) => [d.id, d])); draws.forEach((d) => mp.set(d.id, d));
    const merged = [...mp.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : b.id - a.id)).slice(0, 600);
    fs.writeFileSync(file, JSON.stringify({ game: k, draws: merged }));
    status.games[k] = { ok: true, count: merged.length, latestId: merged[0].id, latestDate: merged[0].date };
  } catch (e) { status.games[k] = { ok: false, error: String(e.message || e) }; }
}
fs.writeFileSync("data/status.json", JSON.stringify(status));
console.log(JSON.stringify(status, null, 1));
