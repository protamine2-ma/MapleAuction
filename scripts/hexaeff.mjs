// 연무장 기록 + 헥사 툴팁으로 헥사 코어 강화 효율 순서 계산 (시험용) → hexaeff-<직업>.json
import fs from 'node:fs';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const JOB = process.env.JOB || '아델';
const CLASS = process.env.CLASS || '레프-아델';
const N = Number(process.env.COUNT || 10);
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
// 응답 안에서 조건에 맞는 객체 배열을 찾기 (필드 이름이 정확히 뭔지 몰라도 동작)
function findArr(o, test, depth = 0) {
  if (!o || depth > 6) return null;
  if (Array.isArray(o)) { if (o.length && o.every(x => x && typeof x === 'object') && o.some(test)) return o; for (const x of o) { const f = findArr(x, test, depth + 1); if (f) return f; } return null; }
  if (typeof o === 'object') for (const k of Object.keys(o)) { const f = findArr(o[k], test, depth + 1); if (f) return f; }
  return null;
}
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : 0; };
const norm = s => String(s || '').replace(/\s+/g, '').replace(/(VI|Ⅵ|VI강화|강화)$/, '');

// 솔 에르다 조각: COST[type][L] = L → L+1 (L=0은 활성화)
const COST = {
  origin: [0, 30, 35, 40, 45, 50, 55, 60, 65, 200, 80, 90, 100, 110, 120, 130, 140, 150, 160, 350, 170, 180, 190, 200, 210, 220, 230, 240, 250, 500],
  mastery: [50, 15, 18, 20, 23, 25, 28, 30, 33, 100, 40, 45, 50, 55, 60, 65, 70, 75, 80, 175, 85, 90, 95, 100, 105, 110, 115, 120, 125, 250],
  enhance: [75, 23, 27, 30, 34, 38, 42, 45, 49, 150, 60, 68, 75, 83, 90, 98, 105, 113, 120, 263, 128, 135, 143, 150, 158, 165, 173, 180, 188, 375],
  common: [125, 38, 44, 50, 57, 63, 69, 75, 82, 300, 110, 124, 138, 152, 165, 179, 193, 207, 220, 525, 234, 248, 262, 275, 289, 303, 317, 330, 344, 750],
};
const typeOf = t => { t = String(t || ''); return /스킬|origin|어센트/i.test(t) ? 'origin' : /마스터리|mastery/i.test(t) ? 'mastery' : /강화|enhance/i.test(t) ? 'enhance' : 'common'; };
// 툴팁에서 강도 값 뽑기: 100% 이상이면 데미지%, 미만이면 증가율(1+x/100)
function power(text) {
  const t = String(text || '');
  const m = t.match(/데미지[^\d\n]{0,12}(\d+(?:\.\d+)?)%/);
  const v = m ? num(m[1]) : Math.max(0, ...[...t.matchAll(/(\d+(?:\.\d+)?)%/g)].map(x => num(x[1])));
  if (!v) return null;
  return v >= 100 ? v : 1 + v / 100;
}

const d = new Date(Date.now() + 9 * 3600e3 - 86400e3), date = d.toISOString().slice(0, 10);
const shares = {}, cores = {}, used = []; let raw = null, checked = 0, other = 0, wrongRep = 0, noJob = 0;
// 기록 안에 적힌 직업 이름 찾기
function jobOf(o, depth = 0) { if (!o || typeof o !== 'object' || depth > 5) return ''; for (const k of Object.keys(o)) { if (/^(character_)?(class|job)(_name)?$/i.test(k) && typeof o[k] === 'string' && o[k]) return o[k].trim(); } for (const k of Object.keys(o)) { if (o[k] && typeof o[k] === 'object') { const v = jobOf(o[k], depth + 1); if (v) return v; } } return ''; }

