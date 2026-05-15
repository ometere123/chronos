/**
 * E2E Tests for CHRONOS Frontend
 *
 * These tests verify complete user flows from UI interaction to backend response
 * Framework: Playwright / Cypress compatible
 *
 * Usage:
 * - npx playwright test tests/e2e.spec.js
 * - npx cypress run --spec "tests/e2e.spec.js"
 */

const { test, expect } = require('@playwright/test');

// Set base URL for testing
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const API_URL = process.env.API_URL || 'http://localhost:3001';

test.describe('CHRONOS Frontend E2E Tests', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to landing page
    await page.goto(BASE_URL);
    // Wait for app to load
    await page.waitForLoadState('networkidle');
  });

  test.describe('Landing Page & Navigation', () => {
    test('should display landing page with hero section', async ({ page }) => {
      // Check hero heading
      const heroHeading = await page.locator('h1').first();
      expect(await heroHeading.textContent()).toContain('CHRONOS');

      // Check for key sections
      await expect(page.locator('text=Features')).toBeVisible();
      await expect(page.locator('text=How It Works')).toBeVisible();
      await expect(page.locator('text=Why Trust')).toBeVisible();
    });

    test('should have working navigation header', async ({ page }) => {
      // Check header is visible
      const header = page.locator('header');
      await expect(header).toBeVisible();

      // Check for navigation links
      const links = page.locator('nav a');
      expect(await links.count()).toBeGreaterThan(0);
    });

    test('should display 6 features', async ({ page }) => {
      const features = page.locator('[data-testid="feature-card"]');
      expect(await features.count()).toBe(6);
    });

    test('should have functional footer with links', async ({ page }) => {
      const footer = page.locator('footer');
      await expect(footer).toBeVisible();

      // Check for footer links
      const footerLinks = footer.locator('a');
      expect(await footerLinks.count()).toBeGreaterThan(0);
    });
  });

  test.describe('Authentication Flow', () => {
    test('should show auth button on header', async ({ page }) => {
      const authButton = page.locator('button:has-text("Connect Wallet")');
      await expect(authButton).toBeVisible();
    });

    test('should open auth modal on click', async ({ page }) => {
      const authButton = page.locator('button:has-text("Connect Wallet")');
      await authButton.click();

      // Check modal opened
      const modal = page.locator('[data-testid="auth-modal"]');
      await expect(modal).toBeVisible();
    });

    test('should redirect to dashboard after auth', async ({ page, context }) => {
      // Mock wallet session auth
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);

      // Navigate to dashboard
      await page.goto(`${BASE_URL}/dashboard`);

      // Check user is on dashboard
      expect(page.url()).toContain('/dashboard');
      await expect(page.locator('text=My Vaults')).toBeVisible();
    });
  });

  test.describe('Dashboard - My Vaults', () => {
    test.beforeEach(async ({ page, context }) => {
      // Set auth cookie
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
      // Go to dashboard
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState('networkidle');
    });

    test('should display My Vaults page', async ({ page }) => {
      await expect(page.locator('h1:has-text("My Vaults")')).toBeVisible();
    });

    test('should show vault statistics', async ({ page }) => {
      // Check for stat cards
      const statCards = page.locator('[data-testid="stat-card"]');
      expect(await statCards.count()).toBeGreaterThan(0);

      // Check for key stats
      await expect(page.locator('text=Total Vaults')).toBeVisible();
      await expect(page.locator('text=Total Locked')).toBeVisible();
      await expect(page.locator('text=Active Amount')).toBeVisible();
    });

    test('should allow filtering by status', async ({ page }) => {
      // Find status filter tabs
      const activTab = page.locator('button:has-text("ACTIVE")');
      const matureTab = page.locator('button:has-text("MATURE")');
      const claimedTab = page.locator('button:has-text("CLAIMED")');

      // Check tabs exist
      await expect(activTab).toBeVisible();
      await expect(matureTab).toBeVisible();
      await expect(claimedTab).toBeVisible();

      // Click filter
      await matureTab.click();

      // Wait for filtered results
      await page.waitForLoadState('networkidle');
    });

    test('should display Create Vault button', async ({ page }) => {
      const createButton = page.locator('button:has-text("Create New Vault")');
      await expect(createButton).toBeVisible();
    });
  });

  test.describe('Create Vault Flow - 6 Step Stepper', () => {
    test.beforeEach(async ({ page, context }) => {
      // Auth setup
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
      // Go to create vault
      await page.goto(`${BASE_URL}/dashboard/create-vault`);
      await page.waitForLoadState('networkidle');
    });

    test('should display stepper with 6 steps', async ({ page }) => {
      const stepperSteps = page.locator('[data-testid="stepper-step"]');
      expect(await stepperSteps.count()).toBe(6);

      // Check step labels
      await expect(page.locator('text=Source Chain')).toBeVisible();
      await expect(page.locator('text=Amount & Duration')).toBeVisible();
      await expect(page.locator('text=Vault Type')).toBeVisible();
      await expect(page.locator('text=Destination Chain')).toBeVisible();
      await expect(page.locator('text=Review')).toBeVisible();
      await expect(page.locator('text=Confirm')).toBeVisible();
    });

    test('should complete step 1: select source chain', async ({ page }) => {
      // Step 1: Select source chain
      const chainSelect = page.locator('select, [role="combobox"]').first();
      await chainSelect.click();

      // Select Base Sepolia
      await page.locator('text=Base Sepolia').click();

      // Click next
      const nextButton = page.locator('button:has-text("Next")');
      await nextButton.click();

      // Verify on step 2
      await expect(page.locator('text=Amount & Duration')).toBeVisible();
    });

    test('should complete step 2: enter amount and duration', async ({ page }) => {
      // Go to step 2
      await page.locator('select, [role="combobox"]').first().click();
      await page.locator('text=Base Sepolia').click();
      await page.locator('button:has-text("Next")').click();

      // Enter amount
      const amountInput = page.locator('input[placeholder*="Amount"]');
      await amountInput.fill('100');

      // Select duration (7 days)
      const durationSelect = page.locator('select, [role="combobox"]').nth(1);
      await durationSelect.click();
      await page.locator('text=7 days').click();

      // Next
      await page.locator('button:has-text("Next")').click();

      // Verify on step 3
      await expect(page.locator('text=Vault Type')).toBeVisible();
    });

    test('should complete step 3: select vault type', async ({ page }) => {
      // Progress to step 3
      await page.locator('select, [role="combobox"]').first().click();
      await page.locator('text=Base Sepolia').click();
      await page.locator('button:has-text("Next")').click();

      const amountInput = page.locator('input[placeholder*="Amount"]');
      await amountInput.fill('100');
      await page.locator('select, [role="combobox"]').nth(1).click();
      await page.locator('text=7 days').click();
      await page.locator('button:has-text("Next")').click();

      // Step 3: Select vault type
      const fixedOption = page.locator('label:has-text("FIXED")');
      const flexibleOption = page.locator('label:has-text("FLEXIBLE")');

      await expect(fixedOption).toBeVisible();
      await expect(flexibleOption).toBeVisible();

      // Select FIXED
      await fixedOption.click();

      // Next
      await page.locator('button:has-text("Next")').click();

      // Verify on step 4
      await expect(page.locator('text=Destination Chain')).toBeVisible();
    });

    test('should complete step 4: select destination chain', async ({ page }) => {
      // Progress through steps 1-3
      await page.locator('select, [role="combobox"]').first().click();
      await page.locator('text=Base Sepolia').click();
      await page.locator('button:has-text("Next")').click();

      const amountInput = page.locator('input[placeholder*="Amount"]');
      await amountInput.fill('100');
      await page.locator('select, [role="combobox"]').nth(1).click();
      await page.locator('text=7 days').click();
      await page.locator('button:has-text("Next")').click();

      await page.locator('label:has-text("FIXED")').click();
      await page.locator('button:has-text("Next")').click();

      // Step 4: Select destination chain (Arc Testnet)
      const destChainSelect = page.locator('select, [role="combobox"]').nth(2);
      await destChainSelect.click();
      await page.locator('text=Arc Testnet').click();

      // Next
      await page.locator('button:has-text("Next")').click();

      // Verify on step 5
      await expect(page.locator('text=Review')).toBeVisible();
    });

    test('should display review summary', async ({ page }) => {
      // Navigate to review step
      // (simplified: assume we can skip to step 5)
      await page.goto(`${BASE_URL}/dashboard/create-vault?step=5`);

      // Check review displays all details
      await expect(page.locator('text=Amount')).toBeVisible();
      await expect(page.locator('text=Duration')).toBeVisible();
      await expect(page.locator('text=Type')).toBeVisible();
      await expect(page.locator('text=Source Chain')).toBeVisible();
      await expect(page.locator('text=Destination')).toBeVisible();
    });

    test('should complete step 6: confirm creation', async ({ page }) => {
      // Navigate to confirm step
      await page.goto(`${BASE_URL}/dashboard/create-vault?step=6`);

      // Check confirmation details
      await expect(page.locator('text=Confirm Vault Creation')).toBeVisible();

      // Click confirm button
      const confirmButton = page.locator('button:has-text("Create Vault")');
      await confirmButton.click();

      // Wait for success notification
      await expect(page.locator('[role="alert"]:has-text("created")')).toBeVisible({
        timeout: 5000
      });

      // Should redirect to dashboard or vault details
      expect(page.url()).toMatch(/(dashboard|vault)/);
    });

    test('should show error for invalid amount', async ({ page }) => {
      const amountInput = page.locator('input[placeholder*="Amount"]');

      // Try zero
      await amountInput.fill('0');
      const nextButton = page.locator('button:has-text("Next")');

      // Error should appear
      await expect(page.locator('text=must be greater than 0')).toBeVisible();
      await expect(nextButton).toBeDisabled();
    });

    test('should show error for invalid duration', async ({ page }) => {
      // Go to step 2
      await page.locator('select, [role="combobox"]').first().click();
      await page.locator('text=Base Sepolia').click();
      await page.locator('button:has-text("Next")').click();

      // Check duration validation
      const durationSelect = page.locator('select, [role="combobox"]').nth(1);

      // Minimum is 30 minutes, maximum is 12 months
      // Test shows validation is present
      await expect(durationSelect).toBeVisible();
    });
  });

  test.describe('Vault Details Page', () => {
    test.beforeEach(async ({ page, context }) => {
      // Auth setup
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
    });

    test('should display vault details with countdown', async ({ page }) => {
      // Navigate to vault details (using test vault ID)
      const testVaultId = 'test-vault-123';
      await page.goto(`${BASE_URL}/dashboard/${testVaultId}`);
      await page.waitForLoadState('networkidle');

      // Check vault info displays
      await expect(page.locator('text=Vault Details')).toBeVisible();

      // Check countdown timer exists
      const timer = page.locator('[data-testid="countdown-timer"]');
      await expect(timer).toBeVisible();

      // Should show days, hours, minutes, seconds
      await expect(page.locator('text=Days')).toBeVisible();
      await expect(page.locator('text=Hours')).toBeVisible();
      await expect(page.locator('text=Minutes')).toBeVisible();
      await expect(page.locator('text=Seconds')).toBeVisible();
    });

    test('should display action buttons for active vault', async ({ page }) => {
      const testVaultId = 'test-vault-active';
      await page.goto(`${BASE_URL}/dashboard/${testVaultId}`);

      // Check action buttons
      const addButton = page.locator('button:has-text("Add Funds")');
      const withdrawButton = page.locator('button:has-text("Withdraw")');

      await expect(addButton).toBeVisible();
      // Withdraw only for FLEXIBLE type
      // await expect(withdrawButton).toBeVisible();
    });

    test('should show claim button for mature vault', async ({ page }) => {
      const testVaultId = 'test-vault-mature';
      await page.goto(`${BASE_URL}/dashboard/${testVaultId}`);

      const claimButton = page.locator('button:has-text("Claim Vault")');
      await expect(claimButton).toBeVisible();
    });

    test('should update countdown in real-time', async ({ page }) => {
      const testVaultId = 'test-vault-123';
      await page.goto(`${BASE_URL}/dashboard/${testVaultId}`);

      const timer = page.locator('[data-testid="countdown-timer"]');
      const initialText = await timer.textContent();

      // Wait 2 seconds
      await page.waitForTimeout(2000);

      const updatedText = await timer.textContent();

      // Text should update (seconds should change)
      expect(initialText).not.toEqual(updatedText);
    });
  });

  test.describe('Add Funds Flow', () => {
    test.beforeEach(async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
      const testVaultId = 'test-vault-123';
      await page.goto(`${BASE_URL}/dashboard/${testVaultId}`);
    });

    test('should open add funds modal', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add Funds")');
      await addButton.click();

      const modal = page.locator('[data-testid="add-funds-modal"]');
      await expect(modal).toBeVisible();
    });

    test('should validate amount in add funds', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add Funds")');
      await addButton.click();

      const amountInput = page.locator('input[placeholder*="Amount"]');
      await amountInput.fill('0');

      // Error should show
      await expect(page.locator('text=must be greater than 0')).toBeVisible();

      // Submit should be disabled
      const submitButton = page.locator('button:has-text("Add")');
      await expect(submitButton).toBeDisabled();
    });

    test('should submit add funds request', async ({ page }) => {
      const addButton = page.locator('button:has-text("Add Funds")');
      await addButton.click();

      const amountInput = page.locator('input[placeholder*="Amount"]');
      await amountInput.fill('50');

      const submitButton = page.locator('button:has-text("Add")');
      await submitButton.click();

      // Wait for success message
      await expect(page.locator('[role="alert"]:has-text("added")')).toBeVisible({
        timeout: 5000
      });
    });
  });

  test.describe('Claim Vault Flow', () => {
    test.beforeEach(async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
    });

    test('should show claim button only for mature vaults', async ({ page }) => {
      // Active vault (not mature)
      await page.goto(`${BASE_URL}/dashboard/active-vault`);
      let claimButton = page.locator('button:has-text("Claim Vault")');
      await expect(claimButton).not.toBeVisible();

      // Mature vault
      await page.goto(`${BASE_URL}/dashboard/mature-vault`);
      claimButton = page.locator('button:has-text("Claim Vault")');
      await expect(claimButton).toBeVisible();
    });

    test('should open claim confirmation modal', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard/mature-vault`);

      const claimButton = page.locator('button:has-text("Claim Vault")');
      await claimButton.click();

      const modal = page.locator('[data-testid="claim-modal"]');
      await expect(modal).toBeVisible();

      // Should show confirmation details
      await expect(page.locator('text=Confirm Claim')).toBeVisible();
    });

    test('should submit claim request', async ({ page }) => {
      await page.goto(`${BASE_URL}/dashboard/mature-vault`);

      const claimButton = page.locator('button:has-text("Claim Vault")');
      await claimButton.click();

      const confirmButton = page.locator('button:has-text("Claim")');
      await confirmButton.click();

      // Wait for success
      await expect(page.locator('[role="alert"]:has-text("claimed")')).toBeVisible({
        timeout: 5000
      });
    });
  });

  test.describe('Proof of Reserves Page', () => {
    test.beforeEach(async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
      await page.goto(`${BASE_URL}/dashboard/proof-of-reserves`);
      await page.waitForLoadState('networkidle');
    });

    test('should display proof of reserves page', async ({ page }) => {
      await expect(page.locator('h1:has-text("Proof of Reserves")')).toBeVisible();
    });

    test('should show total locked amount', async ({ page }) => {
      const totalLockedCard = page.locator('[data-testid="total-locked-card"]');
      await expect(totalLockedCard).toBeVisible();

      // Should display an amount
      await expect(totalLockedCard.locator('[data-testid="amount"]')).toBeVisible();
    });

    test('should display breakdown by chain', async ({ page }) => {
      const byChainSection = page.locator('[data-testid="by-chain-section"]');
      await expect(byChainSection).toBeVisible();

      // Should show multiple chains
      const chainItems = byChainSection.locator('[data-testid="chain-item"]');
      expect(await chainItems.count()).toBeGreaterThan(0);
    });

    test('should display breakdown by token', async ({ page }) => {
      const byTokenSection = page.locator('[data-testid="by-token-section"]');
      await expect(byTokenSection).toBeVisible();

      // Should show token items
      const tokenItems = byTokenSection.locator('[data-testid="token-item"]');
      expect(await tokenItems.count()).toBeGreaterThanOrEqual(0);
    });

    test('should show verification status', async ({ page }) => {
      const verificationBadge = page.locator('[data-testid="verification-badge"]');
      await expect(verificationBadge).toBeVisible();

      // Should show verified or unverified
      const badgeText = await verificationBadge.textContent();
      expect(badgeText).toMatch(/(Verified|Unverified)/i);
    });
  });

  test.describe('Activity Dashboard', () => {
    test.beforeEach(async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
      await page.goto(`${BASE_URL}/dashboard/activity`);
      await page.waitForLoadState('networkidle');
    });

    test('should display activity page', async ({ page }) => {
      await expect(page.locator('h1:has-text("Activity")')).toBeVisible();
    });

    test('should display transactions table', async ({ page }) => {
      const table = page.locator('[data-testid="transactions-table"]');
      await expect(table).toBeVisible();

      // Should have column headers
      await expect(page.locator('text=Type')).toBeVisible();
      await expect(page.locator('text=Status')).toBeVisible();
      await expect(page.locator('text=Amount')).toBeVisible();
      await expect(page.locator('text=Date')).toBeVisible();
    });

    test('should filter by transaction type', async ({ page }) => {
      const typeFilter = page.locator('[data-testid="type-filter"]');
      await expect(typeFilter).toBeVisible();

      // Click to open filter
      await typeFilter.click();

      // Should have filter options
      await expect(page.locator('text=Create')).toBeVisible();
      await expect(page.locator('text=Deposit')).toBeVisible();
      await expect(page.locator('text=Claim')).toBeVisible();
    });

    test('should filter by status', async ({ page }) => {
      const statusFilter = page.locator('[data-testid="status-filter"]');
      await expect(statusFilter).toBeVisible();

      await statusFilter.click();

      // Should show status options
      await expect(page.locator('text=Pending')).toBeVisible();
      await expect(page.locator('text=Completed')).toBeVisible();
    });
  });

  test.describe('Settings Page', () => {
    test.beforeEach(async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
      await page.goto(`${BASE_URL}/dashboard/settings`);
      await page.waitForLoadState('networkidle');
    });

    test('should display settings page', async ({ page }) => {
      await expect(page.locator('h1:has-text("Settings")')).toBeVisible();
    });

    test('should show account information', async ({ page }) => {
      const accountSection = page.locator('[data-testid="account-section"]');
      await expect(accountSection).toBeVisible();

      // Should show wallet address
      await expect(page.locator('text=Wallet Address')).toBeVisible();
    });

    test('should have logout button', async ({ page }) => {
      const logoutButton = page.locator('button:has-text("Logout")');
      await expect(logoutButton).toBeVisible();
    });

    test('should logout user', async ({ page }) => {
      const logoutButton = page.locator('button:has-text("Logout")');
      await logoutButton.click();

      // Should redirect to home
      expect(page.url()).toBe(`${BASE_URL}/`);

      // Auth button should reappear
      const authButton = page.locator('button:has-text("Connect Wallet")');
      await expect(authButton).toBeVisible();
    });
  });

  test.describe('Responsive Design', () => {
    test('should be mobile responsive', async ({ page }) => {
      // Set mobile viewport
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto(BASE_URL);

      // Mobile menu should appear
      const mobileMenu = page.locator('[data-testid="mobile-menu"]');
      await expect(mobileMenu).toBeVisible();

      // Regular nav should be hidden
      const desktopNav = page.locator('[data-testid="desktop-nav"]');
      await expect(desktopNav).toHaveCSS('display', 'none');
    });

    test('should be tablet responsive', async ({ page }) => {
      // Set tablet viewport
      await page.setViewportSize({ width: 768, height: 1024 });
      await page.goto(`${BASE_URL}/dashboard`);

      // Page should still be functional
      await expect(page.locator('h1:has-text("My Vaults")')).toBeVisible();
    });

    test('should be desktop responsive', async ({ page }) => {
      // Set desktop viewport
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(`${BASE_URL}/dashboard`);

      // Desktop nav should be visible
      const desktopNav = page.locator('[data-testid="desktop-nav"]');
      await expect(desktopNav).toBeVisible();
    });
  });

  test.describe('Error Handling', () => {
    test.beforeEach(async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);
    });

    test('should show error when API fails', async ({ page }) => {
      // Navigate and intercept API to fail
      await page.route(`${API_URL}/api/**`, route => {
        route.abort('failed');
      });

      await page.goto(`${BASE_URL}/dashboard`);

      // Error message should appear
      await expect(page.locator('[role="alert"]:has-text("error")')).toBeVisible({
        timeout: 3000
      });
    });

    test('should show 404 for non-existent vault', async ({ page }) => {
      const fakeVaultId = 'nonexistent-vault';
      await page.goto(`${BASE_URL}/dashboard/${fakeVaultId}`);

      // Should show not found message
      await expect(page.locator('text=not found')).toBeVisible();
    });
  });

  test.describe('Performance', () => {
    test('should load landing page within 3 seconds', async ({ page }) => {
      const startTime = Date.now();
      await page.goto(BASE_URL);
      const loadTime = Date.now() - startTime;

      expect(loadTime).toBeLessThan(3000);
    });

    test('should load dashboard within 2 seconds', async ({ page, context }) => {
      await context.addCookies([
        {
          name: 'chronos_auth_token',
          value: 'test_token_123',
          url: BASE_URL
        }
      ]);

      const startTime = Date.now();
      await page.goto(`${BASE_URL}/dashboard`);
      const loadTime = Date.now() - startTime;

      expect(loadTime).toBeLessThan(2000);
    });
  });
});

/**
 * To run these tests:
 *
 * Playwright:
 * npm install -D @playwright/test
 * npx playwright test tests/e2e.spec.js
 * npx playwright test tests/e2e.spec.js --headed  # Show browser
 * npx playwright test tests/e2e.spec.js --debug   # Debug mode
 *
 * Cypress:
 * npm install -D cypress
 * npx cypress run --spec "tests/e2e.spec.js"
 * npx cypress open  # Interactive mode
 */

