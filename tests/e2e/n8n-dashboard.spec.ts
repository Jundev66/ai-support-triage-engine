import { test, expect } from '@playwright/test';

test.describe('n8n Dashboard E2E Readiness', () => {

  test('UI: should load n8n web interface successfully', async ({ page }) => {
    // Navigates to the local n8n instance
    const response = await page.goto('/', { waitUntil: 'domcontentloaded' });
    expect(response?.status()).toBeLessThan(400);

    // Verify page title or presence of n8n app container
    await expect(page).toHaveTitle(/n8n/i);
  });

});
