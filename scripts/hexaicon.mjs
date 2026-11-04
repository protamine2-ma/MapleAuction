// 헥사스킬 그림 맨 윗줄 아이콘 → 넥슨 API 스킬 아이콘과 비교해서 이름 찾기 (JOB 있으면 hexaicon-직업.json 저장)
import fs from 'node:fs';
import zlib from 'node:zlib';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
const CLASS = process.env.CLASS || '영웅-루미너스';
const IMGMAP = {"히어로":"hero","팔라딘":"paladin","다크나이트":"darkknight","아크메이지(불,독)":"archmagefp","아크메이지(썬,콜)":"archmageil","비숍":"bishop","보우마스터":"bowmaster","신궁":"sniper","패스파인더":"pathfinder","나이트로드":"nightlord","섀도어":"shadower","듀얼블레이드":"dualblade","바이퍼":"viper","캡틴":"captain","캐논마스터":"cannonmaster","소울마스터":"soulmaster","미하일":"mihile","플레임위자드":"flamewizard","윈드브레이커":"windbreaker","나이트워커":"nightwalker","스트라이커":"striker","블래스터":"blaster","배틀메이지":"battlemage","와일드헌터":"wildhunter","메카닉":"mechanic","제논":"xenon","데몬슬레이어":"demonslayer","데몬어벤져":"demonavenger","아란":"aran","에반":"evan","루미너스":"luminous","메르세데스":"mercedes","팬텀":"phantom","은월":"eunwol","카이저":"kaiser","카인":"kain","카데나":"cadena","엔젤릭버스터":"angelicbuster","아델":"adele","일리움":"illium","칼리":"khali","아크":"ark","라라":"lara","호영":"hoyoung","렌":"ren","제로":"zero","키네시스":"kinesis","레테":"lethe"};
const JOB0 = process.env.JOB || CLASS.split('-').pop();
const IMG = process.env.IMG || ('img/hexa-' + (IMGMAP[JOB0] || 'luminous') + '.png');
const COLS = Number(process.env.COLS || 15), X0 = Number(process.env.X0 || 42), STEP = Number(process.env.STEP || 64.3), Y0 = Number(process.env.Y0 || 40);
if (!NX) { console.error('NEXON_API_KEY 가 필요해요'); process.exit(1); }

function png(buf) {
  let p = 8, w = 0, h = 0, ct = 0, bd = 8, pal = null, trns = null; const idat = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p), type = buf.toString('ascii', p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') { w = d.readUInt32BE(0); h = d.readUInt32BE(4); bd = d[8]; ct = d[9]; }
    else if (type === 'PLTE') pal = d; else if (type === 'tRNS') trns = d; else if (type === 'IDAT') idat.push(d); else if (type === 'IEND') break;
    p += 12 + len;
  }
  if (bd !== 8) throw new Error('8bit PNG만 지원');
  const ch = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[ct], raw = zlib.inflateSync(Buffer.concat(idat)), st = w * ch, out = Buffer.alloc(w * h * 4);
  let prev = Buffer.alloc(st);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (st + 1)], line = Buffer.from(raw.subarray(y * (st + 1) + 1, (y + 1) * (st + 1)));
    for (let i = 0; i < st; i++) { const a = i >= ch ? line[i - ch] : 0, b = prev[i], c = i >= ch ? prev[i - ch] : 0;
      line[i] = (line[i] + (f === 1 ? a : f === 2 ? b : f === 3 ? (a + b) >> 1 : f === 4 ? (() => { const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c); return pa <= pb && pa <= pc ? a : pb <= pc ? b : c; })() : 0)) & 255; }
    for (let x = 0; x < w; x++) { const o = (y * w + x) * 4, s = x * ch;
      if (ct === 6) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = line[s + 3]; }
      else if (ct === 2) { out[o] = line[s]; out[o + 1] = line[s + 1]; out[o + 2] = line[s + 2]; out[o + 3] = 255; }
      else if (ct === 3) { const k = line[s]; out[o] = pal[k * 3]; out[o + 1] = pal[k * 3 + 1]; out[o + 2] = pal[k * 3 + 2]; out[o + 3] = trns && k < trns.length ? trns[k] : 255; }
      else if (ct === 0) { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = 255; }
      else { out[o] = out[o + 1] = out[o + 2] = line[s]; out[o + 3] = line[s + 1]; } }
    prev = line;
  }
  return { w, h, d: out };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function api(path, params) {
  for (let t = 0; t < 5; t++) {
    try { const r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'x-nxopen-api-key': NX } }); if (r.ok) return r.json(); if (r.status === 429 || r.status >= 500) { await sleep(1000 * (t + 1)); continue; } return null; }
    catch (e) { await sleep(1000 * (t + 1)); }
  }
  return null;
}
const date = new Date(Date.now() + 9 * 3600e3 - 86400e3).toISOString().slice(0, 10);
const JOB = JOB0, JOBS = [JOB, process.env.API_JOB].filter(Boolean);
const icons = {};
let got = 0;
for (const c of [...new Set([CLASS, '영웅-' + JOB, '마법사-' + JOB, JOB + '-' + JOB, '레프-' + JOB, '노바-' + JOB, '기사단-' + JOB, '모험가-' + JOB])]) {
  if (got >= 3) break;
  const rk = await api('/ranking/overall', { date, class: c, page: 1 });
  for (const x of ((rk && rk.ranking) || []).slice(0, 30)) {
    if (got >= 3) break;
    const id = await api('/id', { character_name: x.character_name }); if (!id || !id.ocid) continue;
    const b = await api('/character/basic', { ocid: id.ocid }); if (!b || !JOBS.includes(b.character_class)) continue;
    got++; console.log(`확인: ${x.character_name} (${b.character_class}, 랭킹 직업명 ${c})`);
    for (const g of ['6', '5']) { const s = await api('/character/skill', { ocid: id.ocid, character_skill_grade: g }); ((s && s.character_skill) || []).forEach(k => { if (k.skill_icon && !icons[k.skill_name] && !/HEXA 스탯|솔 에르다/.test(k.skill_name)) icons[k.skill_name] = k.skill_icon; }); }
  }
}
if (!got) { console.log(JOB + ' 캐릭터를 못 찾았어요'); process.exit(1); }
console.log(`API 아이콘 ${Object.keys(icons).length}개 받음`);
const tpl = [];
for (const [name, url] of Object.entries(icons)) { try { const r = await fetch(url); tpl.push({ name, ...png(Buffer.from(await r.arrayBuffer())) }); } catch (e) { console.log('아이콘 읽기 실패', name); } }

