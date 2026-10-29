// 직업별 특수코어 사용 집계 (한 번 실행용) → specialcore-<직업>.json
import fs from 'node:fs';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const JOB = process.env.JOB || '아델';
const CLASS = process.env.CLASS || '레프-아델';
const N = Number(process.env.COUNT || 300);
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
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < list.length) { const k = i++; await fn(list[k]); } }));
}

const d = new Date(Date.now() + 9 * 3600e3 - 86400e3);
const date = d.toISOString().slice(0, 10);
const cnt = {}, icons = {}, descs = {}; let ok = 0, checked = 0, inactive = 0, other = 0, none = 0;
async function one(name) {
  if (ok >= N) return;
  const id = await api('/id', { character_name: name });
  if (!id || !id.ocid) return;
  const b = await api('/character/basic', { ocid: id.ocid });
  checked++;
  if (!b || String(b.access_flag) !== 'true') { inactive++; return; }
  if (b.character_class !== JOB) { other++; return; }
  if (ok >= N) return;
  const vm = await api('/character/vmatrix', { ocid: id.ocid });
  const eq = (vm && vm.character_v_core_equipment) || [];
  if (!eq.length || ok >= N) return;
  ok++;
  const sp = [...new Set(eq.filter(x => x && x.v_core_name && /special|특수/i.test(String(x.v_core_type))).map(x => x.v_core_name))];
  if (!sp.length) { none++; return; }
  sp.forEach(v => { cnt[v] = (cnt[v] || 0) + 1; });
  if (sp.some(v => !icons[v])) {
    const s = await api('/character/skill', { ocid: id.ocid, character_skill_grade: '5' });
    ((s && s.character_skill) || []).forEach(x => { if (x && sp.includes(x.skill_name)) { if (x.skill_icon) icons[x.skill_name] = x.skill_icon; if (!descs[x.skill_name]) descs[x.skill_name] = x.skill_description || x.skill_effect || ''; } });
  }
}
for (let page = 1; ok < N && page <= 60; page++) {
  const j = await api('/ranking/overall', { date, class: CLASS, page });
  const r = (j && j.ranking) || [];
  if (!r.length) break;
  await pool(r.map(x => x.character_name), one);
  console.log(`랭킹 ${page}페이지 · 확인 ${checked}명 · 활성 ${ok}명 · 특수코어 없음 ${none}명 · 미접속 ${inactive}명 · 다른 직업 ${other}명`);
}
if (!ok) { console.error('집계된 캐릭터가 없어요.'); process.exit(1); }
const items = Object.entries(cnt).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, icon: icons[name] || '', desc: descs[name] || '', count: n, pct: Math.round(n / ok * 1000) / 10 }));
fs.writeFileSync(`specialcore-${JOB}.json`, JSON.stringify({ job: JOB, date, sample: ok, none, items }, null, 2));
items.forEach((x, i) => console.log(`${i + 1}. ${x.name} ${x.pct}%`));
