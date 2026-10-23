// 메이플 경매장 시세 · 썬데이 메이플 가져오기
// 넥슨 Open API 이벤트 공지에서 '썬데이' 글을 찾아 본문 이미지의 가운데 박스를 잘라 sunday.png 로 저장합니다.
import fs from 'node:fs';
import sharp from 'sharp';

const BASE = 'https://open.api.nexon.com/maplestory/v1';
const NX = process.env.NEXON_API_KEY;
if (!NX) { console.error('NEXON_API_KEY 가 필요해요'); process.exit(1); }

async function api(path, params = {}) {
  const r = await fetch(`${BASE}${path}?${new URLSearchParams(params)}`, { headers: { 'x-nxopen-api-key': NX } });
  if (!r.ok) throw new Error(`API ${r.status}: ${await r.text()}`);
  return r.json();
}

const TEST = process.env.TEST === '1';
const KEYWORD = process.env.KEYWORD || '썬데이';
const list = await api('/notice-event');
const all = list.event_notice || [];
console.log('현재 이벤트 공지 ' + all.length + '개');
all.forEach(n => console.log(' - ' + n.title + ' (' + (n.date_event_start || '').slice(0, 10) + ')'));
let items = all.filter(n => n.title.includes(KEYWORD));
if (!items.length && TEST) { console.log('[테스트] "' + KEYWORD + '" 공지가 없어서 가장 최근 이벤트로 테스트해요.'); items = all.slice(0, 1); }
if (!items.length) { console.log('썬데이 메이플 공지가 아직 없어요.'); process.exit(0); }
items.sort((a, b) => String(b.date_event_start || b.date).localeCompare(String(a.date_event_start || a.date)));
const n = items[0];
const old = fs.existsSync('sunday.json') ? JSON.parse(fs.readFileSync('sunday.json', 'utf8')) : null;
const sameWeek = old && old.notice_id === n.notice_id && String(old.start || '').slice(0, 10) === String(n.date_event_start || '').slice(0, 10);
if (!TEST && sameWeek && fs.existsSync('sunday.png') && process.env.FORCE !== '1') { console.log('이미 받아온 썬데이예요.'); process.exit(0); }

const detail = await api('/notice-event/detail', { notice_id: n.notice_id });
const srcs = [...String(detail.contents || '').matchAll(/<img[^>]+src=["']([^"']+)["']/gi)].map(m => m[1].replace(/&amp;/g, '&'));
console.log(`${n.title} · 이미지 ${srcs.length}개`);

// 밝은 보라색 테두리(가운데 박스) 찾기
function findBox(data, w, h, ch) {
  const isBorder = (x, y) => { const i = (y * w + x) * ch; const r = data[i], g = data[i + 1], b = data[i + 2]; return b > 200 && r > 150 && g > 130 && b >= r && r - g < 60; };
  const rowHits = y => { let c = 0; for (let x = 0; x < w; x += 2) if (isBorder(x, y)) c++; return c * 2 / w; };
  const rows = [];
  for (let y = Math.floor(h * 0.05); y < h; y++) if (rowHits(y) > 0.55) rows.push(y);
  if (rows.length < 2) return null;
  const top = rows[0], bottom = rows[rows.length - 1];
  if (bottom - top < h * 0.15) return null;
  const mid = Math.floor((top + bottom) / 2);
  let left = 0, right = w - 1;
  for (let x = 0; x < w; x++) if (isBorder(x, mid)) { left = x; break; }
  for (let x = w - 1; x >= 0; x--) if (isBorder(x, mid)) { right = x; break; }
  const m = 4;
  return { left: Math.max(0, left - m), top: Math.max(0, top - m), width: Math.min(w, right - left + 1 + m * 2), height: Math.min(h - Math.max(0, top - m), bottom - top + 1 + m * 2) };
}

let best = null;
for (const src of srcs) {
  try {
    const buf = Buffer.from(await (await fetch(src)).arrayBuffer());
    const img = sharp(buf);
    const { data, info } = await img.clone().raw().toBuffer({ resolveWithObject: true });
    const box = findBox(data, info.width, info.height, info.channels);
    console.log(`${src.slice(-40)} ${info.width}x${info.height} ${box ? '박스 찾음' : '박스 없음'}`);
    if (box) { best = await img.extract(box).png().toBuffer(); break; }
    if (!best || info.width * info.height > best.area) best = Object.assign(await img.png().toBuffer(), { area: info.width * info.height });
  } catch (e) { console.log('이미지 처리 실패', e.message); }
}
if (!best) { console.log('이미지를 찾지 못했어요.'); process.exit(0); }

const out = { notice_id: n.notice_id, title: n.title, url: n.url, start: detail.date_event_start || n.date_event_start, end: detail.date_event_end || n.date_event_end, fetched: new Date().toISOString() };
if (TEST) {
  fs.mkdirSync('test', { recursive: true });
  fs.writeFileSync('test/sunday.png', best);
  fs.writeFileSync('test/sunday.json', JSON.stringify(out, null, 2));
  console.log('[테스트] test/sunday.png 저장 완료', out);
} else {
  fs.writeFileSync('sunday.png', best);
  fs.writeFileSync('sunday.json', JSON.stringify(out, null, 2));
  console.log('저장 완료', out);
}