const im = png(fs.readFileSync(IMG));
const px = (x, y) => { x = Math.round(x); y = Math.round(y); if (x < 0 || y < 0 || x >= im.w || y >= im.h) return null; const o = (y * im.w + x) * 4; return [im.d[o], im.d[o + 1], im.d[o + 2]]; };
function score(t, cx, cy, sc) {
  let s = 0, n = 0;
  for (let y = 0; y < t.h * 0.7; y++) for (let x = 0; x < t.w; x++) {
    const o = (y * t.w + x) * 4; if (t.d[o + 3] < 200) continue;
    const q = px(cx + (x - t.w / 2) * sc, cy + (y - t.h / 2) * sc); if (!q) return 1e9;
    s += Math.abs(q[0] - t.d[o]) + Math.abs(q[1] - t.d[o + 1]) + Math.abs(q[2] - t.d[o + 2]); n++;
  }
  return n > 50 ? s / n : 1e9;
}
const res = [];
for (let k = 0; k < COLS; k++) {
  const cx0 = X0 + STEP * k, list = [];
  for (const t of tpl) { let best = 1e9; for (const sc of [1, 1.1, 1.2, 1.3, 1.4]) for (let dy = -12; dy <= 12; dy += 2) for (let dx = -12; dx <= 12; dx += 2) { const v = score(t, cx0 + dx, Y0 + dy, sc); if (v < best) best = v; } list.push([t.name, best]); }
  list.sort((a, b) => a[1] - b[1]);
  const g = px(cx0 - 18, Y0 - 18), green = g && g[1] > g[0] + 25 && g[1] > g[2] + 10;
  const nm = String(list[0][0]);
  res.push(/^솔 헤카테/.test(nm) || (green && list[0][1] > 140) ? '솔 헤카테' : nm.replace(/ (VI|강화)$/, ''));
  console.log(`${k + 1}번: ${list[0][0]} (차이 ${list[0][1].toFixed(0)}) · 2위 ${list[1] ? list[1][0] + ' ' + list[1][1].toFixed(0) : '-'}`);
}
console.log('\n맨 윗줄: ' + res.join(' / '));
if (process.env.JOB) fs.writeFileSync(`hexaicon-${JOB}.json`, JSON.stringify({ job: JOB, img: IMG, w: im.w, x0: X0, step: STEP, names: res, date }));
