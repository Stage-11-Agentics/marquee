import { chromium } from 'playwright';
const BASE = 'http://localhost:5251';
const b = await chromium.launch();
const ids = ['sub_beyond-the-consensus-navigating-ais-frontier-in-2025','sub_how-to-build-an-ai-strategy-that-fails','sub_building-self-coding-agents'];

// A "device A" creates a code we can share.
const a = await b.newContext();
const pa = await a.newPage();
await pa.goto(`${BASE}/agenda?event=aie-ny-2026`);
await pa.evaluate((ids) => localStorage.setItem('marquee:schedule:aie-ny-2026', JSON.stringify({v:1,sessionIds:ids,code:null,writeKey:null})), ids);
await pa.goto(`${BASE}/agenda?event=aie-ny-2026&view=mine`, { waitUntil:'networkidle' });
await pa.click('[data-schedule-action="share"]');
await pa.waitForSelector('[data-schedule-sheet="share"].open');
const code = (await pa.textContent('[data-schedule-code]')).trim();
const key = await pa.evaluate(() => JSON.parse(localStorage.getItem('marquee:schedule:aie-ny-2026')).writeKey);
console.log('device A code', code);

// --- device B: share arrival (read-only import)
const bb = await b.newContext();
const pb = await bb.newPage();
const errB = []; pb.on('pageerror', e=>errB.push(''+e)); pb.on('console', m=>{if(m.type()==='error') errB.push(m.text());});
await pb.goto(`${BASE}/agenda?event=aie-ny-2026&sched=${code}`, { waitUntil:'networkidle' });
await pb.waitForTimeout(500);
console.log('B banner visible', await pb.isVisible('[data-schedule-import]'), '|', (await pb.textContent('[data-schedule-import-message]')).trim());
await pb.screenshot({ path: '/tmp/shot-import-banner.png' });
await pb.click('[data-schedule-action="import"]');
await pb.waitForTimeout(300);
console.log('B after import: count', await pb.textContent('[data-schedule-count]'), 'banner visible', await pb.isVisible('[data-schedule-import]'));
console.log('B storage', await pb.evaluate(() => localStorage.getItem('marquee:schedule:aie-ny-2026')));

// --- device C: sync arrival with fragment key
const c = await b.newContext();
const pc = await c.newPage();
await pc.goto(`${BASE}/agenda?event=aie-ny-2026`);
await pc.evaluate(() => localStorage.setItem('marquee:schedule:aie-ny-2026', JSON.stringify({v:1,sessionIds:['sub_the-agentic-enterprise-lessons-from-the-field'],code:null,writeKey:null})));
await pc.goto(`${BASE}/agenda?event=aie-ny-2026&sched=${code}#k=${key}`, { waitUntil:'networkidle' });
await pc.waitForTimeout(700);
console.log('C url after capture:', pc.url());
console.log('C banner:', (await pc.textContent('[data-schedule-import-message]')).trim());
console.log('C storage:', await pc.evaluate(() => localStorage.getItem('marquee:schedule:aie-ny-2026')));
// C now stars one more; the shared code should pick it up
await pc.click('[data-schedule-star="sub_ai-in-production-lessons-from-the-trenches"]').catch(async () => {
  const first = await pc.$$eval('[data-schedule-star]', els => els.map(e=>e.dataset.scheduleStar));
  console.log('  (fallback star)', first[5]);
  await pc.click(`[data-schedule-star="${first[5]}"]`);
});
await pc.waitForTimeout(1500);
const server = await (await fetch(`${BASE}/api/v1/public/schedules/${code}`)).json();
console.log('server set after C edit:', server.sessions.length, server.sessions.map(s=>s.id));

// --- stale star recovery: a starred id that is not published
const d = await b.newContext();
const pd = await d.newPage();
const errD = []; pd.on('pageerror', e=>errD.push(''+e));
await pd.goto(`${BASE}/agenda?event=aie-ny-2026`);
await pd.evaluate((ids) => localStorage.setItem('marquee:schedule:aie-ny-2026', JSON.stringify({v:1,sessionIds:[...ids,'sub_ghost-session'],code:null,writeKey:null})), ids);
await pd.goto(`${BASE}/agenda?event=aie-ny-2026&view=mine`, { waitUntil:'networkidle' });
console.log('D count with a ghost star:', await pd.textContent('[data-schedule-count]'), '| counts line:', (await pd.textContent('[data-schedule-counts]')).trim());
await pd.click('[data-schedule-action="share"]');
await pd.waitForTimeout(2500);
console.log('D share sheet open:', await pd.evaluate(()=>!!document.querySelector('[data-schedule-sheet="share"].open')));
console.log('D error slot:', await pd.evaluate(()=>{const e=document.querySelector('[data-schedule-sheet="share"] [data-schedule-error]');return {hidden:e.hidden,text:e.textContent};}));
console.log('D storage after recovery:', await pd.evaluate(() => localStorage.getItem('marquee:schedule:aie-ny-2026')));
console.log('D count after recovery:', await pd.textContent('[data-schedule-count]'));

// --- empty state
const e = await b.newContext();
const pe = await e.newPage();
await pe.goto(`${BASE}/agenda?event=aie-ny-2026&view=mine`, { waitUntil:'networkidle' });
console.log('empty state visible', await pe.isVisible('[data-schedule-empty]'), '| list visible', await pe.isVisible('[data-schedule-list]'), '| summary visible', await pe.isVisible('[data-schedule-summary]'), '| glance visible', await pe.isVisible('[data-schedule-glance]'));
await pe.screenshot({ path: '/tmp/shot-empty.png' });

// --- mobile 390
const m = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const pm = await m.newPage();
await pm.goto(`${BASE}/agenda?event=aie-ny-2026`);
await pm.evaluate((ids) => localStorage.setItem('marquee:schedule:aie-ny-2026', JSON.stringify({v:1,sessionIds:ids,code:null,writeKey:null})), ids);
await pm.goto(`${BASE}/agenda?event=aie-ny-2026&view=mine`, { waitUntil:'networkidle' });
const overflow = await pm.evaluate(() => ({ scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth }));
console.log('mobile overflow', overflow);
await pm.screenshot({ path: '/tmp/shot-mobile-mine.png', fullPage: true });
console.log('errB', errB, 'errD', errD);
await b.close();
