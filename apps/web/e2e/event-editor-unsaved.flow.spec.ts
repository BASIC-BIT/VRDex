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


for (const editor of ['intake', 'staff']) for (const fallback of [false, true]) {
  test(`${editor} accepted same-component traversal rearms the next edited exit, fallback=${fallback} @fixture`, async ({ page }) => {
    if (fallback) await page.addInitScript(() => Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }));
    await page.goto(editor === 'intake' ? '/playwright/event-intake' : '/playwright/event-lineup?editor&mode=create');
    await page.getByLabel('Event title', { exact: true }).fill('Before accepted traversal');
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
    const dialogs: string[] = [];
    page.on('dialog', dialog => { dialogs.push(dialog.type()); });
    const originalUrl = page.url();
    const originalState = await page.evaluate(() => {
      history.replaceState({ ...history.state, caller: { retained: true } }, '');
      const state = history.state;
      history.pushState(state, '', location.href + '#retained-editor');
      return state;
    });
    const accepted = page.waitForEvent('dialog');
    await page.evaluate(() => history.back());
    expect((await accepted).message()).toBe('Leave without saving?');
    await (await accepted).accept();
    await expect(page).toHaveURL(originalUrl);
    await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Before accepted traversal');
    expect(await page.evaluate(() => history.state)).toEqual(originalState);
    await page.getByLabel('Event title', { exact: true }).fill('New edit after accepted traversal');
    await dismissLeave(page);
    await expect(page).toHaveURL(originalUrl);
    await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('New edit after accepted traversal');
    await expect(page.locator('form[data-event-dirty]')).toHaveAttribute('data-event-dirty', 'true');
    // Another handler can cancel an accepted click and keep this editor mounted.
    await page.evaluate(() => document.addEventListener('click', event => {
      event.preventDefault(); event.stopImmediatePropagation();
    }, { capture: true, once: true }));
    const canceledAttempt = page.waitForEvent('dialog');
    const canceledClick = page.getByRole('link', { name: 'Contact', exact: true }).click();
    await (await canceledAttempt).accept(); await canceledClick;
    await expect(page).toHaveURL(originalUrl);
    const unload = page.waitForEvent('dialog');
    const reload = page.reload({ timeout: 1500 }).catch(() => {});
    expect((await unload).type()).toBe('beforeunload');
    await (await unload).dismiss(); await reload;
    await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('New edit after accepted traversal');
    // A real accepted document link must not show a second native warning.
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/support?native=1'; link.textContent = 'Native test exit';
      document.body.append(link);
    });
    const nativeApproval = page.waitForEvent('dialog');
    const nativeClick = page.getByRole('link', { name: 'Native test exit', exact: true }).click();
    expect((await nativeApproval).type()).toBe('confirm');
    await (await nativeApproval).accept(); await nativeClick;
    await expect(page).toHaveURL(/support\?native=1$/);
    expect(dialogs).toEqual(['confirm', 'confirm', 'confirm', 'beforeunload', 'confirm']);
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

