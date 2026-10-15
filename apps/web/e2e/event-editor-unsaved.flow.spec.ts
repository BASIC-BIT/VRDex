import { expect, test } from '@playwright/test';
test.use({ timezoneId: 'UTC' });
for (const editor of ['intake', 'staff']) {
  test(`${editor} guards shell links and repeated real history traversal @fixture`, async ({ page }) => {
    await page.goto(`/playwright/event-intake?entry=${editor}`);
    await page.getByRole('link', { name: 'Open editor' }).click();
    await page.getByLabel('Event title', { exact: true }).fill('Unsaved night');
    for (let attempt = 0; attempt < 2; attempt++) {
      const dialog = page.waitForEvent('dialog');
      await page.evaluate(() => history.back());
      const confirmation = await dialog;
      expect(confirmation.type()).toBe('confirm');
      expect(confirmation.message()).toBe('Leave without saving?');
      await confirmation.dismiss();
      await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Unsaved night');
      await expect(page).toHaveURL(/playwright/);
    }
    const dialog = page.waitForEvent('dialog');
    await page.evaluate(() => history.back());
    await (await dialog).accept();
    await expect(page).toHaveURL(new RegExp(`entry=${editor}`));
    await page.goForward();
    await expect(page).toHaveURL(/playwright/);
  });
  test(`${editor} slot removal requires confirmation @fixture`, async ({ page }) => {
    await page.goto(editor === 'intake' ? '/playwright/event-intake' : '/playwright/event-lineup?editor&mode=create');
    await page.getByLabel('Starts', { exact: true }).fill('2027-10-15T20:00');
    await page.getByRole('navigation', { name: 'Event editor' }).getByRole('button', { name: 'Lineup', exact: true }).click();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const rows = page.locator('[data-lineup-row]');
    await rows.first().getByRole('button', { name: 'Remove slot', exact: true }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(rows).toHaveCount(4);
    await rows.first().getByRole('button', { name: 'Remove slot', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Remove slot', exact: true }).click();
    await expect(rows).toHaveCount(3);
  });
}

const nav = (page: import('@playwright/test').Page, step: string) => page.getByRole('navigation', { name: 'Event editor' }).getByRole('button', { name: step, exact: true }).click();
async function dismissLeave(page: import('@playwright/test').Page) {
  const confirmation = page.waitForEvent('dialog');
  const click = page.getByRole('link', { name: 'Contact', exact: true }).click();
  const dialog = await confirmation;
  expect(dialog.type()).toBe('confirm');
  await dialog.dismiss();
  await click;
}
for (const editor of ['intake', 'staff']) {
  test(`${editor} native refresh and document exit preserve edited values on cancel @fixture`, async ({ page }) => {
    await page.goto(editor === 'intake' ? '/playwright/event-intake' : '/playwright/event-lineup?editor&mode=create');
    await page.getByLabel('Event title', { exact: true }).fill('Keep this');
    await dismissLeave(page);
    for (const action of ['reload', 'document']) {
      const confirmation = page.waitForEvent('dialog');
      const navigation = action === 'reload' ? page.reload({ timeout: 1500 }).catch(() => {}) : page.goto('/support', { timeout: 1500 }).catch(() => {});
      const dialog = await confirmation;
      expect(dialog.type()).toBe('beforeunload');
      await dialog.dismiss(); await navigation;
      await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Keep this');
    }
    const closingDialog = page.waitForEvent('dialog');
    const closing = page.close({ runBeforeUnload: true });
    expect((await closingDialog).type()).toBe('beforeunload');
    await (await closingDialog).dismiss(); await closing;
    expect(page.isClosed()).toBe(false);
  });
  test(`${editor} deferred save retains newer values and dirty state @fixture`, async ({ page }) => {
    await page.goto(editor === 'intake' ? '/playwright/event-intake?revision=draft' : '/playwright/event-lineup?editor&mode=create');
    if (editor === 'staff') await page.getByLabel('Starts', { exact: true }).fill('2027-10-15T20:00');
    await page.getByLabel('Event title', { exact: true }).fill('Submitted');
    await page.evaluate(editor => editor === 'intake' ? sessionStorage.setItem('event-intake-review-defer', 'true') : localStorage.setItem('event-lineup-fixture-defer-save', 'true'), editor);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await page.getByLabel('Event title', { exact: true }).fill('Newer title');
    await page.evaluate(editor => { window.dispatchEvent(new Event(editor === 'intake' ? 'event-intake-review-release' : 'event-lineup-fixture-release-save')); }, editor);
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Newer title');
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
    await dismissLeave(page);
    await page.evaluate(editor => editor === 'intake' ? sessionStorage.removeItem('event-intake-review-defer') : localStorage.removeItem('event-lineup-fixture-defer-save'), editor);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'false');
  });
  test(`${editor} publish then stay updates the same event once @fixture`, async ({ page }) => {
    await page.goto(editor === 'intake' ? '/playwright/event-intake?revision=draft' : '/playwright/event-lineup?editor&mode=create');
    if (editor === 'staff') await page.getByLabel('Starts', { exact: true }).fill('2027-10-15T20:00');
    await page.getByLabel('Event title', { exact: true }).fill('First title');
    await page.evaluate(editor => editor === 'intake' ? sessionStorage.setItem('fixture-publication-defer', 'true') : localStorage.setItem('event-lineup-fixture-defer-save', 'true'), editor);
    await nav(page, 'Review');
    await page.getByRole('button', { name: /^(Publish event|Publish)$/ }).click();
    await nav(page, 'Details');
    await page.getByLabel('Event title', { exact: true }).fill('Second title');
    const confirmation = page.waitForEvent('dialog');
    const release = page.evaluate(editor => window.dispatchEvent(new Event(editor === 'intake' ? 'release-publication' : 'event-lineup-fixture-release-save')), editor);
    await (await confirmation).dismiss(); await release;
    await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Second title');
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
    await page.evaluate(editor => editor === 'intake' ? sessionStorage.removeItem('fixture-publication-defer') : localStorage.removeItem('event-lineup-fixture-defer-save'), editor);
    await nav(page, 'Review');
    await page.getByRole('button', { name: /^(Publish event|Publish|Save changes)$/ }).click();
    await expect(page).toHaveURL(/\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
    if (editor === 'intake') {
      expect(await page.evaluate(() => sessionStorage.getItem('fixture-publication-count'))).toBe('1');
      expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('event-intake-revision-submission')!))).toMatchObject({ eventId: 'fixture-event', expectedUpdatedAt: 2, patch: { title: 'Second title' } });
    } else {
      expect(await page.evaluate(() => localStorage.getItem('event-lineup-fixture-command'))).toBe('events:updateCommunityEvent');
      expect(await page.evaluate(() => localStorage.getItem('event-lineup-fixture-command-count'))).toBe('2');
    }
  });
}
test('correction panel close confirms abandonment and preserves values @fixture', async ({ page }) => {
  await page.goto('/playwright/event-intake?revision=correction');
  await page.getByRole('button', { name: 'Correct event', exact: true }).click();
  await page.getByLabel('Event title', { exact: true }).fill('Retain correction');
  const confirmation = page.waitForEvent('dialog');
  const close = page.getByRole('button', { name: 'Correct event', exact: true }).click();
  await (await confirmation).dismiss(); await close;
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Retain correction');
});
test.describe('source pending buffers', () => {
  test.use({ timezoneId: 'America/New_York' });
test('source completion retains newer text and pending unresolved clock across source context @fixture', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fixture-source-draft', JSON.stringify({ version: 1, fields: { communitySlug: 'afterglow', title: 'Original', eventDate: '2027-03-14', timezone: 'America/New_York', start: { time: '01:30' }, sourceText: 'First source' } })));
  await page.goto('/playwright/event-intake?source=extraction-delay');
  await page.getByRole('button', { name: 'Import poster or text' }).click();
  await page.getByRole('button', { name: 'Extract details', exact: true }).click();
  await page.getByRole('textbox', { name: 'Source text', exact: true }).fill('Newer source');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Event title', { exact: true }).fill('Newer title');
  await page.getByLabel('Starts', { exact: true }).fill('2027-03-14T02:30');
  await page.evaluate(() => window.dispatchEvent(new Event('release-extraction')));
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Newer title');
  await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('2027-03-14T02:30');
  await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
  await page.getByLabel('Starts', { exact: true }).press('Escape');
  await page.getByRole('button', { name: 'Import poster or text' }).click();
  await expect(page.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue('Newer source');
});

});

