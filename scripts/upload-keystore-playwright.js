#!/usr/bin/env node
/**
 * Reload keystores in Domibus Admin Console using Playwright
 * In Domibus 5.x, keystores are stored in the database and need to be reloaded
 */

import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BLUE_GATEWAY_URL = process.env.BLUE_GATEWAY_URL || 'http://localhost:8180';
const RED_GATEWAY_URL = process.env.RED_GATEWAY_URL || 'http://localhost:8280';
const DOMIBUS_USER = process.env.DOMIBUS_USER || 'admin';
const DOMIBUS_PASS = process.env.DOMIBUS_PASS || '123456';

async function reloadKeystores(gatewayUrl, gatewayName) {
    console.log(`\n=== Reloading Keystores on ${gatewayName} Gateway ===`);
    console.log(`URL: ${gatewayUrl}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const context = await browser.newContext({ ignoreHTTPSErrors: true });
        const page = await context.newPage();
        page.setDefaultTimeout(30000);

        // Navigate to login
        console.log('  Navigating to login page...');
        await page.goto(`${gatewayUrl}/domibus/`, { waitUntil: 'networkidle' });
        await page.waitForTimeout(3000);

        // Login
        console.log('  Logging in...');
        const inputs = await page.locator('input').all();
        if (inputs.length >= 2) {
            await inputs[0].fill(DOMIBUS_USER);
            await inputs[1].fill(DOMIBUS_PASS);
        }
        await page.click('button:has-text("Login")');

        // Wait for dashboard
        console.log('  Waiting for dashboard...');
        await page.waitForSelector('text=Certificates', { timeout: 15000 });

        // Dismiss any dialogs
        try {
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        } catch (e) {}

        // Navigate to Certificates
        console.log('  Navigating to Certificates...');
        await page.click('text=Certificates');
        await page.waitForTimeout(1000);

        // Take screenshot
        await page.screenshot({ path: `/tmp/domibus-${gatewayName.toLowerCase()}-certificates.png` });
        console.log(`  Screenshot: /tmp/domibus-${gatewayName.toLowerCase()}-certificates.png`);

        // Look for Keystore submenu or Reload button
        const pageContent = await page.evaluate(() => document.body.innerText);
        console.log('  Looking for keystore options...');

        // Try clicking on Keystore if it exists as a submenu
        try {
            const keystoreLink = await page.$('text=Keystore');
            if (keystoreLink) {
                await keystoreLink.click();
                await page.waitForTimeout(2000);
                console.log('  Clicked Keystore submenu');
            }
        } catch (e) {}

        // Take another screenshot
        await page.screenshot({ path: `/tmp/domibus-${gatewayName.toLowerCase()}-keystore.png` });

        // Look for Reload button
        const reloadBtn = await page.$('button:has-text("Reload")');
        if (reloadBtn) {
            console.log('  Found Reload button, clicking...');
            await reloadBtn.click();
            await page.waitForTimeout(3000);
            console.log(`  ✓ Keystore reloaded for ${gatewayName} Gateway`);
        } else {
            console.log(`  No Reload button found for ${gatewayName}`);
            // List available buttons
            const buttons = await page.locator('button').allTextContents();
            console.log('  Available buttons:', buttons.filter(b => b.trim()).join(', '));
        }

        return true;
    } catch (error) {
        console.error(`  ✗ Error: ${error.message}`);
        return false;
    } finally {
        await browser.close();
    }
}

async function main() {
    console.log('==========================================');
    console.log('OOTS Keystore Reload via Playwright');
    console.log('==========================================');

    let success = true;

    const blueResult = await reloadKeystores(BLUE_GATEWAY_URL, 'Blue');
    if (!blueResult) success = false;

    const redResult = await reloadKeystores(RED_GATEWAY_URL, 'Red');
    if (!redResult) success = false;

    console.log('\n==========================================');
    console.log(success ? 'Complete!' : 'Some operations failed');
    console.log('==========================================');

    process.exit(success ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
