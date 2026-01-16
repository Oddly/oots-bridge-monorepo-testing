import { chromium } from 'playwright';

const GATEWAY_URL = 'http://localhost:8180';
const DOMIBUS_USER = 'admin';
const DOMIBUS_PASS = 'admin';

async function test() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    page.setDefaultTimeout(30000);

    console.log('Navigating to Domibus...');
    await page.goto(`${GATEWAY_URL}/domibus/`);
    
    // Wait for login form
    await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });
    
    console.log('Filling login form...');
    await page.fill('input[name="username"], input[type="text"]', DOMIBUS_USER);
    await page.fill('input[name="password"], input[type="password"]', DOMIBUS_PASS);
    
    console.log('Clicking login...');
    await page.click('button:has-text("Login")');
    
    // Wait for something to load
    console.log('Waiting 5s for page to load...');
    await page.waitForTimeout(5000);
    
    // Take screenshot
    await page.screenshot({ path: '/tmp/domibus-after-login.png', fullPage: true });
    console.log('Screenshot saved to /tmp/domibus-after-login.png');
    
    // Get page content
    const content = await page.content();
    console.log('Page title:', await page.title());
    
    // Check what's visible
    const visibleText = await page.evaluate(() => document.body.innerText);
    console.log('Visible text (first 1000 chars):');
    console.log(visibleText.substring(0, 1000));
    
    await browser.close();
}

test().catch(err => {
    console.error('Error:', err.message);
    process.exit(1);
});