test('history fallback cancels twice, replays once and permits a second traversal @fixture', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }));
  await page.goto('/playwright/event-intake?entry=intake');
  await page.getByRole('link', { name: 'Open editor' }).click();
  await page.getByLabel('Event title', { exact: true }).fill('Fallback edit');
  for (const accept of [false, false, true]) {
    const confirmation = page.waitForEvent('dialog');
    const traversal = page.evaluate(() => history.back());
    const dialog = await confirmation;
    if (accept) await dialog.accept(); else await dialog.dismiss();
    await traversal;
    if (!accept) await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Fallback edit');
  }
  await expect(page).toHaveURL(/entry=intake/);
  await page.goForward();
  await expect(page.getByLabel('Event title', { exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/entry=intake/);
});

for (const editor of ['intake', 'staff']) {
  test(`${editor} presentation changes and unchanged save keep the baseline clean @fixture`, async ({ page }) => {
    await page.addInitScript(() => sessionStorage.setItem('event-intake-fixture', JSON.stringify({ communitySlug: 'playwright-afterglow-social', title: 'Loaded', eventDate: '2027-10-15', timezone: 'UTC', start: { time: '20:00' } })));
    await page.goto(editor === 'intake' ? '/playwright/event-intake' : '/playwright/event-lineup?editor');
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'false');
    await page.getByText('Add doors-open time', { exact: true }).click();
    await page.getByRole('button', { name: 'Time zone', exact: true }).click();
    await page.getByRole('combobox', { name: 'Time zone' }).fill('Tokyo');
    await page.getByRole('option', { name: /Tokyo/ }).click();
    await nav(page, 'Lineup'); await nav(page, 'Review'); await nav(page, 'Details');
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'false');
    if (editor === 'intake') {
      await page.getByRole('button', { name: 'Save draft', exact: true }).click();
      await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'false');
    }
    page.on('dialog', dialog => { throw new Error(`Unexpected dialog ${dialog.type()}`); });
    await page.goto('/playwright/event-intake?entry=intake');
    await expect(page.getByRole('link', { name: 'Open editor' })).toBeVisible();
  });
  test(`${editor} failed save does not advance its baseline @fixture`, async ({ page }) => {
    await page.goto(editor === 'intake' ? '/playwright/event-intake?revision=draft' : '/playwright/event-lineup?editor&mode=create');
    if (editor === 'staff') await page.getByLabel('Starts', { exact: true }).fill('2027-10-15T20:00');
    await page.getByLabel('Event title', { exact: true }).fill('Failed save title');
    await page.evaluate(editor => editor === 'intake' ? sessionStorage.setItem('fixture-save-fail', 'true') : localStorage.setItem('event-lineup-fixture-save-error', 'Fixture failure'), editor);
    await page.getByRole('button', { name: 'Save draft', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
    await dismissLeave(page);
  });
}

test.describe('source context and pending authored buffers', () => {
  test.use({ timezoneId: 'America/New_York' });
  test('accepted source clock context cannot erase a newer invalid clock @fixture', async ({ page }) => {
    await page.goto('/playwright/event-intake?timezone=intake');
    await page.getByLabel('Starts', { exact: true }).fill('2027-03-14T01:30');
    await page.evaluate(() => sessionStorage.setItem('fixture-timezone-source-defer', 'true'));
    await page.getByRole('button', { name: 'Import poster or text' }).click();
    await page.getByRole('textbox', { name: 'Source text', exact: true }).fill('Accepted clock context');
    await page.getByRole('button', { name: 'Extract details', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByLabel('Starts', { exact: true }).fill('2027-03-14T02:30');
    await page.evaluate(() => window.dispatchEvent(new Event('release-timezone-source')));
    await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
    await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('2027-03-14T02:30');
    await expect(page.getByLabel('Starts', { exact: true })).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
    await page.getByLabel('Starts', { exact: true }).press('Escape');
    await expect(page.getByLabel('Starts', { exact: true })).toHaveValue('2027-03-14T01:30');
  });
});



test('poster completion preserves newer title, override and invalid duration buffers @fixture', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('fixture-source-draft', JSON.stringify({ version: 1, fields: { communitySlug: 'afterglow', title: 'Original', eventDate: '2027-07-15', timezone: 'UTC', start: { time: '20:00' }, lineup: [{ clientKey: 'first', position: 0, performerLabel: 'Aurora', personSlug: 'aurora', start: { time: '20:00' }, end: { time: '21:00' } }] } })));
  await page.goto('/playwright/event-intake?source=completion-delay');
  await page.getByRole('button', { name: 'Import poster or text' }).click();
  await page.getByLabel('Poster', { exact: true }).setInputFiles('public/test-media/event-poster.png');
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('fixture-upload-count'))).toBe('1');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByLabel('Event title', { exact: true }).fill('Newer upload title');
  await nav(page, 'Lineup');
  const row = page.locator('[data-lineup-row]').first();
  await row.locator('summary').filter({ hasText: 'Display name as' }).click();
  await row.getByRole('textbox', { name: 'Display name as', exact: true }).fill('  ');
  await row.getByRole('textbox', { name: 'Duration', exact: true }).fill('3.5');
  await page.evaluate(() => window.dispatchEvent(new Event('release-poster-completion')));
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await expect(row.getByRole('textbox', { name: 'Display name as', exact: true })).toHaveValue('  ');
  await expect(row.getByRole('textbox', { name: 'Duration', exact: true })).toHaveValue('3.5');
  await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
  await nav(page, 'Details');
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Newer upload title');
  await dismissLeave(page);
});

