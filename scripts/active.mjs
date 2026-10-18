// 메이플 경매장 시세 · 월드별 활동 계정 수집 (서비스 단계 키 필요)
// 유니온 랭킹 전체 계정의 대표 캐릭터를 조회해 지난 기록과 비교합니다.
// 활동 기준: 최근 7일 접속 OR 유니온 레벨·전투력 / 아티팩트 레벨·경험치·포인트 / 본캐 레벨·경험치·전투력 중 하나라도 변화

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const SB = process.env.SUPABASE_URL || 'https://qjldhyiwffeqhzmnppta.supabase.co';
const NX = process.env.NEXON_API_KEY;
const SK = process.env.SUPABASE_SERVICE_KEY;
const RPS = Number(process.env.RPS || 480);
const CONC = Number(process.env.CONCURRENCY || 120);
const FORCE = process.env.FORCE === '1';
const WORLDS = ['스카니아', '베라', '루나', '제니스', '크로아', '유니온', '엘리시움', '이노시스', '레드', '오로라', '아케인', '노바', '에오스', '핼리오스'];
const KEYS = ['ulevel', 'upower', 'alevel', 'aexp', 'apoint', 'clevel', 'cexp', 'cpower'];

if (!NX || !SK) { console.error('NEXON_API_KEY / SUPABASE_SERVICE_KEY 가 필요해요'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let next = 0, calls = 0;
async function slot() { const now = Date.now(); const t = Math.max(now, next); next = t + 1000 / RPS; if (t > now) await sleep(t - now); }

async function api(path, params) {
  const qs = new URLSearchParams(params).toString();
  for (let t = 0; t < 6; t++) {
    await slot(); calls++;
    let r;
    try { r = await fetch(`${BASE}${path}?${qs}`, { headers: { 'x-nxopen-api-key': NX } }); }
    catch (e) { await sleep(1000 * (t + 1)); continue; }
    if (r.ok) return r.json();
    const body = await r.text();
    if (r.status === 429 || r.status >= 500) { await sleep(1000 * (t + 1)); continue; }
    if (r.status === 401 || r.status === 403) throw new Error(`API 키 오류 ${r.status}: ${body}`);
    return null;
  }
  return null;
}

async function pool(items, fn, n = CONC) {
  let i = 0; const out = new Array(items.length);
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k], k); }
  }));
  return out;
}

async function sb(path, opt = {}) {
  for (let t = 0; t < 4; t++) {
    const r = await fetch(`${SB}/rest/v1/${path}`, { ...opt, headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
    if (r.status === 416) return [];
    const text = await r.text();
    if (r.ok) return text ? JSON.parse(text) : null;
    if (r.status >= 500) { await sleep(2000 * (t + 1)); continue; }
    throw new Error(`Supabase ${r.status}: ${text}`);
  }
  throw new Error('Supabase 재시도 초과');
}

function lastThursday() {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - 1));
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const D = process.env.DATE || lastThursday();
console.log(`대상 날짜: ${D}`);

const have = await sb(`population?select=world,active&date=eq.${D}`);
if (!FORCE && have.length >= WORLDS.length && have.every(x => x.active != null)) { console.log('이미 수집된 주예요. 종료합니다.'); process.exit(0); }

async function crawlWorld(world) {
  const out = []; let p = 1, size = 0, done = false;
  while (!done) {
    const pages = Array.from({ length: 20 }, (_, k) => p + k);
    const res = await pool(pages, pg => api('/ranking/union', { date: D, world_name: world, page: pg }), 20);
    for (const j of res) {
      const r = (j && j.ranking) || [];
      if (!size) size = r.length;
      if (!r.length) { done = true; break; }
      r.forEach(x => out.push({ world, name: x.character_name, ulevel: x.union_level, upower: x.union_power }));
      if (r.length < size) { done = true; break; }
    }
    p += 20;
  }
  console.log(`${world} 랭킹 ${out.length.toLocaleString()}개`);
  return out;
}

const seen = new Set();
const entries = (await pool(WORLDS, crawlWorld, WORLDS.length)).flat().filter(e => { const k = e.world + '|' + e.name; if (seen.has(k)) return false; seen.add(k); return true; });
if (!entries.length) { console.log('랭킹 데이터가 아직 준비되지 않았어요. 내일 다시 시도해요.'); process.exit(0); }

const prevRows = [];
for (let from = 0; ; from += 16000) {
  const parts = await pool(Array.from({ length: 16 }, (_, k) => from + k * 1000), f => sb('accounts?select=*&order=ocid.asc', { headers: { Range: `${f}-${f + 999}`, 'Range-Unit': 'items' } }), 16);
  parts.forEach(b => prevRows.push(...b));
  if (parts.some(b => b.length < 1000)) break;
}
console.log(`지난 기록 ${prevRows.length.toLocaleString()}개`);
const byName = new Map(prevRows.map(r => [r.world + '|' + r.name, r]));
const byOcid = new Map(prevRows.map(r => [r.ocid, r]));

const stats = Object.fromEntries(WORLDS.map(w => [w, { count: 0, active: 0 }]));
const snaps = [];
let n = 0;
const t0 = Date.now();
await pool(entries, async e => {
  stats[e.world].count++;
  let ocid = byName.get(e.world + '|' + e.name)?.ocid;
  if (!ocid) { const j = await api('/id', { character_name: e.name }); ocid = j && j.ocid; }
  if (!ocid) return;
  const prev = byOcid.get(ocid);
  const cmp = prev && prev.date < D ? prev : null;
  const snap = { ...(prev || {}), ocid, world: e.world, name: e.name, date: D, ulevel: e.ulevel ?? null, upower: e.upower ?? null };
  const diff = keys => !!cmp && keys.some(k => snap[k] != null && cmp[k] != null && String(snap[k]) !== String(cmp[k]));
  // 가장 싼 판정부터: 활동이 확인되면 나머지 호출은 건너뛰어요
  let active = diff(['ulevel', 'upower']);
  if (!active) {
    const b = await api('/character/basic', { ocid, date: D });
    if (b) { snap.clevel = b.character_level ?? null; snap.cexp = b.character_exp ?? null; }
    active = (b && String(b.access_flag) === 'true') || diff(['clevel', 'cexp']);
  }
  if (!active && cmp) {
    const u = await api('/user/union', { ocid, date: D });
    if (u) { snap.alevel = u.union_artifact_level ?? null; snap.aexp = u.union_artifact_exp ?? null; snap.apoint = u.union_artifact_point ?? null; }
    active = diff(['alevel', 'aexp', 'apoint']);
  }
  if (active) stats[e.world].active++;
  KEYS.forEach(k => { if (snap[k] === undefined) snap[k] = null; });
  snaps.push(snap);
  if (++n % 20000 === 0) console.log(`${n.toLocaleString()} / ${entries.length.toLocaleString()} · 호출 ${calls.toLocaleString()} · ${Math.round((Date.now() - t0) / 60000)}분`);
});

const batches = [];
for (let i = 0; i < snaps.length; i += 1000) batches.push(snaps.slice(i, i + 1000));
await pool(batches, b => sb('accounts', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(b) }), 8);

const pop = WORLDS.map(w => ({ date: D, world: w, count: stats[w].count, active: stats[w].active }));
await sb('population', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(pop) });
pop.forEach(p => console.log(`${p.world} 전체 ${p.count.toLocaleString()} · 활동 ${p.active.toLocaleString()} (${p.count ? (p.active / p.count * 100).toFixed(1) : 0}%)`));
console.log(`완료 · API 호출 ${calls.toLocaleString()}건 · ${Math.round((Date.now() - t0) / 60000)}분`);
