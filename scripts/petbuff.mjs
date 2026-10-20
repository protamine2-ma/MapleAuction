// 직업별 펫 버프 자동스킬 집계 (한 번 실행용)
// 종합 랭킹 상위 N명의 펫 버프 자동스킬을 모아 petbuff-<직업>.json 으로 저장합니다.
import fs from 'node:fs';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const JOB = process.env.JOB || '아델';
const CLASS = process.env.CLASS || '레프-아델';
const N = Number(process.env.COUNT || 200);
if (!NX) { console.error('NEXON_API_KEY 가 필요해요'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, params) {
  for (let t = 0; t < 5; t++) {
    let r;
    try { r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'x-nxopen-api-key': NX } }); }
    catch (e) { await sleep(1000 * (t + 1)); continue; }
    if (r.ok) return r.json();
    const body = await r.text();
    if (r.status === 429 || r.status >= 500) { await sleep(1000 * (t + 1)); continue; }
    if (r.status === 401 || r.status === 403) throw new Error(`API 키 오류 ${r.status}: ${body}`);
    return null;
  }
  return null;
}
async function pool(list, fn, size = 20) {
  const out = new Array(list.length); let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < list.length) { const k = i++; out[k] = await fn(list[k]); } }));
  return out;
}

const d = new Date(Date.now() + 9 * 3600e3 - 86400e3);
const date = d.toISOString().slice(0, 10);
const names = [];
for (let page = 1; names.length < N && page <= 5; page++) {
  const j = await api('/ranking/overall', { date, class: CLASS, page });
  const r = (j && j.ranking) || [];
  if (!r.length) break;
  r.forEach(x => names.length < N && names.push(x.character_name));
}
console.log(`${date} · ${CLASS} 랭킹 ${names.length}명`);
if (!names.length) { console.error('랭킹을 못 가져왔어요. CLASS 값을 확인해 주세요.'); process.exit(1); }

const count = {}, icons = {}; let ok = 0;
await pool(names, async name => {
  const id = await api('/id', { character_name: name });
  if (!id || !id.ocid) return;
  const p = await api('/character/pet-equipment', { ocid: id.ocid, date });
  if (!p) return;
  const set = new Set();
  for (const k of ['pet_1_auto_skill', 'pet_2_auto_skill', 'pet_3_auto_skill']) {
    const s = p[k]; if (!s) continue;
    for (const n of ['skill_1', 'skill_2']) { const v = s[n]; if (v) { set.add(v); if (s[n + '_icon']) icons[v] = s[n + '_icon']; } }
  }
  if (!set.size) return;
  ok++; set.forEach(v => { count[v] = (count[v] || 0) + 1; });
});

const items = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([name, c]) => ({ name, icon: icons[name] || '', count: c, pct: Math.round(c / ok * 1000) / 10 }));
fs.writeFileSync(`petbuff-${JOB}.json`, JSON.stringify({ job: JOB, date, sample: ok, items }, null, 2));
console.log(`펫 버프 사용 캐릭터 ${ok}명 · 스킬 ${items.length}종`);
items.slice(0, 15).forEach((x, i) => console.log(`${i + 1}. ${x.name} ${x.pct}%`));
