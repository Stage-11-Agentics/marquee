import { chromium } from '@playwright/test';
const FILE = 'file:///Users/atin/Projects/Stage11/deployments/Marquee/prototypes/pipeline-v1.1/index.html';
const ROUTES = ['landing','dashboard','board','submissions','forms','evaluation','reviewer','onboarding','agenda','comms','settings','settings/venues','settings/tasks','settings/airtable','settings/api','settings/webhooks','api/docs','import','portal','cfp','publicAgenda','evaluation/ai','conferences/new','submissions/new','submissions/AIE-0027','s/AIE-0001','p/Amara van der Meer'];

const b = await chromium.launch();
const page = await b.newPage();
const errors = [];
page.on('pageerror', e => errors.push(`${page.url().split('#')[1]||'-'} :: ${e.message}`));
page.on('console', m => { if (m.type()==='error') errors.push(`console :: ${m.text()}`); });

await page.goto(FILE);
for (const r of ROUTES) {
  await page.goto(`${FILE}#${r}`);
  await page.waitForTimeout(90);
  const txt = await page.locator('#app').innerText();
  if (txt.trim().length < 40) errors.push(`ROUTE EMPTY: ${r}`);
}
console.log(`routes crawled: ${ROUTES.length}`);

// --- Issue 5: decided but not notified ---
await page.goto(`${FILE}#dashboard`);
await page.waitForTimeout(120);
const att = await page.locator('[data-not-notified] strong').innerText();
console.log('attention row:', att);
await page.locator('[data-not-notified]').click();
await page.waitForTimeout(150);
const h = await page.locator('.page h1, .page h2').first().innerText();
const rowsBefore = await page.locator('tbody tr').count();
console.log('not-notified view:', h, '| rows:', rowsBefore);
const gapCell = await page.locator('.notified-cell.gap').first().innerText();
console.log('gap cell states reason:', gapCell);
await page.locator('#notify-all').click();
await page.waitForTimeout(200);
const attAfter = await page.locator('body').innerText();
console.log('notify-all fired:', attAfter.includes('notified ·') || attAfter.includes('still need an address'));

// --- Issue 1: reversal cancels tasks ---
await page.goto(`${FILE}#portal`);
await page.waitForTimeout(150);
console.log('portal progress before:', await page.locator('.portal-progress strong').innerText());
const liveBefore = await page.locator('#task-list .task-row').count();

await page.goto(`${FILE}#submissions/AIE-0027`);
await page.waitForTimeout(150);
await page.locator('#open-unaccept').click();
await page.waitForTimeout(120);
const opts = await page.locator('#cascade-tasks option').allInnerTexts();
console.log('reversal task options:', opts.join(' / '));
console.log('reversal note:', await page.locator('#cascade-tasks-note').innerText());
await page.locator('#confirm-unaccept').click();
await page.waitForTimeout(250);
const hist = await page.locator('.history-row').allInnerTexts();
console.log('history top 2:', hist.slice(0,2).map(s=>s.split('\n')[0]).join(' | '));

await page.goto(`${FILE}#portal`);
await page.waitForTimeout(150);
console.log('portal progress after:', await page.locator('.portal-progress strong').innerText());
console.log('cancelled block present:', await page.locator('.cancelled-block').count() > 0);
console.log('cancelled reason:', (await page.locator('.cancelled-reason').innerText()).slice(0,90));
const cancelledRows = await page.locator('.task-row.cancelled').count();
const liveAfter = await page.locator('#task-list .task-row:not(.cancelled)').count();
console.log(`tasks: ${liveBefore} live before -> ${liveAfter} live, ${cancelledRows} cancelled`);
const doneKept = await page.locator('.task-row.cancelled .task-meta').allInnerTexts();
console.log('completed work kept note:', doneKept.some(t=>t.includes('completed work is kept')));

// --- Issue 1b: re-accept restores ---
await page.goto(`${FILE}#submissions/AIE-0027`);
await page.waitForTimeout(150);
await page.locator('[data-program-decision="Approve"]').click();
await page.waitForTimeout(120);
await page.locator('#confirm-program-decision').click();
await page.waitForTimeout(250);
const hist2 = await page.locator('.history-row').first().innerText();
console.log('restore history:', hist2.replace(/\n/g,' · ').slice(0,110));
await page.goto(`${FILE}#portal`);
await page.waitForTimeout(150);
console.log('portal progress restored:', await page.locator('.portal-progress strong').innerText());
console.log('cancelled block gone:', await page.locator('.cancelled-block').count() === 0);

// --- Issue 3: webhooks ---
await page.goto(`${FILE}#settings/webhooks`);
await page.waitForTimeout(150);
console.log('webhook endpoints:', await page.locator('tbody tr').count());
await page.locator('[data-test-webhook]').first().click();
await page.waitForTimeout(200);
await page.locator('#add-webhook').click();
await page.waitForTimeout(120);
await page.locator('#save-webhook').click();
await page.waitForTimeout(120);
console.log('bad-url validation:', (await page.locator('#webhook-url-error').innerText()).slice(0,60));
await page.locator('#webhook-url').fill('https://example.com/hooks/marquee');
await page.locator('#save-webhook').click();
await page.waitForTimeout(200);
console.log('endpoint added:', (await page.locator('body').innerText()).includes('example.com/hooks/marquee'));

console.log(errors.length ? `\nERRORS (${errors.length}):\n` + errors.join('\n') : '\nNO JS ERRORS');
await b.close();
