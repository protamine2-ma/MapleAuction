// 아티팩트 레벨 45 이하 유저만 집계 → artifact40-<직업>.json
// 캐릭터 Lv.285 근처 랭킹 페이지부터 확인 (STARTPAGE 넣으면 그 페이지부터)
process.env.LVMIN = process.env.LVMIN || '1';
process.env.LVMAX = process.env.LVMAX || '45';
process.env.STARTLV = process.env.STARTLV || '285';
process.env.OUT = 'artifact40';
await import('./artifact.mjs');
