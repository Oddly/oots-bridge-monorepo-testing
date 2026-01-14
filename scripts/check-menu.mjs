import { chromium } from 'playwright';

const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox']
});
const context = await browser.newContext({ ignoreHTTPSErrors: true });
const page = await context.newPage();
page.setDefaultTimeout(60000);

console.log('Navigating to Domibus...');
await page.goto('http://localhost:8180/domibus/', { waitUntil: 'networkidle' });
await page.waitForTimeout(3000);

// Login - use placeholder text
console.log('Logging in...');
await page.waitForSelector('input', { timeout: 30000 });

// Get input fields by their index (first is username, second is password)
const inputs = await page.locator('input').all();
console.log(`Found ${inputs.length} inputs`);

if (inputs.length >= 2) {
    await inputs[0].fill('admin');
    await inputs[1].fill('123456');
    console.log('Filled credentials');
}

await page.click('button:has-text("Login")');
console.log('Clicked login');

// Wait for dashboard
console.log('Waiting for dashboard...');
await page.waitForTimeout(5000);

// Dismiss dialogs
try {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
} catch (e) {}

// Take screenshot
await page.screenshot({ path: '/tmp/domibus-dashboard.png', fullPage: true });
console.log('Dashboard screenshot: /tmp/domibus-dashboard.png');

// Get all visible text
const pageText = await page.evaluate(() => document.body.innerText);
console.log('\n=== Page Content ===');
const lines = pageText.split('\n').filter(l => l.trim().length > 0 && l.trim().length < 50);
console.log(lines.slice(0, 40).join('\n'));

await browser.close();