for (const editor of ['intake', 'staff']) for (const acceptedDelta of [-2, -1, 1]) {
  test(`${editor} history fallback preserves Back Forward and multi-step cancellation, accepts ${acceptedDelta} @fixture`, async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, 'navigation', { value: undefined, configurable: true });
      sessionStorage.setItem('history-fallback-before-bootstrap', String(globalThis.__vrdexEventEditorHistory === undefined && Reflect.get(window, 'navigation') === undefined));
    });
    await page.goto(`/playwright/event-intake?entry=${editor}`);
    await expect(page.getByRole('link', { name: 'Open editor' })).toBeVisible();
    expect(await page.evaluate(() => sessionStorage.getItem('history-fallback-before-bootstrap'))).toBe('true');
    const initialUrl = page.url();
    const normalState = await page.evaluate(() => {
      const original = history.state;
      history.replaceState({ ...original, caller: { value: 'normal' } }, '');
      return { original, updated: history.state };
    });
    expect(normalState.updated).toMatchObject(normalState.original);
    expect(normalState.updated.caller).toEqual({ value: 'normal' });
    expect(normalState.updated.vrdexEventEditorPosition).toEqual(expect.any(Number));
    await page.evaluate(() => history.pushState({ ...history.state, caller: { value: 'second' } }, '', `${location.href}&second=1`));
    const secondUrl = page.url();
    expect(await page.evaluate(() => history.state.caller)).toEqual({ value: 'second' });
    await page.getByRole('link', { name: 'Open editor' }).click();
    await expect(page.getByLabel('Event title', { exact: true })).toBeVisible();
    const editorUrl = page.url();
    // Create a real forward entry while clean, then return to the editor.
    await page.getByRole('link', { name: 'Contact', exact: true }).click();
    await expect(page).toHaveURL(/\/support$/);
    const forwardUrl = page.url();
    await page.goBack();
    await expect(page.getByLabel('Event title', { exact: true })).toBeVisible();
    const editorState = await page.evaluate(() => {
      const original = history.state;
      history.replaceState({ ...original, caller: { value: 'editor' } }, '');
      return { original, updated: history.state };
    });
    expect(editorState.updated).toMatchObject(editorState.original);
    await page.getByLabel('Event title', { exact: true }).fill('Fallback edit');
    let prompts = 0;
    page.on('dialog', () => prompts++);
    for (const delta of [-1, 1, -2, 1, -1]) {
      const confirmation = page.waitForEvent('dialog');
      await page.evaluate(delta => history.go(delta), delta);
      const dialog = await confirmation;
      expect(dialog.type()).toBe('confirm');
      expect(dialog.message()).toBe('Leave without saving?');
      await dialog.dismiss();
      await expect(page).toHaveURL(editorUrl);
      await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Fallback edit');
      expect(await page.evaluate(() => history.state)).toEqual(editorState.updated);
    }
    expect(prompts).toBe(5);
    const accepted = page.waitForEvent('dialog');
    await page.evaluate(delta => history.go(delta), acceptedDelta);
    await (await accepted).accept();
    await expect(page).toHaveURL(acceptedDelta === 1 ? forwardUrl : acceptedDelta === -1 ? secondUrl : initialUrl);
    await expect(page.getByLabel('Event title', { exact: true })).toHaveCount(0);
    expect(prompts).toBe(6);
    // Editor callbacks are gone, but public indexing still works on normal pages.
    await page.evaluate(delta => history.go(-delta), acceptedDelta);
    await expect(page.getByLabel('Event title', { exact: true })).toBeVisible();
    await page.evaluate(() => history.go(-2));
    await expect(page).toHaveURL(initialUrl);
    expect(await page.evaluate(() => history.state.caller)).toEqual({ value: 'normal' });
    await page.goForward();
    await expect(page).toHaveURL(secondUrl);
    expect(await page.evaluate(() => history.state.caller)).toEqual({ value: 'second' });
    expect(prompts).toBe(6);
  });
}

test('history fallback lets an unindexed destination escape without replay @fixture', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'navigation', { value: undefined, configurable: true });
    if (!sessionStorage.getItem('unknown-history-created')) {
      // This public entry predates the app bootstrap and must remain unknown.
      history.replaceState({ caller: 'before-bootstrap' }, '', '/playwright/event-intake?entry=intake&unknown=1');
      history.pushState({ caller: 'bootstrap-entry' }, '', '/playwright/event-intake?entry=intake');
      sessionStorage.setItem('unknown-history-created', 'true');
    }
    const go = history.go;
    history.go = function (delta) {
      sessionStorage.setItem('unknown-history-go-count', String(Number(sessionStorage.getItem('unknown-history-go-count') ?? 0) + 1));
      go.call(history, delta);
    };
  });
  await page.goto('/playwright/event-intake?entry=intake');
  await page.getByRole('link', { name: 'Open editor' }).click();
  await page.getByLabel('Event title', { exact: true }).fill('Unknown escape');
  const dialogs: string[] = [];
  page.on('dialog', async dialog => { dialogs.push(dialog.type()); await dialog.accept(); });
  await page.evaluate(() => history.go(-2));
  await expect(page).toHaveURL(/unknown=1/);
  await expect(page.getByRole('link', { name: 'Open editor' })).toBeVisible();
  expect(await page.evaluate(() => history.state.caller)).toBe('before-bootstrap');
  expect(dialogs).toEqual(['beforeunload']);
  expect(await page.evaluate(() => sessionStorage.getItem('unknown-history-go-count'))).toBe('1');
  await page.evaluate(() => history.forward());
  await expect(page).toHaveURL(/entry=intake$/);
  await expect(page.getByRole('link', { name: 'Open editor' })).toBeVisible();
  expect(dialogs).toEqual(['beforeunload']);
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

