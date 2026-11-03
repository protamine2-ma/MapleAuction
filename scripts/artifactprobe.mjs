// 랭킹 몇 페이지쯤에 아티팩트 40레벨 유저가 있는지 확인 (로그만, 파일 안 만듦)
const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const CLASS = process.env.CLASS || '';
const PAGES = (process.env.PAGES || '1,10,25,50,75,100,150,200,300,400,500,700,1000').split(',').map(s => Number(s.trim())).filter(n => n > 0);
const PER = Number(process.env.PER || 20);
if (!NX) { console.error('NEXON_API_KEY 가 필요해요'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, params) {
  for (let t = 0; t < 5; t++) {
    try { const r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'x-nxopen-api-key': NX } }); if (r.ok) return r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1000 * (t + 1)); continue; } return null; }
    catch (e) { await sleep(1000 * (t + 1)); }
  }
  return null;
}
async function pool(list, fn, size = 10) {
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => { while (i < list.length) { const k = i++; await fn(list[k]); } }));
}
const date = new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
console.log(`날짜 ${date} · ${CLASS || '전체 랭킹'} · 페이지당 ${PER}명 확인`);
console.log('페이지 | 순위 | 캐릭터 레벨 | 아티팩트 레벨 (평균 · 최저~최고) | 38~42레벨 비율');
for (const page of PAGES) {
  const j = await api('/ranking/overall', { date, page, ...(CLASS ? { class: CLASS } : {}) });
  const r = (j && j.ranking) || [];
  if (!r.length) { console.log(`${page}페이지: 랭킹 없음 (여기서 끝)`); break; }
  const pick = r.filter((_, k) => k % Math.max(1, Math.floor(r.length / PER)) === 0).slice(0, PER);
  const lvs = [];
  await pool(pick, async x => {
    const id = await api('/id', { character_name: x.character_name });
    if (!id || !id.ocid) return;
    const u = await api('/user/union', { ocid: id.ocid });
    const lv = Number(u && u.union_artifact_level) || 0;
    if (lv > 0) lvs.push(lv);
  });
  const cl = pick.map(x => Number(x.character_level) || 0).filter(Boolean);
  const avg = a => a.length ? (a.reduce((s, v) => s + v, 0) / a.length).toFixed(1) : '-';
  const near = lvs.filter(v => v >= 38 && v <= 42).length;
  console.log(`${page}페이지 | ${r[0].ranking}~${r[r.length - 1].ranking}위 | Lv.${Math.min(...cl)}~${Math.max(...cl)} | 아티팩트 ${avg(lvs)} · ${lvs.length ? Math.min(...lvs) + '~' + Math.max(...lvs) : '-'} | ${lvs.length ? Math.round(near / lvs.length * 100) : 0}% (${near}/${lvs.length})`);
}
