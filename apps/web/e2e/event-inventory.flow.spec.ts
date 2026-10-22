import { expect, test } from '@playwright/test';

test.describe('My events @fixture', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/playwright/event-inventory');
    await expect(page.getByRole('heading', { name: 'My events', exact: true })).toBeVisible({ timeout: 5000 });
  });

  test('filters all work and searches titles and community names with keyboard controls', async ({ page }) => {
    await expect(page.getByRole('listitem')).toHaveCount(6);
    await page.getByRole('button', { name: 'Drafts', exact: true }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await expect(page.getByText('Retracted', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Upcoming', exact: true }).click();
    await expect(page.getByRole('listitem')).toHaveCount(1);
    await expect(page.getByText('Date only night')).toBeVisible();
    await expect(page.getByText(/Time TBA/)).toBeVisible();
    await page.getByRole('button', { name: 'Past', exact: true }).click();
    await expect(page.getByText('Past session')).toBeVisible();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    await page.getByLabel('Find an event', { exact: true }).fill('   harbor   ');
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await page.getByLabel('Find an event', { exact: true }).fill('Afterglow');
    await expect(page.getByRole('listitem')).toHaveCount(4);
  });

  test('keeps distinct equal titles and grants only authorized continuation routes', async ({ page }) => {
    const rows = page.getByRole('listitem');
    const same = rows.filter({ hasText: 'Harbor sessions' });
    await expect(same).toHaveCount(2);
    await expect(same.nth(0).getByRole('link', { name: 'Continue', exact: true })).toHaveAttribute('href', '/events/new?draft=intake-1');
    await expect(same.nth(1).getByRole('link', { name: 'Continue', exact: true })).toHaveAttribute('href', '/afterglow/events/harbor/edit');
    await expect(same.nth(0).getByText(/Expires/)).toBeVisible();
    const publishedStaff = rows.filter({ hasText: 'Date only night' });
    await expect(publishedStaff.getByRole('link', { name: 'Edit', exact: true })).toHaveAttribute('href', '/afterglow/events/date-only/edit');
    await expect(publishedStaff.getByRole('link', { name: 'Continue', exact: true })).toHaveCount(0);
    const retracted = rows.filter({ hasText: 'Retracted night' });
    await expect(retracted.getByText('Retracted', { exact: true })).toBeVisible();
    await expect(retracted.getByRole('link')).toHaveCount(0);
    await expect(rows.filter({ hasText: 'Unavailable night' }).getByText('Unavailable', { exact: true })).toBeVisible();
    await expect(page.getByText('Expired intake')).toHaveCount(0);
    await expect(page.getByText(/Discord/)).toHaveCount(0);
    const link = same.nth(0).getByRole('link', { name: 'Continue', exact: true });
    await link.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/sign-in\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/events/new?draft=intake-1');
    await page.goto('/playwright/event-inventory');
    await page.getByRole('listitem').filter({ hasText: 'Harbor sessions' }).nth(1).getByRole('link', { name: 'Continue', exact: true }).click();
    await expect(page).toHaveURL(/sign-in\?returnTo=/);
    expect(new URL(page.url()).searchParams.get('returnTo')).toBe('/afterglow/events/harbor/edit');
  });

  test('bounds empty-page advancement and keeps explicit continuation until complete', async ({ page }) => {
    await page.getByLabel('Find an event', { exact: true }).fill('later');
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toBeEnabled();
    await expect(page.getByText('No events', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('listitem')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => Number(sessionStorage.getItem('inventory-later-reads')))).toBe(4);
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByText('Later match')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
    await page.getByLabel('Find an event', { exact: true }).fill('absent');
    await expect(page.getByText('No events', { exact: true })).toBeVisible();
  });

  test('discards a query changed while loading and fails a source visibly with retry', async ({ page }) => {
    const input = page.getByLabel('Find an event', { exact: true });
    await input.fill('slow');
    await expect(page.getByText('Loading events…', { exact: true })).toBeVisible();
    await input.fill('harbor');
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await page.evaluate(() => window.dispatchEvent(new Event('inventory-release')));
    await expect(page.getByText('Slow stale match')).toHaveCount(0);
    await input.fill('failure');
    await expect(page.getByRole('alert').filter({ hasText: 'Unable to load this page.' })).toBeVisible();
    await expect(page.getByRole('listitem')).toHaveCount(0);
    await expect(page.getByText('No events', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByText('Recovered match')).toBeVisible();
  });

  test('preserves authenticated navigation, search focus and mobile width', async ({ page }, testInfo) => {
    await expect(page.getByRole('link', { name: 'My events', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add event', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Event reports', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Add event for Afterglow', exact: true })).toBeVisible();
    const search = page.getByRole('button', { name: 'Search', exact: true });
    await search.click();
    const input = page.getByRole('combobox', { name: 'Search VRDex' });
    await expect(input).toBeFocused();
    await input.fill('aurora');
    await expect(page.getByRole('option')).toHaveCount(1);
    await input.press('ArrowDown');
    await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
    await expect(page).toHaveURL(/playwright\/event-inventory$/);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await input.press('Escape');
    await expect(search).toBeFocused();
    await page.screenshot({ path: testInfo.outputPath('my-events.png'), fullPage: true });
  });
});

test('contributor-only inventory loads all filters with an empty search @fixture', async ({ page }) => {
  await page.goto('/playwright/event-inventory?contributor=1');
  await expect(page.getByRole('heading', { name: 'My events', exact: true })).toBeVisible({ timeout: 5000 });
  await expect(page.getByRole('link', { name: 'Add event for Afterglow', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Add event', exact: true })).toBeVisible();
  for (const [filter, count] of [['Drafts', 1], ['Upcoming', 0], ['Past', 1], ['All', 3]] as const) {
    await page.getByRole('button', { name: filter, exact: true }).click();
    await expect(page.getByLabel('Find an event', { exact: true })).toHaveValue('');
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toBeEnabled();
    await expect(page.getByText('No events', { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Load more', exact: true }).click();
    await expect(page.getByText('Loading events…', { exact: true })).toHaveCount(0);
    await expect(page.getByRole('listitem')).toHaveCount(count);
    await expect(page.getByRole('button', { name: 'Load more', exact: true })).toHaveCount(0);
  }
});


test('removes inventory rows on sign-out and keeps auth-loading queries skipped @fixture', async ({ page }) => {
  await page.goto('/playwright/event-inventory');
  await expect(page.getByRole('listitem')).toHaveCount(6);
  await page.evaluate(() => window.dispatchEvent(new Event('inventory-sign-out')));
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'My events', exact: true })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Sign in', exact: true }).first()).toBeVisible();
  await page.goto('/playwright/event-inventory?session=loading');
  await expect(page.getByRole('heading', { name: 'My events', exact: true })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  expect(await page.evaluate(() => sessionStorage.getItem('inventory-protected-reads'))).toBe('0');
});


test('metadata source failure clears the inventory and retries the whole traversal @fixture', async ({ page }) => {
  await page.goto('/playwright/event-inventory?session=shortcuts-failure');
  await expect(page.getByRole('alert').filter({ hasText: 'Unable to load this page.' })).toBeVisible();
  await expect(page.getByRole('listitem')).toHaveCount(0);
  await expect(page.getByText('No events', { exact: true })).toHaveCount(0);
  await page.evaluate(() => window.dispatchEvent(new Event('inventory-recover-shortcuts')));
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(page.getByRole('listitem')).toHaveCount(6);
});

test('inventory mounts without React warnings @fixture', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('/playwright/event-inventory');
  await expect(page.getByRole('listitem')).toHaveCount(6);
  expect(errors).toEqual([]);
});

test('natural keyboard search retains focus through criteria resets @fixture', async ({ page }) => {
  await page.goto('/playwright/event-inventory');
  const input = page.getByLabel('Find an event', { exact: true });
  await input.click();
  await page.keyboard.type('Harbor sessions', { delay: 35 });
  await expect(input).toHaveValue('Harbor sessions');
  await expect(input).toBeFocused();
  await expect(page.getByRole('listitem')).toHaveCount(2);
});

test('keyboard filtering retains focus and the next tab position @fixture', async ({ page }) => {
  await page.goto('/playwright/event-inventory');
  const drafts = page.getByRole('button', { name: 'Drafts', exact: true });
  await drafts.focus();
  await page.keyboard.press('Enter');
  await expect(drafts).toBeFocused();
  await expect(drafts).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('listitem')).toHaveCount(2);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Past', exact: true })).toBeFocused();
});

test('focus refresh retains the active search control @fixture', async ({ page }) => {
  await page.goto('/playwright/event-inventory');
  const input = page.getByLabel('Find an event', { exact: true });
  await input.fill('harbor');
  await input.focus();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(input).toBeFocused();
  await expect(input).toHaveValue('harbor');
  await page.keyboard.type(' sessions', { delay: 35 });
  await expect(input).toHaveValue('harbor sessions');
  await expect(page.getByRole('listitem')).toHaveCount(2);
});