async function one(name) {
  if (used.length >= N) return;
  const id = await api('/id', { character_name: name }); if (!id || !id.ocid) return;
  const b = await api('/character/basic', { ocid: id.ocid });
  checked++;
  if (!b || b.character_class !== JOB) { other++; return; }
  const rl = await api('/battle-practice/replay-id', { ocid: id.ocid });
  const list = (rl && findArr(rl, x => x.replay_id)) || [];
  const reps = list.filter(x => x.replay_id).sort((a, b) => String(b.register_date || '').localeCompare(String(a.register_date || '')));
  let rep = null, res = null, st = null;
  for (const r of reps) {
    if (used.length >= N) return;
    const rr = await api('/battle-practice/result', { replay_id: r.replay_id }); if (!rr) continue;
    const jb = jobOf(rr) || jobOf(await api('/battle-practice/character-info', { replay_id: r.replay_id }));
    if (jb && jb !== JOB) { wrongRep++; continue; }
    if (!jb) { noJob++; continue; }
    const ss = findArr(rr, x => x.skill_name && (x.damage != null || x.damage_percent != null)); if (!ss) continue;
    if (used.some(u => u.replay_id === r.replay_id)) return;
    rep = r; res = rr; st = ss; break;
  }
  if (!st || used.length >= N) return;
  if (!raw) raw = { replay: rep, result: res };
  const tot = st.reduce((s, x) => s + num(x.damage), 0) || 1;
  const dpsV = num(findDps(res));
  used.push({ name, replay_id: rep.replay_id, dps: dpsV });
  st.forEach(x => { const k = String(x.skill_name).trim(), p = x.damage != null ? num(x.damage) / tot * 100 : num(x.damage_percent); shares[k] = (shares[k] || 0) + p; });
  // 헥사 코어 레벨 + 6차 스킬 툴팁
  const hx = await api('/character/hexamatrix', { ocid: id.ocid });
  const sk = await api('/character/skill', { ocid: id.ocid, character_skill_grade: '6' });
  const eq = (hx && hx.character_hexa_core_equipment) || [], s6 = (sk && sk.character_skill) || [];
  eq.forEach(c => {
    const cn = c.hexa_core_name, L = num(c.hexa_core_level); if (!cn || !L) return;
    const o = cores[cn] || (cores[cn] = { name: cn, type: typeOf(c.hexa_core_type), linked: [], pts: {} });
    (c.linked_skill || []).forEach(l => { const n = l.hexa_skill_id || l.skill_name; if (n && !o.linked.includes(n)) o.linked.push(n); });
    const parts = String(cn).split('/').map(x => x.trim()); const tip = s6.find(s => s.skill_name === cn) || s6.find(s => parts.includes(s.skill_name)) || s6.find(s => o.linked.includes(s.skill_name));
    if (tip) { const a = power(tip.skill_effect), b = power(tip.skill_effect_next); if (a) o.pts[L] = a; if (b && L < 30) o.pts[L + 1] = b; if (!o.tip) o.tip = tip.skill_effect || ''; }
  });
  console.log(`✓ ${name} · 기록 ${used.length}/${N}`);
}
function findDps(o, depth = 0) { if (!o || typeof o !== 'object' || depth > 4) return 0; for (const k of Object.keys(o)) { if (/^(total_)?dps$/i.test(k) && !Array.isArray(o[k])) return o[k]; } for (const k of Object.keys(o)) { if (typeof o[k] === 'object' && !Array.isArray(o[k])) { const v = findDps(o[k], depth + 1); if (v) return v; } } return 0; }

for (let page = 1; used.length < N && page <= 80; page++) {
  const j = await api('/ranking/overall', { date, class: CLASS, page });
  const r = (j && j.ranking) || []; if (!r.length) break;
  for (const x of r) { if (used.length >= N) break; await one(x.character_name); }
  console.log(`랭킹 ${page}페이지 · 확인 ${checked}명 · 다른 직업 ${other}명 · 다른 직업 기록 ${wrongRep}개 · 직업 확인 안 됨 ${noJob}개 · 아델 연무장 기록 ${used.length}명`);
}
if (raw) fs.writeFileSync(`hexaeff-raw-${JOB}.json`, JSON.stringify(raw, null, 2));
if (!used.length) { console.error(`아델 연무장 기록을 찾지 못했어요. (직업 확인 안 된 기록 ${noJob}개)`); process.exit(1); }