async function openOutput(page: import('@playwright/test').Page, delayedAccounts = false, existingStream = false) {
  await page.addInitScript(({ delayed, existingStream }) => {
    const startAt = Date.UTC(2027, 9, 15, 20);
    localStorage.setItem('event-lineup-fixture-v1', JSON.stringify({ id: 'output', slug: 'output', title: 'Output night', startAt, endAt: startAt + 3600000, timezone: 'UTC', scheduleKind: 'timed', status: 'scheduled', publicationState: 'draft_private', source: { sourceType: 'contributor' }, watchSurfaceEnabled: true, watchMode: 'event_stream', mediaLinks: existingStream ? [{ type: 'stream', label: 'Output', url: 'vrcdn:existing-output', presentation: 'open' }] : [], worlds: [], participants: [], slots: [], preservedParticipantAssociationIds: [], preservedSlotAssociationIds: [], preservedWorldAssociationIds: [] }));
    if (delayed) localStorage.setItem('fixture-output-defer-accounts', 'true');
  }, { delayed: delayedAccounts, existingStream });
  await page.goto('/playwright/event-lineup?editor&output');
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue('Output night');
  await nav(page, 'Review');
  await page.locator('summary').filter({ hasText: /^Advanced/ }).click();
  await expect(page.getByRole('heading', { name: 'VRCDN output', exact: true })).toBeVisible();
}
const outputDirty = (page: import('@playwright/test').Page) => page.locator('form[data-event-dirty]');
const outputConsent = (page: import('@playwright/test').Page) => page.getByRole('checkbox', { name: 'I confirm I am authorized to publish this event through the selected output account.' });
const saveOutput = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Save output account', exact: true }).click();

for (const field of ['Output account', 'Output label', 'Watch preview URL', 'Quest stream URL', 'PC stream URL', 'authorization']) test(`staff independent output dirty guard covers ${field} @flow @fixture`, async ({ page }) => {
  await openOutput(page);
  await expect(page.getByRole('combobox', { name: /^Output account/ })).toHaveValue('first');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
  if (field === 'Output account') await page.getByRole('combobox', { name: /^Output account/ }).selectOption('second');
  else if (field === 'authorization') await outputConsent(page).check();
  else await page.getByLabel(field, { exact: true }).fill(field.includes('URL') ? 'https://example.com/authored' : 'Authored output');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
  await dismissLeave(page);
  const dialog = page.waitForEvent('dialog');
  const reload = page.reload({ timeout: 1500 }).catch(() => {});
  expect((await dialog).type()).toBe('beforeunload');
  await (await dialog).dismiss();
  await reload.catch(() => {});
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
});

