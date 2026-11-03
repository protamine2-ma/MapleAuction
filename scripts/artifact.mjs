// 직업별 아티팩트 집계 (한 번 실행용) → artifact-<직업>.json
import fs from 'node:fs';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const JOB = process.env.JOB || '아델';
const CLASS = process.env.CLASS || '레프-아델';
const N = Number(process.env.COUNT || 50);
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
const combo = {}, opt = {}, eff = {}; let ok = 0, checked = 0, inactive = 0, other = 0, notMain = 0, noRaid = 0, lvSum = 0, lvN = 0, noArt = 0, outLv = 0;
const LVMIN = Number(process.env.LVMIN || 0), LVMAX = Number(process.env.LVMAX || 999), OUT = process.env.OUT || 'artifact', MAXPAGE = Number(process.env.MAXPAGE || (LVMIN ? 400 : 60));
async function one(name) {
  if (ok >= N) return;
  const id = await api('/id', { character_name: name });
  if (!id || !id.ocid) return;
  const b = await api('/character/basic', { ocid: id.ocid });
  checked++;
  if (!b || String(b.access_flag) !== 'true') { inactive++; return; }
  if (![JOB, process.env.API_JOB].filter(Boolean).includes(b.character_class)) { other++; return; }
  if (ok >= N) return;
  const ur = await api('/user/union-raider', { ocid: id.ocid });
  const bl = ((ur && ur.union_block) || []).map(x => Number(x.block_level) || 0).filter(x => x > 0);
  const myLv = Number(b.character_level) || 0, top = bl.length ? Math.max(...bl) : 0;
  if (bl.length && myLv < top) { notMain++; if (notMain <= 5) console.log(`  본캐 아님 예: ${name} Lv.${myLv} / 유니온 최고 Lv.${top} (블록 ${bl.length}개)`); return; }
  if (!bl.length && noRaid++ < 5) console.log(`  유니온 정보 없음: ${name} → 본캐로 봄 (응답 키: ${ur ? Object.keys(ur).join(',') : 'null'})`);
  if (ok >= N) return;
  const u = await api('/user/union', { ocid: id.ocid });
  const lv = Number(u && u.union_artifact_level) || 0;
  if (LVMIN && (lv < LVMIN || lv > LVMAX)) { outLv++; return; }
  if (ok >= N) return;
  const a = await api('/user/union-artifact', { ocid: id.ocid });
  const cr = ((a && a.union_artifact_crystal) || []).filter(c => c && c.crystal_option_name_1);
  if (!cr.length || ok >= N) { if (!cr.length && noArt++ < 5) console.log(`  아티팩트 없음: ${name} (응답 키: ${a ? Object.keys(a).join(',') : 'null'})`); return; }
  ok++;
  if (lv > 0) { lvSum += lv; lvN++; }
  const seenC = new Set(), seenO = new Set();
  cr.forEach(c => {
    const o = [c.crystal_option_name_1, c.crystal_option_name_2, c.crystal_option_name_3].filter(Boolean);
    const k = o.join(' | '); if (!seenC.has(k)) { seenC.add(k); combo[k] = (combo[k] || 0) + 1; }
    o.forEach(x => { if (!seenO.has(x)) { seenO.add(x); opt[x] = (opt[x] || 0) + 1; } });
  });
  ((a && a.union_artifact_effect) || []).forEach(e => { if (!e || !e.name) return; const nm = String(e.name).replace(/[\d.]+%?/g, '').replace(/\s+/g, ' ').trim(); const x = eff[nm] || (eff[nm] = { n: 0, sum: 0, max: 0 }); x.n++; x.sum += Number(e.level) || 0; if (Number(e.level) >= 10) x.max++; });
}
for (let page = 1; ok < N && page <= MAXPAGE; page++) {
  const j = await api('/ranking/overall', { date, class: CLASS, page });
  const r = (j && j.ranking) || [];
  if (!r.length) break;
  await pool(r.map(x => x.character_name), one);
  console.log(`랭킹 ${page}페이지 · 확인 ${checked}명 · 집계 ${ok}명 · 본캐 아님 ${notMain}명${LVMIN ? ` · 레벨 범위 밖 ${outLv}명` : ''} · 미접속 ${inactive}명 · 다른 직업 ${other}명`);
}
if (!ok) { console.error('집계된 캐릭터가 없어요.'); process.exit(1); }
const pc = n => Math.round(n / ok * 1000) / 10;
const items = Object.entries(combo).sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, n]) => ({ opts: k.split(' | '), count: n, pct: pc(n) }));
const opts = Object.entries(opt).sort((a, b) => b[1] - a[1]).map(([name, n]) => ({ name, count: n, pct: pc(n) }));
const effects = Object.entries(eff).map(([name, x]) => ({ name, avgLv: Math.round(x.sum / x.n * 10) / 10, maxPct: pc(x.max) })).sort((a, b) => b.avgLv - a.avgLv);
fs.writeFileSync(`${OUT}-${JOB}.json`, JSON.stringify({ job: JOB, date, sample: ok, lvRange: LVMIN ? [LVMIN, LVMAX] : null, avgLv: lvN ? Math.round(lvSum / lvN * 10) / 10 : 0, items, opts, effects }, null, 2));
console.log(`평균 아티팩트 레벨 ${lvN ? (lvSum / lvN).toFixed(1) : '-'}`);
items.slice(0, 9).forEach((x, i) => console.log(`${i + 1}. ${x.opts.join(' / ')} ${x.pct}%`));
