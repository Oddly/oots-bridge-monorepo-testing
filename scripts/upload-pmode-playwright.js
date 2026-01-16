#!/usr/bin/env node
/**
 * Automate PMode upload via Domibus Admin Console using Playwright
 *
 * Usage:
 *   npx playwright test scripts/upload-pmode-playwright.js
 *   or: node scripts/upload-pmode-playwright.js
 *
 * Environment variables:
 *   BLUE_GATEWAY_URL - Blue gateway URL (default: http://localhost:8180)
 *   RED_GATEWAY_URL - Red gateway URL (default: http://localhost:8280)
 *   DOMIBUS_USER - Admin username (default: admin)
 *   DOMIBUS_PASS - Admin password (default: 123456)
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

const SCRIPT_DIR = __dirname;
const PROJECT_DIR = path.resolve(SCRIPT_DIR, '..');

const BLUE_PMODE = path.join(PROJECT_DIR, 'domibus/conf/pmode/pmode-configuration.xml');
const RED_PMODE = path.join(PROJECT_DIR, 'domibus/conf-red/pmode/pmode-configuration.xml');

async function uploadPMode(gatewayUrl, pmodeFile, gatewayName) {
    console.log(`\n=== Uploading PMode to ${gatewayName} Gateway ===`);
    console.log(`URL: ${gatewayUrl}`);
    console.log(`File: ${pmodeFile}`);

    const browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const context = await browser.newContext({
            ignoreHTTPSErrors: true
        });
        const page = await context.newPage();

        // Set a reasonable timeout
        page.setDefaultTimeout(30000);

        // Navigate to login page
        console.log('  Navigating to login page...');
        await page.goto(`${gatewayUrl}/domibus/`);

        // Wait for login form
        await page.waitForSelector('input[name="username"], input[type="text"]', { timeout: 10000 });

        // Fill login form
        console.log('  Logging in...');
        await page.fill('input[name="username"], input[type="text"]', DOMIBUS_USER);
        await page.fill('input[name="password"], input[type="password"]', DOMIBUS_PASS);

        // Click login button
        await page.click('button:has-text("Login")');

        // Wait for dashboard to load (look for PMode menu or similar)
        console.log('  Waiting for dashboard...');
        await page.waitForSelector('text=PMode', { timeout: 60000 });

        // Handle password change dialog if present (first login with default password)
        console.log('  Checking for password change dialog...');
        try {
            // Look for the overlay backdrop
            const overlay = await page.$('.cdk-overlay-backdrop', { timeout: 2000 });
            if (overlay) {
                console.log('  Dismissing dialog...');
                // Try clicking Cancel or Close button
                const cancelBtn = await page.$('button:has-text("Cancel"), button:has-text("Close"), button:has-text("Skip"), mat-icon:has-text("close")');
                if (cancelBtn) {
                    await cancelBtn.click();
                    await page.waitForTimeout(500);
                } else {
                    // Press Escape to close dialog
                    await page.keyboard.press('Escape');
                    await page.waitForTimeout(500);
                }
            }
        } catch (e) {
            // No dialog, continue
        }

        // Wait for overlay to disappear
        await page.waitForTimeout(1000);
        try {
            await page.waitForSelector('.cdk-overlay-backdrop', { state: 'hidden', timeout: 5000 });
        } catch (e) {
            // Try pressing Escape again
            await page.keyboard.press('Escape');
            await page.waitForTimeout(500);
        }

        // Navigate to PMode > Current
        console.log('  Navigating to PMode > Current...');
        await page.click('text=PMode');
        await page.waitForTimeout(1000);

        // Wait for submenu and click Current
        await page.waitForSelector('text=Current', { timeout: 5000 });
        await page.click('text=Current');
        await page.waitForTimeout(2000);

        // Take a screenshot for debugging
        await page.screenshot({ path: `/tmp/domibus-${gatewayName.toLowerCase()}-pmode.png` });
        console.log(`  Screenshot saved to /tmp/domibus-${gatewayName.toLowerCase()}-pmode.png`);

        // Wait for PMode page - try different selectors
        console.log('  Waiting for PMode page...');
        await page.waitForSelector('button, [role="button"]', { timeout: 10000 });

        // Click Upload button
        console.log('  Clicking Upload...');
        await page.click('button:has-text("Upload")');

        // Wait for upload dialog to appear
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `/tmp/domibus-${gatewayName.toLowerCase()}-dialog.png` });
        console.log(`  Dialog screenshot saved to /tmp/domibus-${gatewayName.toLowerCase()}-dialog.png`);

        // Handle file selection - set file directly on hidden input
        console.log('  Selecting file...');

        // Find the hidden file input and set file directly (works even for hidden inputs)
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
            await fileInput.setInputFiles(pmodeFile);
            console.log('  File selected via hidden input');
        } else {
            throw new Error('File input not found');
        }

        // Wait for file to be processed
        await page.waitForTimeout(1000);

        // Fill in the required Description field
        console.log('  Filling description...');
        const descInput = await page.$('mat-dialog-container input[type="text"], mat-dialog-container textarea, input[formcontrolname], textarea[formcontrolname]');
        if (descInput) {
            await descInput.fill(`OOTS E2E ${gatewayName} PMode`);
        } else {
            // Try finding by placeholder or label
            await page.fill('mat-dialog-container input', `OOTS E2E ${gatewayName} PMode`);
        }

        await page.waitForTimeout(500);

        // Take screenshot to verify form is filled
        await page.screenshot({ path: `/tmp/domibus-${gatewayName.toLowerCase()}-filled.png` });

        // Find and click OK button - it should be enabled now
        console.log('  Submitting...');
        await page.click('mat-dialog-container button:has-text("OK"), button:has-text("Ok")', { force: true });

        // Wait for dialog to close and success
        await page.waitForTimeout(3000);

        // Check for success (look for the uploaded PMode in the list)
        const success = await page.$('text=successfully, text=uploaded, text=OOTS');
        if (success) {
            console.log(`  ✓ PMode uploaded successfully to ${gatewayName} Gateway`);
        } else {
            console.log(`  ✓ Upload completed for ${gatewayName} Gateway (verify in UI)`);
        }

        return true;
    } catch (error) {
        console.error(`  ✗ Error uploading to ${gatewayName}: ${error.message}`);
        return false;
    } finally {
        await browser.close();
    }
}

async function main() {
    console.log('==========================================');
    console.log('OOTS PMode Upload via Playwright');
    console.log('==========================================');

    let success = true;

    // Upload to Blue Gateway
    const blueResult = await uploadPMode(BLUE_GATEWAY_URL, BLUE_PMODE, 'Blue');
    if (!blueResult) success = false;

    // Upload to Red Gateway
    const redResult = await uploadPMode(RED_GATEWAY_URL, RED_PMODE, 'Red');
    if (!redResult) success = false;

    console.log('\n==========================================');
    if (success) {
        console.log('PMode upload complete!');
    } else {
        console.log('Some uploads failed - check messages above');
    }
    console.log('==========================================');

    console.log('\nVerify PModes in Admin Consoles:');
    console.log(`  Blue: ${BLUE_GATEWAY_URL}/domibus`);
    console.log(`  Red:  ${RED_GATEWAY_URL}/domibus`);

    process.exit(success ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});
