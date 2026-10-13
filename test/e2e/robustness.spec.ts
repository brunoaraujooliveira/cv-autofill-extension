import { expect, fieldRow, fillFromPanel, sentRequests, test } from './extension';

test.describe('fixture 07: open shadow DOM', () => {
  test('fills fields inside nested shadow roots', async ({ openFixture }) => {
    const { form, panel } = await openFixture('07-shadow');
    await fillFromPanel(panel);

    // Playwright locators pierce open shadow roots, like the extension has to.
    await expect(form.getByLabel('First name')).toHaveValue('Ana');
    await expect(form.getByLabel('Email')).toHaveValue('ana.example@example.com');
    await expect(form.getByLabel('Country')).toHaveValue('PT');
    await expect(panel.locator('[data-phase="FINAL_REVIEW"]')).toBeVisible();
    await expect(form.locator('#result')).toBeEmpty();
  });
});

test.describe('fixture 08: form inside a cross-origin iframe', () => {
  test('fills the page and the embedded frame as one step', async ({
    openFixture,
    request,
    apiKey,
  }) => {
    const { form, panel } = await openFixture('08-iframe');
    await expect(form.frameLocator('#embedded').getByLabel('Email')).toBeVisible();
    await fillFromPanel(panel);

    const frame = form.frameLocator('#embedded');
    await expect(form.getByLabel('First name')).toHaveValue('Ana');
    await expect(frame.getByLabel('Email')).toHaveValue('ana.example@example.com');
    await expect(frame.getByLabel('Country')).toHaveValue('PT');
    await expect(frame.locator('#result')).toBeEmpty();

    // One request for the whole step, with the fields of both frames.
    const [sent, ...others] = await sentRequests(request, apiKey);
    expect(others).toEqual([]);
    expect(sent?.fields.map((field) => field.label)).toEqual(['First name', 'Email', 'Country']);
  });
});

test.describe('fixture 09: validation errors', () => {
  test('corrects a rejected format from the error message', async ({
    openFixture,
    request,
    apiKey,
  }) => {
    const { form, panel } = await openFixture('09-validation');
    await fillFromPanel(panel);

    await expect(form.locator('#birth')).toHaveValue('20/08/1991');
    await expect(form.locator('#birth-error')).toBeEmpty();
    await expect(fieldRow(panel, 'Date of birth')).toHaveAttribute('data-status', 'filled');

    const requests = await sentRequests(request, apiKey);
    const retried = requests[1]?.fields.find((field) => field.label === 'Date of birth');
    expect(retried).toMatchObject({
      currentValue: '1991-08-20',
      error: 'Use the format DD/MM/YYYY',
    });
  });

  test('gives up after two corrections and hands the field to the user', async ({
    openFixture,
    request,
    apiKey,
  }) => {
    const { panel } = await openFixture('09-validation');
    await fillFromPanel(panel);

    const row = fieldRow(panel, 'Postal code');
    await expect(row).toHaveAttribute('data-status', 'failed');
    await expect(row).toContainText('This postal code is not served yet');

    // The first decision plus two corrections, never more.
    const asked = (await sentRequests(request, apiKey)).filter(({ fields }) =>
      fields.some((field) => field.label === 'Postal code'),
    );
    expect(asked).toHaveLength(3);
  });

  test('attaches the stored resume file to the upload field', async ({
    openFixture,
    sendToWorker,
  }) => {
    await sendToWorker('file/save', {
      name: 'resume.pdf',
      type: 'application/pdf',
      base64: Buffer.from('%PDF-1.4 test').toString('base64'),
    });
    const { form, panel } = await openFixture('09-validation');
    await fillFromPanel(panel);

    const attached = await form.locator('#cv').evaluate((input: HTMLInputElement) => {
      const [file] = input.files ?? [];
      return file ? { name: file.name, type: file.type, size: file.size } : null;
    });
    expect(attached).toEqual({ name: 'resume.pdf', type: 'application/pdf', size: 13 });
    await expect(fieldRow(panel, 'Resume / CV')).toHaveAttribute('data-status', 'filled');
  });

  test('leaves the upload to the user when no file is stored', async ({ openFixture }) => {
    const { panel } = await openFixture('09-validation');
    await fillFromPanel(panel);
    await expect(fieldRow(panel, 'Resume / CV')).toHaveAttribute('data-status', 'pending_manual');
  });
});
