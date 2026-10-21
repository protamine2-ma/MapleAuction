// 전 직업 펫버프·링크·하이퍼패시브 집계 (한 번 실행용)
import { spawn, execSync } from 'node:child_process';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const COUNT = process.env.COUNT || '1000';
const ONLY = (process.env.ONLY || '').split(',').map(s => s.trim()).filter(Boolean);
if (!NX) { console.error('NEXON_API_KEY 가 필요해요'); process.exit(1); }

const JG = [['모험가 전사', ['히어로', '팔라딘', '다크나이트']], ['모험가 마법사', ['아크메이지(불,독)', '아크메이지(썬,콜)', '비숍']], ['모험가 궁수', ['보우마스터', '신궁', '패스파인더']], ['모험가 도적', ['나이트로드', '섀도어', '듀얼블레이드']], ['모험가 해적', ['바이퍼', '캡틴', '캐논마스터']],
  ['시그너스 기사단', ['소울마스터', '미하일', '플레임위자드', '윈드브레이커', '나이트워커', '스트라이커']], ['레지스탕스', ['블래스터', '배틀메이지', '와일드헌터', '메카닉', '제논', '데몬슬레이어', '데몬어벤져']],
  ['영웅', ['아란', '에반', '루미너스', '메르세데스', '팬텀', '은월']], ['노바', ['카이저', '카인', '카데나', '엔젤릭버스터']], ['레프', ['아델', '일리움', '칼리', '아크']], ['아니마', ['라라', '호영', '렌']], ['기타', ['제로', '키네시스', '레테']]];

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, params) {
  for (let t = 0; t < 5; t++) {
    try { const r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'x-nxopen-api-key': NX } }); if (r.ok) return r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1000 * (t + 1)); continue; } return null; }
    catch (e) { await sleep(1000 * (t + 1)); }
  }
  return null;
}
const date = new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const norm = s => String(s || '').replace(/\s/g, '');
async function findClass(group, job) {
  const g1 = group.replace('모험가 ', ''), base = job.replace(/\(.*\)/, '');
  const cands = [...new Set([`${g1}-${job}`, `${group}-${job}`, `기사단-${job}`, `데몬-${job}`, `${job}-${job}`, `${base}-${job}`, `${g1}-${base}`])];
  for (const c of cands) {
    const j = await api('/ranking/overall', { date, class: c, page: 1 });
    const r = (j && j.ranking) || [];
    if (r.length && r.slice(0, 20).some(x => norm(x.sub_class_name || x.class_name) === norm(job) || norm(x.class_name).endsWith(norm(job)))) return c;
  }
  return null;
}
const run = (file, env) => new Promise(res => { const p = spawn('node', [file], { env: { ...process.env, ...env }, stdio: 'inherit' }); p.on('close', code => res(code)); });

const fails = [];
for (const [group, jobs] of JG) for (const job of jobs) {
  if (ONLY.length && !ONLY.includes(job)) continue;
  const cls = await findClass(group, job);
  if (!cls) { console.log(`✗ ${job}: 랭킹 직업명을 찾지 못했어요`); fails.push(job); continue; }
  console.log(`\n===== ${job} (${cls}) =====`);
  const env = { JOB: job, CLASS: cls, COUNT };
  const codes = await Promise.all(['scripts/petbuff.mjs', 'scripts/linkskill.mjs', 'scripts/hyperpassive.mjs'].map(f => run(f, env)));
  if (codes.some(c => c)) fails.push(job);
  try { execSync(`git add petbuff-*.json linkskill-*.json hyperpassive-*.json && (git commit -m "전 직업 집계: ${job}" || true) && git push`, { stdio: 'inherit', shell: '/bin/bash' }); } catch (e) { console.log('커밋 실패', e.message); }
}
console.log(fails.length ? `\n실패한 직업: ${fails.join(', ')}` : '\n전 직업 완료');
