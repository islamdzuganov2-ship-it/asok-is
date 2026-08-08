// Временный QA-скрипт: снимает экраны под авторизацией и меряет переполнение в НАСТОЯЩЕМ
// вьюпорте. Использует ту же patchright, что и скилл browser-automation (у скилла на Windows
// не работает --script: он склеивает cwd + путь и импортирует «C:\...» без file://).
import { createRequire } from 'node:module';
import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

function resolveChromium() {
  const base = join(process.env.USERPROFILE || '', '.vscode', 'extensions');
  const roots = [];
  if (existsSync(base)) {
    const dirs = readdirSync(base).filter((d) => d.startsWith('danielsanmedium.dscodegpt-')).sort();
    const newest = dirs[dirs.length - 1];
    if (newest) roots.push(join(base, newest, 'standalone') + '/');
  }
  roots.push(process.cwd() + '/');
  for (const root of roots) {
    try {
      const mod = createRequire(root)('patchright');
      const chromium = mod?.chromium ?? mod?.default?.chromium;
      if (chromium) return chromium;
    } catch { /* следующий корень */ }
  }
  throw new Error('patchright не найден');
}

const BASE = 'http://localhost:3106';
const OUT = process.argv[2] || '.';

const chromium = resolveChromium();
// channel:'chromium' — как в скилле: headless-shell отдельно не установлен.
const browser = await chromium.launch({
  headless: true,
  channel: 'chromium',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
// Авторизация до монтирования приложения — иначе RequireAuth уводит на /login.
await ctx.addInitScript(() => {
  localStorage.setItem('token', 'demo-qa');
  localStorage.setItem('role', 'QUALITY_MANAGER');
  localStorage.setItem('full_name', 'Менеджер по качеству');
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (t.includes('CORS') || t.includes('ERR_FAILED') || t.includes('Failed to load resource')) return; // бэкенд не на этом порту
  consoleErrors.push(t.slice(0, 160));
});

const routes = [
  ['analytics', '/dashboard/analytics', '.ant-card'],
  ['incidents', '/dashboard/incidents', '.ant-card'],
  ['manager', '/dashboard/manager', '[data-char]'],
];
const widths = [1440, 1024, 768, 375];
const report = { overflow: [], shots: [], consoleErrors };

for (const [name, route, waitSel] of routes) {
  for (const w of widths) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.goto(BASE + route, { waitUntil: 'domcontentloaded' });
    try { await page.waitForSelector(waitSel, { timeout: 12000 }); } catch { /* пустой экран */ }
    await page.waitForTimeout(1400);

    const res = await page.evaluate(() => {
      const doc = document.documentElement;
      const overflowPx = doc.scrollWidth - doc.clientWidth;
      const culprits = [];
      if (overflowPx > 1) {
        document.querySelectorAll('body *').forEach((el) => {
          const r = el.getBoundingClientRect();
          if (r.width < 2 || r.right <= doc.clientWidth + 1) return;
          let n = el.parentElement, scrollable = false;
          while (n) {
            const cs = getComputedStyle(n);
            if (cs.overflowX === 'auto' || cs.overflowX === 'scroll') { scrollable = true; break; }
            n = n.parentElement;
          }
          if (!scrollable) culprits.push(`${el.tagName}.${String(el.className || '').split(' ')[0]} → ${Math.round(r.right)}px «${(el.textContent || '').trim().slice(0, 24)}»`);
        });
      }
      return { overflowPx, culprits: [...new Set(culprits)].slice(0, 3) };
    });
    if (res.overflowPx > 1) report.overflow.push({ screen: name, width: w, ...res });

    if (w === 1440) {
      const p = `${OUT}/${name}.png`;
      await page.screenshot({ path: p });
      report.shots.push(p);
    }
  }
}

await browser.close();
console.log(JSON.stringify(report, null, 1));
