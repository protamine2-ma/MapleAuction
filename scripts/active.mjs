// 메이플 경매장 시세 · 월드별 활동 계정 수집 (서비스 단계 키)
// 1) 이번 주·지난주 유니온 랭킹을 비교해 유니온 레벨/전투력이 바뀐 계정 → 활동 (추가 호출 없음)
// 2) 최근 8주 안에 활동했던 계정 중 랭킹 변화가 없는 계정만 본캐 접속/레벨/경험치, 아티팩트를 조회
// 3) 8주 넘게 활동이 없던 휴면 계정은 랭킹이 바뀌지 않으면 조회하지 않음

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const SB = process.env.SUPABASE_URL || 'https://qjldhyiwffeqhzmnppta.supabase.co';
const NX = process.env.NEXON_API_KEY;
const SK = process.env.SUPABASE_SERVICE_KEY;
const RPS = Number(process.env.RPS || 480);
const CONC = Number(process.env.CONCURRENCY || 120);
const KEEP_DAYS = Number(process.env.KEEP_DAYS || 56);
const FORCE = process.env.FORCE === '1';
const WORLDS = ['스카니아', '베라', '루나', '제니스', '크로아', '유니온', '엘리시움', '이노시스', '레드', '오로라', '아케인', '노바', '에오스', '핼리오스'];

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

const addDays = (d, n) => { const x = new Date(d + 'T00:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
function lastThursday() {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - 1));
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
const D = process.env.DATE || lastThursday();
const P = addDays(D, -7);
const CUTOFF = addDays(D, -KEEP_DAYS);
console.log(`대상 ${D} · 비교 ${P}`);
const t0 = Date.now();
const mins = () => Math.round((Date.now() - t0) / 60000);

const have = await sb(`population?select=world,active&date=eq.${D}`);
if (!FORCE && have.length >= WORLDS.length && have.every(x => x.active != null)) { console.log('이미 수집된 주예요. 종료합니다.'); process.exit(0); }

async function crawl(world, date) {
  const map = new Map(); let p = 1, size = 0, done = false;
  while (!done) {
    const pages = Array.from({ length: 20 }, (_, k) => p + k);
    const res = await pool(pages, pg => api('/ranking/union', { date, world_name: world, page: pg }), 20);
    for (const j of res) {
      const r = (j && j.ranking) || [];
      if (!size) size = r.length;
      if (!r.length) { done = true; break; }
      r.forEach(x => { if (!map.has(x.character_name)) map.set(x.character_name, [x.union_level, x.union_power]); });
      if (r.length < size) { done = true; break; }
    }
    p += 20;
  }
  return map;
}

const jobs = WORLDS.flatMap(w => [[w, D], [w, P]]);
const maps = await pool(jobs, ([w, d]) => crawl(w, d), jobs.length);
const cur = {}, prv = {};
jobs.forEach(([w, d], i) => { (d === D ? cur : prv)[w] = maps[i]; });
WORLDS.forEach(w => console.log(`${w} 랭킹 ${cur[w].size.toLocaleString()} (지난주 ${prv[w].size.toLocaleString()})`));
if (!WORLDS.some(w => cur[w].size)) { console.log('랭킹 데이터가 아직 준비되지 않았어요. 내일 다시 시도해요.'); process.exit(0); }
console.log(`랭킹 수집 완료 · 호출 ${calls.toLocaleString()} · ${mins()}분`);

const tracked = new Map();
for (let from = 0; ; from += 16000) {
  const parts = await pool(Array.from({ length: 16 }, (_, k) => from + k * 1000), f => sb('tracked?select=*&order=world.asc,name.asc', { headers: { Range: `${f}-${f + 999}`, 'Range-Unit': 'items' } }), 16);
  parts.forEach(b => b.forEach(r => tracked.set(r.world + '|' + r.name, r)));
  if (parts.some(b => b.length < 1000)) break;
}
console.log(`추적 중인 계정 ${tracked.size.toLocaleString()}개`);

const diff = (a, b, keys) => keys.some(k => a[k] != null && b[k] != null && String(a[k]) !== String(b[k]));
const stats = Object.fromEntries(WORLDS.map(w => [w, { count: cur[w].size, active: 0 }]));
const out = [];
const entries = [];
WORLDS.forEach(w => cur[w].forEach((v, name) => entries.push([w, name, v])));
let checked = 0;

await pool(entries, async ([world, name, [ul, up]]) => {
  const key = world + '|' + name;
  const row = tracked.get(key);
  const pr = prv[world].get(name);
  let active = pr ? (pr[0] !== ul || pr[1] !== up) : prv[world].size > 0;
  if (active) { stats[world].active++; out.push({ ...(row || { world, name }), last_active: D }); return; }
  if (!row || !row.last_active || row.last_active < CUTOFF) return;
  checked++;
  let ocid = row.ocid;
  if (!ocid) { const j = await api('/id', { character_name: name }); ocid = j && j.ocid; }
  if (!ocid) return;
  const snap = { ...row, ocid };
  const b = await api('/character/basic', { ocid, date: D });
  if (b) { snap.clevel = b.character_level ?? null; snap.cexp = b.character_exp ?? null; }
  active = (b && String(b.access_flag) === 'true') || diff(snap, row, ['clevel', 'cexp']);
  if (!active) {
    const u = await api('/user/union', { ocid, date: D });
    if (u) { snap.alevel = u.union_artifact_level ?? null; snap.aexp = u.union_artifact_exp ?? null; snap.apoint = u.union_artifact_point ?? null; }
    active = diff(snap, row, ['alevel', 'aexp', 'apoint']);
  }
  if (active) { stats[world].active++; snap.last_active = D; }
  out.push(snap);
  if (checked % 20000 === 0) console.log(`접속 확인 ${checked.toLocaleString()}개 · 호출 ${calls.toLocaleString()} · ${mins()}분`);
});
console.log(`판정 완료 · 접속 확인 ${checked.toLocaleString()}개 · 호출 ${calls.toLocaleString()} · ${mins()}분`);

const COLS = ['world', 'name', 'ocid', 'last_active', 'alevel', 'aexp', 'apoint', 'clevel', 'cexp'];
const rows = out.map(r => Object.fromEntries(COLS.map(c => [c, r[c] ?? null])));
const batches = [];
for (let i = 0; i < rows.length; i += 1000) batches.push(rows.slice(i, i + 1000));
await pool(batches, b => sb('tracked', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(b) }), 8);
await sb(`tracked?last_active=lt.${CUTOFF}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });

const pop = WORLDS.map(w => ({ date: D, world: w, count: stats[w].count, active: stats[w].active }));
await sb('population', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(pop) });
pop.forEach(p => console.log(`${p.world} 활동 ${p.active.toLocaleString()}`));
console.log(`전체 활동 ${pop.reduce((a, p) => a + p.active, 0).toLocaleString()} · API 호출 ${calls.toLocaleString()}건 · ${mins()}분`);