test('staff output defaults preserve earlier authored fields and untouched opening stays clean @flow @fixture', async ({ page }) => {
  await openOutput(page, true);
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
  await page.getByLabel('Output label', { exact: true }).fill('Before accounts');
  await page.getByLabel('Quest stream URL', { exact: true }).fill('temporary');
  await page.getByLabel('Quest stream URL', { exact: true }).fill('');
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-output-release-accounts')));
  await expect(page.getByRole('combobox', { name: /^Output account/ })).toHaveValue('first');
  await expect(page.getByLabel('Output label', { exact: true })).toHaveValue('Before accounts');
  await expect(page.getByLabel('Quest stream URL', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('Watch preview URL', { exact: true })).toHaveValue('https://example.com/first.m3u8');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
});

test('staff output saves only its submitted snapshot and event save leaves output edits dirty @flow @fixture', async ({ page }, testInfo) => {
  await openOutput(page);
  await page.getByLabel('Output label', { exact: true }).fill('First output');
  await outputConsent(page).check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('event-lineup-fixture-command-count'))).toBe('1');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
  await saveOutput(page);
  await expect(page.getByText('Output saved.', { exact: true })).toBeVisible();
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
  await nav(page, 'Details');
  await page.getByLabel('Event title', { exact: true }).fill('Event edit');
  await nav(page, 'Review');
  await page.getByLabel('Output label', { exact: true }).fill('Second output');
  await saveOutput(page);
  await expect(page.getByText('Output saved.', { exact: true })).toBeVisible();
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
  await dismissLeave(page);
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
  await page.evaluate(() => localStorage.setItem('fixture-output-defer-save', 'true'));
  await page.getByLabel('Output label', { exact: true }).fill('Submitted output');
  await saveOutput(page);
  await expect(page.getByRole('button', { name: 'Saving output...', exact: true })).toBeVisible();
  await page.getByLabel('Output label', { exact: true }).fill('Newer output');
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-output-release-save')));
  await expect(page.getByText('Output saved.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('fixture-output-persisted')!))).toMatchObject({ label: 'Submitted output', outputAccountKey: 'first', sourceConsentAccepted: true, destinationAuthorityAccepted: true, providerRulesAccepted: true, rightsClearedMediaAccepted: true });
  await expect(page.getByLabel('Output label', { exact: true })).toHaveValue('Newer output');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
  await page.screenshot({ path: testInfo.outputPath('output-newer-edit.png'), fullPage: true });
  await dismissLeave(page);
  await page.getByLabel('Output label', { exact: true }).fill('Submitted output');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
});

test('staff output failure and validation retain dirty edits @flow @fixture', async ({ page }) => {
  await openOutput(page);
  await page.getByLabel('Output label', { exact: true }).fill('Unsaved output');
  await saveOutput(page);
  await expect(page.getByText('Confirm you are authorized to publish this output.', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fixture-output-submission'))).toBeNull();
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
  await outputConsent(page).check();
  await page.evaluate(() => localStorage.setItem('fixture-output-save-error', 'true'));
  await saveOutput(page);
  await expect(page.getByText('Backend error - please try again later', { exact: true })).toBeVisible();
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
  await dismissLeave(page);
  await page.evaluate(() => localStorage.removeItem('fixture-output-save-error'));
  await saveOutput(page);
  await expect(page.getByText('Output saved.', { exact: true })).toBeVisible();
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
});

test('staff output delayed untouched defaults stay clean @flow @fixture', async ({ page }) => {
  await openOutput(page, true);
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
  await page.evaluate(() => window.dispatchEvent(new Event('fixture-output-release-accounts')));
  await expect(page.getByRole('combobox', { name: /^Output account/ })).toHaveValue('first');
  await expect(page.getByLabel('Output label', { exact: true })).toHaveValue('first output');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'false');
});

test('staff output edited during event save remains dirty after event completion @flow @fixture', async ({ page }) => {
  await openOutput(page);
  await nav(page, 'Details');
  await page.getByLabel('Event title', { exact: true }).fill('Submitted event');
  await page.evaluate(() => localStorage.setItem('event-lineup-fixture-defer-save', 'true'));
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('event-lineup-fixture-command-count'))).toBe('1');
  await nav(page, 'Review');
  await page.getByLabel('Output label', { exact: true }).fill('Newer output');
  await page.evaluate(() => window.dispatchEvent(new Event('event-lineup-fixture-release-save')));
  await expect(page.getByRole('button', { name: 'Save draft', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Output label', { exact: true })).toHaveValue('Newer output');
  await expect(outputDirty(page)).toHaveAttribute('data-event-dirty', 'true');
  await dismissLeave(page);
});

test('output editing prefills the supported MPEG-TS browser transport @flow @fixture', async ({ page }) => {
  await openOutput(page, true, true);
  await expect(page.getByLabel('Watch preview URL', { exact: true })).toHaveValue('https://stream.vrcdn.live/live/existing-output.live.ts');
  await expect(page.getByLabel('Quest stream URL', { exact: true })).toHaveValue('https://stream.vrcdn.live/live/existing-output.live.ts');
  await expect(page.getByLabel('PC stream URL', { exact: true })).toHaveValue('rtspt://stream.vrcdn.live/live/existing-output');
});
