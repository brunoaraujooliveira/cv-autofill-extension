import { expect, OPTIONS_PAGE, SIDE_PANEL_PAGE, test } from './extension';

test('side panel lists what is missing on a fresh install', async ({ openExtensionPage }) => {
  const panel = await openExtensionPage(SIDE_PANEL_PAGE);

  await expect(panel.getByText('Add your API key in the options.')).toBeVisible();
  await expect(panel.getByText('Add your resume in the options.')).toBeVisible();
});

test('options store the API key without ever showing it again', async ({ openExtensionPage }) => {
  const options = await openExtensionPage(OPTIONS_PAGE);
  await expect(options.getByText('No key stored yet.')).toBeVisible();

  await options.getByLabel('API key').fill('test-key-123');
  await options.getByRole('button', { name: 'Save settings' }).click();

  await expect(options.getByText('A key is stored.')).toBeVisible();
  await expect(options.getByLabel('API key')).toHaveValue('');

  await options.reload();
  await expect(options.getByText('A key is stored.')).toBeVisible();
  expect(await options.content()).not.toContain('test-key-123');

  await options.getByRole('button', { name: 'Remove key' }).click();
  await expect(options.getByText('No key stored yet.')).toBeVisible();
});

test('options reject an invalid resume and save the example', async ({ openExtensionPage }) => {
  const options = await openExtensionPage(OPTIONS_PAGE);
  const editor = options.getByRole('textbox', { name: 'Resume (JSON Resume)' });

  await editor.fill('{ "basics": { "name": "Ana" }, "work": [{ "startDate": "03/2021" }] }');
  await options.getByRole('button', { name: 'Validate and save' }).click();
  await expect(options.getByText('basics.email')).toBeVisible();
  await expect(options.getByText('work[0].startDate')).toBeVisible();

  await options.getByRole('button', { name: 'Load example' }).click();
  await options.getByRole('button', { name: 'Validate and save' }).click();
  await expect(options.getByText('Resume is valid and saved.')).toBeVisible();

  await options.reload();
  await expect(editor).toHaveValue(/"name": "Ana Example"/);
});

test('language change applies to every open page', async ({ openExtensionPage }) => {
  const panel = await openExtensionPage(SIDE_PANEL_PAGE);
  const options = await openExtensionPage(OPTIONS_PAGE);

  await options.getByLabel('Language').selectOption('pt');
  await options.getByRole('button', { name: 'Save settings' }).click();

  await expect(options.getByRole('button', { name: 'Salvar configurações' })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Abrir opções' })).toBeVisible();
});

test('side panel can start once key, resume and tab are known', async ({ openExtensionPage }) => {
  const options = await openExtensionPage(OPTIONS_PAGE);
  await options.getByLabel('API key').fill('test-key-123');
  await options.getByRole('button', { name: 'Save settings' }).click();
  await expect(options.getByText('A key is stored.')).toBeVisible();
  await options.getByRole('button', { name: 'Load example' }).click();
  await options.getByRole('button', { name: 'Validate and save' }).click();
  await expect(options.getByText('Resume is valid and saved.')).toBeVisible();

  const panel = await openExtensionPage(`${SIDE_PANEL_PAGE}?tabId=1`);
  await expect(panel.getByRole('button', { name: 'Fill this page' })).toBeEnabled();
});

test('options can be closed from the page itself', async ({ openExtensionPage }) => {
  const options = await openExtensionPage(OPTIONS_PAGE);
  const closed = options.waitForEvent('close');
  await options.getByRole('button', { name: 'Close' }).click();
  await closed;
  expect(options.isClosed()).toBe(true);
});
