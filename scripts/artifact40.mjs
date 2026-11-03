// 아티팩트 레벨 38~42 유저만 집계 → artifact40-<직업>.json
process.env.LVMIN = process.env.LVMIN || '38';
process.env.LVMAX = process.env.LVMAX || '42';
process.env.OUT = 'artifact40';
await import('./artifact.mjs');
