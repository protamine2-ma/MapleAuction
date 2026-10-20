// 직업별 링크 스킬 장착 집계 (한 번 실행용) → linkskill-<직업>.json
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
const HUNT = ['엘프의 축복', '룬 퍼시스턴스', '자신감', '자연의 벗', '콤보킬 어드밴티지', '시그너스 블레스', '어드벤쳐러 큐리어스', '이네이트 기프트'];
const BOSS = ['소울 컨트랙트', '데몬스 퓨리', '시프 커닝', '임피리컬 널리지', '프라이어 프리퍼레이션', '퍼미에이트', '커버넌트', '인텐시브 인썰트'];
const C = { boss: { n: 0, c: {} }, hunt: { n: 0, c: {} } }, icons = {}; let ok = 0, checked = 0, inactive = 0, other = 0;
const score = (list, keys) => list.filter(x => keys.includes(x.skill_name)).length;
async function one(name) {
  if (ok >= N) return;
  const id = await api('/id', { character_name: name });
  if (!id || !id.ocid) return;
  const b = await api('/character/basic', { ocid: id.ocid });
  checked++;
  if (!b || String(b.access_flag) !== 'true') { inactive++; return; }
  if (b.character_class !== JOB) { other++; return; }
  if (ok >= N) return;
  const l = await api('/character/link-skill', { ocid: id.ocid });
  if (!l) return;
  const pres = [l.character_link_skill_preset_1, l.character_link_skill_preset_2, l.character_link_skill_preset_3, l.character_link_skill].map(p => (p || []).filter(x => x && x.skill_name));
  const valid = pres.filter(p => p.length >= 5);
  if (!valid.length || ok >= N) return;
  ok++;
  const pick = (keys, other) => valid.map(p => [p, score(p, keys) - score(p, other)]).sort((x, y) => y[1] - x[1])[0];
  const add = (k, p) => { C[k].n++; new Set(p.map(x => x.skill_name)).forEach(v => { C[k].c[v] = (C[k].c[v] || 0) + 1; }); p.forEach(x => { if (x.skill_icon) icons[x.skill_name] = x.skill_icon; }); };
  const h = pick(HUNT, BOSS), bo = pick(BOSS, HUNT);
  if (h && h[1] >= 2) add('hunt', h[0]);
  if (bo && bo[1] >= 1 && (!h || bo[0] !== h[0] || h[1] < 2)) add('boss', bo[0]);
}
for (let page = 1; ok < N && page <= 60; page++) {
  const j = await api('/ranking/overall', { date, class: CLASS, page });
  const r = (j && j.ranking) || [];
  if (!r.length) break;
  await pool(r.map(x => x.character_name), one);
  console.log(`랭킹 ${page}페이지 · 확인 ${checked}명 · 활성 ${ok}명 · 미접속 ${inactive}명 · 다른 직업 ${other}명`);
}
if (!ok) { console.error('집계된 캐릭터가 없어요.'); process.exit(1); }

const list = k => Object.entries(C[k].c).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, icon: icons[name] || '', count: n, pct: Math.round(n / Math.max(1, C[k].n) * 1000) / 10 }));
const out = { job: JOB, date, sample: ok, active: true, boss: { sample: C.boss.n, items: list('boss') }, hunt: { sample: C.hunt.n, items: list('hunt') } };
fs.writeFileSync(`linkskill-${JOB}.json`, JSON.stringify(out, null, 2));
for (const k of ['boss', 'hunt']) { console.log(`[${k}] ${out[k].sample}명`); out[k].items.slice(0, 14).forEach((x, i) => console.log(`${i + 1}. ${x.name} ${x.pct}%`)); }
