// Headless browser E2E of the main UI flows (uses the demo model). Fresh data dir required.
// Usage: npm i -D playwright-core && BASE_URL=http://localhost:8787 OWNER_PASSWORD=... CHROME_PATH=... node scripts/e2e-ui.mjs
import { chromium } from 'playwright-core';
const base = process.env.BASE_URL ?? 'http://localhost:8787';
const shots = process.env.SHOTS_DIR ?? 'docs/screenshots';
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: 1360, height: 860 } });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
const log = (...a) => console.log('✓', ...a);

await page.goto(base);
await page.screenshot({ path: `${shots}/01-login.png` });
await page.fill('input[type=password]', 'wrong');
await page.click('button:has-text("Sign in")');
await page.waitForSelector('.alert.error');
log('wrong password rejected:', await page.textContent('.alert.error'));
await page.fill('input[type=password]', process.env.OWNER_PASSWORD ?? 'demo123');
await page.click('button:has-text("Sign in")');
await page.waitForSelector('text=Welcome to BotClone');
log('logged in, welcome screen');

await page.click('button:has-text("Create your first bot")');
await page.fill('input[placeholder="e.g. Research Buddy"]', 'Research Buddy');
await page.fill('textarea', 'You are a patient tutor who explains in simple Hinglish.');
await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/02-new-bot-modal.png` });
await page.click('button:has-text("Create bot")');
await page.waitForSelector('.chat-header h1:has-text("Research Buddy")', { timeout: 15000 });
log('bot created and chat opened');
await page.screenshot({ path: `${shots}/03-empty-chat.png` });

await page.fill('.composer textarea', 'remember that I prefer TypeScript and short answers');
await page.keyboard.press('Enter');
await page.waitForSelector('.tool-card:not(.running)');
await page.waitForFunction(() => !document.querySelector('.send-btn.stop'));
log('memory tool card rendered:', (await page.textContent('.tool-card .tool-label')));
await page.fill('.composer textarea', 'run uname -s && echo hello > notes.txt && ls');
await page.keyboard.press('Enter');
await page.waitForFunction(() => document.querySelectorAll('.tool-card:not(.running)').length >= 2 && !document.querySelector('.send-btn.stop'));
await page.click('.tool-card >> nth=1 >> .tool-head');
log('shell output:', (await page.textContent('.tool-output')).replace(/\n/g, ' | '));
await page.click('button:has-text("Memory")');
await page.waitForSelector('.memory-item');
log('memory panel items:', await page.locator('.memory-item').count());
await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/04-chat-tools-memory.png` });

// second bot: isolation
await page.click('button:has-text("New bot")');
await page.fill('input[placeholder="e.g. Research Buddy"]', 'Coder');
await page.click('button:has-text("Create bot")');
await page.waitForSelector('.chat-header h1:has-text("Coder")', { timeout: 15000 });
const turnsB = await page.locator('.turn').count();
log('second bot turns (expect 0):', turnsB);
await page.fill('.composer textarea', 'what do you remember?');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.querySelector('.send-btn.stop') && document.querySelectorAll('.tool-card:not(.running)').length >= 1);
const txt = await page.locator('.turn.assistant .markdown').last().textContent();
log('Coder recall reply:', txt);
if (/TypeScript/.test(txt)) throw new Error('ISOLATION BROKEN');

// screen intent in demo mode
await page.fill('.composer textarea', 'apna computer dikhao');
await page.keyboard.press('Enter');
await page.waitForFunction(() => !document.querySelector('.send-btn.stop'));
log('screen intent reply:', await page.locator('.turn.assistant .markdown').last().textContent());

// rename via sidebar
await page.hover('.bot-item.active');
await page.click('.bot-item.active button[aria-label="Rename"]');
await page.fill('.inline-input', 'Coder Pro');
await page.keyboard.press('Enter');
await page.waitForSelector('.chat-header h1:has-text("Coder Pro")');
log('renamed');

// settings modal
await page.click('button[aria-label="Bot settings"]');
await page.waitForSelector('text=Bot settings');
await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/05-settings-voice.png` });
await page.click('.modal button:has-text("Cancel")');

// voice toggle persists
await page.click('.chip-btn:has-text("Voice")');
await page.waitForTimeout(400);
const r = await page.evaluate(async () => (await (await fetch('/api/bots')).json()).bots.map((b) => [b.name, b.voice.enabled]));
log('voice settings per bot:', JSON.stringify(r));

// switch back to first bot: history intact
await page.click('.bot-item:has-text("Research Buddy")');
await page.waitForSelector('.chat-header h1:has-text("Research Buddy")');
await page.waitForSelector('.turn');
log('Research Buddy turns after switching back:', await page.locator('.turn').count());
await page.waitForTimeout(600); await page.screenshot({ path: `${shots}/06-two-bots.png` });

// delete second bot
await page.hover('.bot-item:has-text("Coder Pro")');
await page.click('.bot-item:has-text("Coder Pro") button[aria-label="Delete"]');
await page.click('.modal button:has-text("Delete")');
await page.waitForFunction(() => !document.body.innerText.includes('Coder Pro'));
log('deleted bot');

// mobile
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/07-mobile.png` });
await page.click('button[aria-label="Open menu"]');
await page.waitForTimeout(300);
await page.screenshot({ path: `${shots}/08-mobile-menu.png` });

console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