// 평균 딜 지분
Object.keys(shares).forEach(k => { shares[k] /= used.length; });
const shareOf = c => { const keys = [...new Set([c.name, ...c.linked].flatMap(x => String(x).split('/')).map(norm).filter(Boolean))]; return Object.entries(shares).filter(([k]) => keys.some(n => n && (norm(k) === n || norm(k).startsWith(n) || n.startsWith(norm(k))))).reduce((s, [, v]) => s + v, 0); };
// 레벨별 강도: 모인 점들로 직선 보간
// 직접 확인한 툴팁 수치 (레벨: 퍼뎀)
const KNOWN = { '디바이드': { 1: 486, 30: 834 }, '오더': { 1: 394 }, '임페일': { 1: 368 }, '크리에이션': { 1: 788 }, '마에스트로': { 2: 726 }, '아인하이트': { 1: 924 }, '에테르뤼페': { 1: 500 } };
// 강화 코어 최종뎀: 1~9 11~19%, 10~19 25~34%, 20~29 40~49%, 30 60%
const ENH = L => L >= 30 ? 60 : L >= 20 ? 20 + L : L >= 10 ? 15 + L : 10 + L;
const valAt = (c, L) => {
  const kn = Object.keys(KNOWN).find(k => String(c.name).split('/').map(norm).some(n => n.startsWith(norm(k))));
  if (kn) { const p = { ...Object.fromEntries(Object.entries(c.pts).filter(([, v]) => v >= 100)), ...KNOWN[kn] }; const ks = Object.keys(p).map(Number).sort((a, b) => a - b);
    if (ks.length >= 2) { const lo = ks[0], hi = ks[ks.length - 1]; return p[lo] + (p[hi] - p[lo]) * (L - lo) / (hi - lo); }
    const k = ks[0]; return p[k] * (39.5 + L) / (39.5 + k); }
  if (c.type === 'enhance') return 1 + ENH(L) / 100;
  const ks = Object.keys(c.pts).map(Number).sort((a, b) => a - b);
  // 마스터리·오리진·헤카테: 수치가 하나뿐이면 디바이드와 같은 모양(1레벨 = 30레벨의 58%, 직선)으로 가정
  if (ks.length === 1) { const k = ks[0], v = c.pts[k]; return v * (39.5 + L) / (39.5 + k); }
  if (!ks.length) return (39.5 + L) / 69.5; if (c.pts[L]) return c.pts[L];
  let lo = ks.filter(k => k < L).pop(), hi = ks.find(k => k > L);
  if (lo == null) { lo = ks[0]; hi = ks[1] ?? null; } if (hi == null) { hi = ks[ks.length - 1]; lo = ks.length > 1 ? ks[ks.length - 2] : null; }
  if (lo == null || hi == null || lo === hi) return c.pts[ks[0]] * (1 + (L - ks[0]) * 0.03);
  return c.pts[lo] + (c.pts[hi] - c.pts[lo]) * (L - lo) / (hi - lo); };

const list = Object.values(cores).map(c => ({ ...c, share: Math.round(shareOf(c) * 100) / 100 })).filter(c => c.type !== 'common' || c.share > 0);
const ref = {}; list.forEach(c => { ref[c.name] = Math.max(1, ...Object.keys(c.pts).map(Number)); });
const lv = {}; list.forEach(c => { lv[c.name] = 1; });
const order = [];
for (let step = 0; step < 400; step++) {
  let best = null;
  // 10·20·30레벨 구간 효과까지 보도록, 다음 구간까지 묶어서 올렸을 때의 효율도 비교
  list.forEach(c => { const L = lv[c.name]; if (L >= 30) return; const base = valAt(c, ref[c.name]) || 1;
    let cost = 0; const nb = Math.min(30, Math.ceil((L + 1) / 10) * 10);
    for (let t = L + 1; t <= nb; t++) { cost += COST[c.type][t - 1] || 1;
      const e = c.share * (valAt(c, t) - valAt(c, L)) / base / cost; if (!best || e > best.e) best = { c, e, to: t }; } });
  if (!best) break;
  while (lv[best.c.name] < best.to) { lv[best.c.name]++; order.push({ core: best.c.name, lv: lv[best.c.name], type: best.c.type }); }
}
const out = { job: JOB, date, sample: used.length, replays: used.map(u => ({ dps: u.dps })),
  cores: list.sort((a, b) => b.share - a.share).map(c => ({ name: c.name, type: c.type, share: c.share, linked: c.linked, pts: c.pts })),
  topSkills: Object.entries(shares).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([name, p]) => ({ name, pct: Math.round(p * 10) / 10 })),
  items: order };
fs.writeFileSync(`hexaeff-${JOB}.json`, JSON.stringify(out, null, 2));
console.log('코어 지분:', out.cores.map(c => `${c.name} ${c.share}%`).join(' · '));
out.cores.forEach(c => console.log(`툴팁 수치 ${c.name}:`, Object.entries(c.pts).map(([l, v]) => l + '레벨=' + (+v).toFixed(3)).join(' ')));
console.log('순서:', order.slice(0, 80).map(o => `${o.core}${o.lv}`).join(' → '));
