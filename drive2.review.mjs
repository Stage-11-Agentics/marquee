import { chromium } from 'playwright';
const BASE = 'http://localhost:5251';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, permissions: [] });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
const ids = ['sub_beyond-the-consensus-navigating-ais-frontier-in-2025','sub_how-to-build-an-ai-strategy-that-fails','sub_building-self-coding-agents'];
await p.goto(`${BASE}/agenda?event=aie-ny-2026`);
await p.evaluate((ids) => localStorage.setItem('marquee:schedule:aie-ny-2026', JSON.stringify({v:1,sessionIds:ids,code:null,writeKey:null})), ids);
await p.goto(`${BASE}/agenda?event=aie-ny-2026&view=mine`, { waitUntil: 'networkidle' });

// --- phone sheet: creates a code, draws a QR
await p.click('[data-schedule-action="phone"]');
await p.waitForSelector('[data-schedule-sheet="phone"].open', { timeout: 8000 });
const sync = (await p.textContent('[data-schedule-url="sync"]')).trim();
console.log('sync url:', sync);
const qr = await p.evaluate(() => {
  const c = document.querySelector('[data-schedule-qr]');
  return { hidden: c.hidden, dataUrl: c.toDataURL('image/png') };
});
console.log('qr hidden?', qr.hidden);
await import('node:fs').then(fs => fs.writeFileSync('/tmp/qr-live.png', Buffer.from(qr.dataUrl.split(',')[1], 'base64')));
const stored = await p.evaluate(() => localStorage.getItem('marquee:schedule:aie-ny-2026'));
console.log('stored after phone:', stored);
await p.screenshot({ path: '/tmp/shot-phone.png' });
// focus trap + escape
await p.keyboard.press('Escape');
console.log('phone sheet open after escape?', await p.evaluate(() => !!document.querySelector('[data-schedule-sheet="phone"].open')));

// --- share sheet
await p.click('[data-schedule-action="share"]');
await p.waitForSelector('[data-schedule-sheet="share"].open');
console.log('webcal:', (await p.textContent('[data-schedule-url="webcal"]')).trim());
console.log('share:', (await p.textContent('[data-schedule-url="share"]')).trim());
console.log('code shown:', (await p.textContent('[data-schedule-code]')).trim());
await p.screenshot({ path: '/tmp/shot-share.png' });
await p.keyboard.press('Escape');

// --- brief sheet
await p.click('[data-schedule-action="brief"]');
await p.waitForSelector('[data-schedule-sheet="brief"].open');
await p.waitForTimeout(600);
console.log('--- briefing ---');
console.log(await p.textContent('[data-schedule-brief]'));
await p.screenshot({ path: '/tmp/shot-brief.png' });
await p.keyboard.press('Escape');

// --- ics download
const dl = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('[data-schedule-action="ics"]')]);
console.log('download suggested filename:', dl[0] ? dl[0].suggestedFilename() : 'NO DOWNLOAD EVENT');
if (dl[0]) { await dl[0].saveAs('/tmp/live-download.ics'); }

// --- back-nav origin
await p.click(`[data-public-session-id="${ids[2]}"] .public-session-title a`).catch(async () => {
  const href = await p.getAttribute(`[data-public-session-id="${ids[2]}"] a[href*="/s/"]`, 'href');
  await p.click(`[data-public-session-id="${ids[2]}"] a[href*="/s/"]`);
});
await p.waitForLoadState('networkidle');
console.log('detail url:', p.url());
console.log('back link:', (await p.textContent('[data-schedule-back]')).trim(), '->', await p.getAttribute('[data-schedule-back]', 'href'));
console.log('detail star pressed:', await p.getAttribute('[data-schedule-star]', 'aria-pressed'));
console.log('detail count:', await p.textContent('[data-schedule-count]'));
await p.screenshot({ path: '/tmp/shot-detail.png' });
console.log('ERRORS', errors);
await b.close();