test('stale contributor save keeps the authored baseline and values @fixture', async ({ page }) => {
  await page.goto('/playwright/event-intake?revision=draft');
  await page.getByLabel('Event title', { exact: true }).fill('Local correction');
  await page.getByRole('button', { name: 'Update elsewhere', exact: true }).click();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('form').getByRole('status')).toContainText('changed');
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Local correction');
  await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
});


for (const editor of ['intake', 'staff']) {
  test(`${editor} clean publication reaches the event without a warning @fixture`, async ({ page }) => {
    await page.goto(editor === 'intake' ? '/playwright/event-intake?revision=draft' : '/playwright/event-lineup?editor&mode=create');
    if (editor === 'staff') await page.getByLabel('Starts', { exact: true }).fill('2027-10-15T20:00');
    await page.getByLabel('Event title', { exact: true }).fill('Clean publication');
    page.on('dialog', dialog => { throw new Error(`Unexpected ${dialog.type()}`); });
    await nav(page, 'Review');
    await page.getByRole('button', { name: /^(Publish event|Publish)$/ }).click();
    await expect(page).toHaveURL(/\/playwright-afterglow-social\/events\/playwright-afterglow-harbor-sessions$/);
  });
}

test('retained contributor publication rejects forbidden newer fields without republishing @fixture', async ({ page }) => {
  await page.goto('/playwright/event-intake?revision=draft');
  await page.evaluate(() => sessionStorage.setItem('fixture-publication-defer', 'true'));
  await nav(page, 'Review');
  await page.getByRole('button', { name: 'Publish event', exact: true }).click();
  await nav(page, 'Details');
  await page.getByRole('button', { name: 'Import poster or text' }).click();
  await page.getByRole('textbox', { name: 'Source text', exact: true }).fill('New forbidden source');
  await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
  const confirmation = page.waitForEvent('dialog');
  const release = page.evaluate(() => window.dispatchEvent(new Event('release-publication')));
  await (await confirmation).dismiss(); await release;
  await nav(page, 'Review');
  await page.getByRole('button', { name: 'Publish event', exact: true }).click();
  await expect(page.locator('form').getByRole('status')).toBeVisible();
  await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
  expect(await page.evaluate(() => sessionStorage.getItem('fixture-publication-count'))).toBe('1');
  expect(await page.evaluate(() => JSON.parse(sessionStorage.getItem('event-intake-revision-submission')!))).toMatchObject({ eventId: 'fixture-event', patch: { sourceText: 'New forbidden source' } });
  await page.getByRole('button', { name: 'Import poster or text' }).click();
  await expect(page.getByRole('textbox', { name: 'Source text', exact: true })).toHaveValue('New forbidden source');
});
