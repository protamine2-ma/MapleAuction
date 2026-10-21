// 직업별 펫 버프 자동스킬 집계 (한 번 실행용)
// 종합 랭킹 상위 N명의 펫 버프 자동스킬을 모아 petbuff-<직업>.json 으로 저장합니다.
import fs from 'node:fs';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const JOB = process.env.JOB || '아델';
const CLASS = process.env.CLASS || '레프-아델';
const N = Number(process.env.COUNT || 500);
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
const count = {}, icons = {}; let ok = 0, checked = 0, inactive = 0, other = 0; const ocids = [];
async function one(name) {
  if (ok >= N) return;
  const id = await api('/id', { character_name: name });
  if (!id || !id.ocid) return;
  const b = await api('/character/basic', { ocid: id.ocid });
  checked++;
  if (!b || String(b.access_flag) !== 'true') { inactive++; return; }
  if (b.character_class !== JOB) { other++; return; }
  if (ok >= N) return;
  const p = await api('/character/pet-equipment', { ocid: id.ocid });
  if (!p) return;
  const set = new Set();
  for (const k of ['pet_1_auto_skill', 'pet_2_auto_skill', 'pet_3_auto_skill']) {
    const s = p[k]; if (!s) continue;
    for (const n of ['skill_1', 'skill_2']) { const v = s[n]; if (v) { set.add(v); if (s[n + '_icon']) icons[v] = s[n + '_icon']; } }
  }
  if (!set.size || ok >= N) return;
  ok++; if (ocids.length < 30) ocids.push(id.ocid); set.forEach(v => { count[v] = (count[v] || 0) + 1; });
}
for (let page = 1; ok < N && page <= 60; page++) {
  const j = await api('/ranking/overall', { date, class: CLASS, page });
  const r = (j && j.ranking) || [];
  if (!r.length) break;
  await pool(r.map(x => x.character_name), one);
  console.log(`랭킹 ${page}페이지 · 확인 ${checked}명 · 활성 ${ok}명 · 미접속 ${inactive}명 · 다른 직업 ${other}명`);
}
if (!ok) { console.error('집계된 캐릭터가 없어요. CLASS 값을 확인해 주세요.'); process.exit(1); }

const items = Object.entries(count).sort((a, b) => b[1] - a[1]).map(([name, c]) => ({ name, icon: icons[name] || '', count: c, pct: Math.round(c / ok * 1000) / 10 }));

// 스킬 차수 확인: 활성 캐릭터 몇 명의 차수별 스킬 목록에서 이름을 찾아요
const GRADES = [['0', '0차'], ['1', '1차'], ['1.5', '1.5차'], ['2', '2차'], ['2.5', '2.5차'], ['3', '3차'], ['4', '4차'], ['hyperpassive', '하이퍼 패시브'], ['hyperactive', '하이퍼 액티브'], ['5', '5차'], ['6', '6차']];
const tier = {}, sinfo = {}, want = new Set(items.filter(x => x.pct > 20).map(x => x.name));
for (const oc of ocids) {
  if (![...want].some(n => !tier[n])) break;
  const res = await pool(GRADES, ([g]) => api('/character/skill', { ocid: oc, character_skill_grade: g }), 11);
  res.forEach((j, k) => ((j && j.character_skill) || []).forEach(s => { if (want.has(s.skill_name) && !tier[s.skill_name]) { tier[s.skill_name] = GRADES[k][1]; sinfo[s.skill_name] = { info: s.skill_description || '', effect: s.skill_effect || '', lv: s.skill_level || 0 }; } }));
}
items.forEach(x => { if (tier[x.name]) x.tier = tier[x.name]; if (sinfo[x.name]) Object.assign(x, sinfo[x.name]); });
console.log('차수 확인: ' + Object.entries(tier).map(([n, t]) => n + '=' + t).join(', '));
fs.writeFileSync(`petbuff-${JOB}.json`, JSON.stringify({ job: JOB, date, sample: ok, active: true, items }, null, 2));
console.log(`펫 버프 사용 캐릭터 ${ok}명 · 스킬 ${items.length}종`);
items.slice(0, 15).forEach((x, i) => console.log(`${i + 1}. ${x.name} ${x.pct}% ${x.tier || ''}`));
