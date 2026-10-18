// 메이플 경매장 시세 · 월드별 인구수 수집
// 넥슨 Open API 유니온 랭킹의 마지막 페이지를 찾아 월드별 계정 수를 셉니다.
// 매일 실행: 최신 목요일을 먼저 채우고, 남는 호출로 과거 목요일을 거슬러 채웁니다.

const API = 'https://open.api.nexon.com/maplestory/v1/ranking/union';
const SB = process.env.SUPABASE_URL || 'https://qjldhyiwffeqhzmnppta.supabase.co';
const NX = process.env.NEXON_API_KEY;
const SK = process.env.SUPABASE_SERVICE_KEY;
const BUDGET = Number(process.env.DAILY_BUDGET || 200000);
const SLEEP = Number(process.env.SLEEP_MS || 30);
const START = process.env.START_DATE || '2023-12-21';
const WORLDS = ['스카니아', '베라', '루나', '제니스', '크로아', '유니온', '엘리시움', '이노시스', '레드', '오로라', '아케인', '노바', '에오스', '핼리오스'];

if (!NX || !SK) { console.error('NEXON_API_KEY / SUPABASE_SERVICE_KEY 가 필요해요'); process.exit(1); }

let calls = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));
class Budget extends Error {}

async function pageLen(date, world, p) {
  for (let t = 0; t < 5; t++) {
    if (calls >= BUDGET) throw new Budget();
    calls++;
    const r = await fetch(`${API}?date=${date}&world_name=${encodeURIComponent(world)}&page=${p}`, { headers: { 'x-nxopen-api-key': NX } });
    await sleep(SLEEP);
    if (r.ok) { const j = await r.json(); return (j.ranking || []).length; }
    const body = await r.text();
    if (r.status === 429 || r.status >= 500) { await sleep(1500 * (t + 1)); continue; }
    if (r.status === 400 && p > 1) return 0;
    throw new Error(`API ${r.status} ${world} ${date} p${p}: ${body}`);
  }
  throw new Error('API 재시도 초과');
}

async function countWorld(date, world) {
  const cache = new Map();
  const len = async p => { if (!cache.has(p)) cache.set(p, await pageLen(date, world, p)); return cache.get(p); };
  const size = await len(1);
  if (size === 0) return 0;
  let lo = 1, hi = 2;
  while ((await len(hi)) === size) { lo = hi; hi *= 2; }
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if ((await len(mid)) === size) lo = mid; else hi = mid; }
  return lo * size + (await len(hi));
}

async function sb(path, opt = {}) {
  const r = await fetch(`${SB}/rest/v1/${path}`, { ...opt, headers: { apikey: SK, Authorization: `Bearer ${SK}`, 'Content-Type': 'application/json', ...(opt.headers || {}) } });
  const text = await r.text();
  if (!r.ok) throw new Error(`Supabase ${r.status}: ${text}`);
  return text ? JSON.parse(text) : null;
}

async function existing() {
  const done = new Set();
  for (let from = 0; ; from += 1000) {
    const part = await sb('population?select=date,world&order=date.asc', { headers: { Range: `${from}-${from + 999}`, 'Range-Unit': 'items' } });
    part.forEach(x => done.add(`${x.date}|${x.world}`));
    if (part.length < 1000) break;
  }
  return done;
}

function thursdays() {
  const kst = new Date(Date.now() + 9 * 3600e3);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate() - 1));
  while (d.getUTCDay() !== 4) d.setUTCDate(d.getUTCDate() - 1);
  const out = [];
  while (d.toISOString().slice(0, 10) >= START) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() - 7); }
  return out;
}

const done = await existing();
let saved = 0;
outer: for (const [i, date] of thursdays().entries()) {
  for (const world of WORLDS) {
    if (done.has(`${date}|${world}`)) continue;
    try {
      const count = await countWorld(date, world);
      await sb('population', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ date, world, count }]) });
      saved++;
      console.log(`${date} ${world} ${count.toLocaleString()}명 (호출 ${calls}/${BUDGET})`);
    } catch (e) {
      if (e instanceof Budget) { console.log('오늘 호출 한도 도달 — 내일 이어서 수집해요'); break outer; }
      if (i === 0) { console.log(`${date} 데이터가 아직 준비되지 않았어요: ${e.message}`); continue outer; }
      throw e;
    }
  }
}
console.log(`완료 · 저장 ${saved}건 · API 호출 ${calls}건`);
