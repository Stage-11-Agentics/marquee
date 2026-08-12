import { chromium } from 'playwright';
const BASE = 'http://localhost:5251';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', e => errors.push('pageerror: ' + e.message));
p.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

await p.goto(`${BASE}/agenda?event=aie-ny-2026`, { waitUntil: 'networkidle' });
const count0 = await p.textContent('[data-schedule-count]');
const stars = await p.locator('[data-schedule-star]').count();
console.log('initial count', count0, 'stars on page', stars);

// star three sessions: pick the two 09:00 conflicting ones + one other
const ids = ['sub_beyond-the-consensus-navigating-ais-frontier-in-2025','sub_how-to-build-an-ai-strategy-that-fails','sub_building-self-coding-agents'];
for (const id of ids) await p.click(`[data-schedule-star="${id}"]`);
console.log('count after 3 stars', await p.textContent('[data-schedule-count]'));
console.log('aria-pressed states', await p.$$eval('[data-schedule-star]', els => els.filter(e=>e.getAttribute('aria-pressed')==='true').map(e=>e.dataset.scheduleStar)));
const ls = await p.evaluate(() => localStorage.getItem('marquee:schedule:aie-ny-2026'));
console.log('localStorage', ls);

await p.reload({ waitUntil: 'networkidle' });
console.log('count after reload', await p.textContent('[data-schedule-count]'));

// switch to mine
await p.click('[data-schedule-view="mine"]');
await p.waitForLoadState('networkidle');
console.log('url', p.url());
console.log('h1', await p.textContent('h1'));
const visibleRows = await p.$$eval('[data-public-session-id]', els => els.filter(e => !e.hidden && e.offsetParent !== null).map(e => e.dataset.publicSessionId));
console.log('visible rows in mine', visibleRows);
console.log('summary visible', await p.isVisible('[data-schedule-summary]'), '| glance visible', await p.isVisible('[data-schedule-glance]'), '| empty visible', await p.isVisible('[data-schedule-empty]'));
console.log('counts text', (await p.textContent('[data-schedule-counts]'))?.trim());
console.log('glance blocks', await p.$$eval('[data-schedule-block]', els => els.map(e => [e.dataset.scheduleBlock, e.className, e.style.top, e.style.height])));
console.log('overlap chips', await p.$$eval('.overlap-chip', els => els.map(e => e.textContent)));
console.log('next chip', await p.$$eval('.next-chip', els => els.length));
console.log('filters hidden in mine', await p.$eval('[data-public-agenda-filters]', e => e.hidden));
await p.screenshot({ path: '/tmp/shot-mine.png', fullPage: false });
console.log('ERRORS', errors);
await b.close();
