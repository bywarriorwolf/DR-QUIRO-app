// Drives the real app (mock Canva) with Playwright and saves screenshots of
// every UI state to artifacts/screenshots/. Run under a display, e.g.
//   xvfb-run -s "-screen 0 1600x1200x24" node scripts/screenshots.mjs
// Requires `npm run build:fast` first and the model in resources/models.
import { mkdirSync, mkdtempSync, copyFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { _electron as electron } from 'playwright';

// SHOTS_DIR: output dir; DRQ_EXECUTABLE: run a packaged build instead of `electron .`
const OUT = path.resolve(process.env.SHOTS_DIR ?? 'artifacts/screenshots');
mkdirSync(OUT, { recursive: true });
const photoDir = process.env.PHOTOS_DIR ?? '/workspace/canva-test/photos';
const base = readdirSync(photoDir).filter((f) => /\.(jpe?g|png)$/i.test(f)).sort().map((f) => path.join(photoDir, f));
if (base.length === 0) throw new Error(`no photos in ${photoDir}`);

const tmp = mkdtempSync(path.join(os.tmpdir(), 'drq-shots-'));
const pickFile = path.join(tmp, 'pick.txt');
const many = (n, tag) =>
  Array.from({ length: n }, (_, i) => {
    const src = base[i % base.length];
    const dst = path.join(tmp, `${tag}-${String(i + 1).padStart(2, '0')}${path.extname(src)}`);
    copyFileSync(src, dst);
    return dst;
  });
const fake = path.join(tmp, 'notes.jpg');
writeFileSync(fake, 'this is not an image');
const setPick = (paths) => writeFileSync(pickFile, paths.join('\n'));

async function launch(extraEnv = {}) {
  const exe = process.env.DRQ_EXECUTABLE;
  const app = await electron.launch({
    ...(exe ? { executablePath: exe, args: ['--no-sandbox'] } : { args: ['.', '--no-sandbox'] }),
    env: {
      ...process.env,
      DRQUIRO_MOCK_CANVA: '1',
      DRQUIRO_MOCK_NO_OPEN: '1',
      DRQUIRO_TEST_PICK_FILE: pickFile,
      DRQUIRO_USER_DATA: mkdtempSync(path.join(tmp, 'ud-')),
      ...extraEnv,
    },
  });
  app.process().stdout.on('data', (d) => process.stdout.write(`[main] ${d}`));
  app.process().stderr.on('data', (d) => process.stderr.write(`[main] ${d}`));
  const page = await app.firstWindow();
  await page.waitForSelector('.app');
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setContentSize(1440, 1024);
  });
  await page.waitForTimeout(400);
  return { app, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, `${name}.png`) });

// ---- Run 1: full Inicial + Comparativo flow ----
{
  const { app, page } = await launch({ DRQUIRO_MOCK_CONNECTED: '0', DRQUIRO_MOCK_IMPORT_DELAY_MS: '120', DRQUIRO_MOCK_DELAY_MS: '150' });
  await shot(page, '01_not_connected');
  await page.click('.connect');
  await page.waitForSelector('.account__name');
  await shot(page, '02_connected_empty');

  await page.click('.create');
  await shot(page, '03_errors_inicial');

  setPick([fake]);
  await page.click('.zone__button');
  await page.waitForSelector('.zone__error-body');
  await shot(page, '04_wrong_format');

  setPick(many(19, 'ini'));
  await page.click('.zone__button');
  await page.waitForSelector('.zone__uploading');
  await page.waitForTimeout(900);
  await shot(page, '05_uploading');
  await page.waitForFunction(() => document.querySelectorAll('.tile img').length === 19, null, { timeout: 60000 });

  await page.fill('input[aria-label="Nombre"]', 'Adam');
  await page.fill('input[aria-label="Apellidos"]', 'Lohmann');
  const inj = page.locator('.field--injury');
  for (const [i, v] of ['Grado 1 > 2-8 semanas', 'Crónico > 6-12 meses', 'No Aplica', 'No Aplica'].entries()) await inj.nth(i).fill(v);
  await page.locator('.date-field').nth(0).click();
  await page.waitForSelector('.picker');
  await shot(page, '06_date_picker');
  await page.locator('.picker__day', { hasText: /^4$/ }).click();
  await page.locator('.picker__text-btn', { hasText: 'OK' }).click();
  await shot(page, '07_filled_inicial');

  // reorder by drag: move tile 1 after tile 3
  const t = page.locator('.tile');
  const a = await t.nth(0).boundingBox();
  const b = await t.nth(2).boundingBox();
  await page.mouse.move(a.x + 40, a.y + 40);
  await page.mouse.down();
  await page.mouse.move(a.x + 60, a.y + 50, { steps: 4 });
  await page.mouse.move(b.x + 80, b.y + 60, { steps: 12 });
  await page.waitForTimeout(250);
  await shot(page, '08_dragging');
  await page.mouse.up();
  await page.waitForTimeout(300);

  setPick(many(3, 'extra'));
  await page.keyboard.press('Control+o'); // 19 + 3 > 21: whole batch refused
  await page.waitForSelector('.tile--error');
  await shot(page, '09_max_photos');

  // Comparativo
  await page.locator('.radio', { hasText: 'Reporte Comparativo' }).click();
  await page.click('.create');
  await shot(page, '10_errors_comparativo');

  setPick(many(19, 'fin'));
  await page.click('.zone__button');
  await page.waitForFunction(() => document.querySelectorAll('.tile img').length === 19, null, { timeout: 60000 });
  await page.locator('.date-field').nth(1).click();
  await page.locator('.picker__day', { hasText: /^21$/ }).click();
  await page.locator('.picker__text-btn', { hasText: 'OK' }).click();
  await shot(page, '11_filled_comparativo_final_tab');

  await page.click('.account__menu');
  await shot(page, '12_menu_open');
  await page.click('.account__menu');

  await page.click('.create');
  await page.waitForSelector('.progress--modal');
  await page.waitForTimeout(2500);
  await shot(page, '13_creating');
  await page.waitForSelector('.modal__check', { timeout: 240000 });
  await shot(page, '14_completed');
  await page.click('.pill-button');
  await page.keyboard.press('Escape');

  await page.click('.account__menu');
  await page.click('.disconnect');
  await page.waitForSelector('.connect');
  await shot(page, '15_disconnected');
  await app.close();
}

// ---- Run 2: max photos + failure modal ----
{
  const { app, page } = await launch({ DRQUIRO_MOCK_FAIL_TOOL: 'perform-editing-operations' });
  setPick(many(20, 'max'));
  await page.click('.zone__button');
  await page.waitForFunction(() => document.querySelectorAll('.tile img').length === 20, null, { timeout: 60000 });
  setPick(many(3, 'over'));
  await page.keyboard.press('Control+o');
  await page.waitForSelector('.tile--error', { timeout: 10000 });
  await shot(page, '16_max_photos_20_plus_3');

  await page.fill('input[aria-label="Nombre"]', 'Adam');
  await page.fill('input[aria-label="Apellidos"]', 'Lohmann');
  const inj = page.locator('.field--injury');
  for (let i = 0; i < 4; i++) await inj.nth(i).fill('No Aplica');
  await page.locator('.date-field').nth(0).click();
  await page.locator('.picker__day', { hasText: /^4$/ }).click();
  await page.locator('.picker__text-btn', { hasText: 'OK' }).click();
  await page.click('.create');
  await page.waitForSelector('.modal__title--error', { timeout: 240000 });
  await shot(page, '17_failure');
  await app.close();
}
console.log(`screenshots in ${OUT}`);
