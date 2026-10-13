import type { Page } from '@playwright/test';
import { expect, fieldRow, fillFromPanel, sentRequests, test, waitForReview } from './extension';

async function submittedData(form: Page): Promise<Record<string, unknown>> {
  await form.getByRole('button', { name: 'Submit application' }).click();
  await expect(form.locator('#result')).not.toBeEmpty();
  return JSON.parse(await form.locator('#result').innerText()) as Record<string, unknown>;
}

test.describe('fixture 01: plain HTML form', () => {
  test('fills what the resume answers and leaves the rest to the user', async ({ openFixture }) => {
    const { form, panel } = await openFixture('01-plain');
    await fillFromPanel(panel);

    await expect(form.locator('#first')).toHaveValue('Ana');
    await expect(form.locator('#last')).toHaveValue('Example');
    await expect(form.locator('[name="email"]')).toHaveValue('ana.example@example.com');
    await expect(form.locator('[name="phone"]')).toHaveValue('+351 910 000 000');
    await expect(form.locator('[name="linkedin"]')).toHaveValue(
      'https://www.linkedin.com/in/ana-example',
    );
    await expect(form.locator('#country')).toHaveValue('PT');
    await expect(form.locator('#start')).toHaveValue('2027-01-04');
    await expect(form.locator('[name="euAuthorized"][value="yes"]')).toBeChecked();
    await expect(form.locator('#why')).toHaveValue('Draft written for Ana Example.');

    // Not in the resume: asked, never invented.
    await expect(form.locator('#salary')).toHaveValue('');
    await expect(form.locator('[name="privacy"]')).not.toBeChecked();
    // Invisible and hidden fields are never touched.
    await expect(form.locator('#trap')).toHaveValue('');
    await expect(form.locator('[name="csrf"]')).toHaveValue('token-123');
    await expect(form.locator('[name="transparent"]')).toHaveValue('');
    await expect(form.locator('[name="offscreen"]')).toHaveValue('');
  });

  test('shows each field in the side panel with its outcome', async ({ openFixture }) => {
    const { panel } = await openFixture('01-plain');
    await fillFromPanel(panel);

    await expect(panel.getByText('9 filled · 2 need you · 0 skipped')).toBeVisible();
    await expect(fieldRow(panel, 'Salary expectation')).toHaveAttribute('data-status', 'ask_user');
    await expect(fieldRow(panel, 'I agree to the privacy policy')).toHaveAttribute(
      'data-status',
      'ask_user',
    );
    await expect(fieldRow(panel, 'Country')).toContainText('Portugal');
    await expect(fieldRow(panel, 'Why do you want to work here?')).toContainText('Review');
    await expect(panel.getByText('Leave this empty')).toHaveCount(0);
  });

  test('sends the model the field schema and resume, never the page', async ({
    openFixture,
    request,
    apiKey,
  }) => {
    const { panel } = await openFixture('01-plain');
    await fillFromPanel(panel);

    const [sent, ...others] = await sentRequests(request, apiKey);
    expect(others).toEqual([]);
    expect(sent?.fields).toHaveLength(11);
    expect(Object.keys(sent?.fields[0] ?? {}).sort()).toEqual([
      'currentValue',
      'id',
      'label',
      'required',
      'type',
    ]);
    for (const leaked of ['token-123', '<form', 'selector', apiKey, 'localhost']) {
      expect(sent?.raw).not.toContain(leaked);
    }
  });

  test('"Read and fill again" does the step over from nothing', async ({
    openFixture,
    request,
    apiKey,
  }) => {
    const { form, panel } = await openFixture('01-plain');
    await fillFromPanel(panel);
    const salary = fieldRow(panel, 'Salary expectation');
    await salary.getByRole('textbox').fill('65000');
    await salary.getByRole('button', { name: 'Fill' }).click();
    await expect(salary).toContainText('your answer');
    // A value the extension typed, then spoiled, as if it had got it wrong.
    await form.locator('#first').fill('Wrong');

    await panel.getByRole('button', { name: 'Read and fill again' }).click();
    await expect(salary).not.toContainText('your answer');
    await waitForReview(panel);

    await expect(form.locator('#first')).toHaveValue('Ana');
    // What the user typed stays on the page; the model was asked about every field again.
    await expect(form.locator('#salary')).toHaveValue('65000');
    const requests = await sentRequests(request, apiKey);
    expect(requests.map(({ fields }) => fields.length)).toEqual([11, 11]);
  });

  test('the page itself never submits', async ({ openFixture }) => {
    const { form, panel } = await openFixture('01-plain');
    await fillFromPanel(panel);
    await expect(form.locator('#result')).toBeEmpty();
  });
});

test.describe('fixture 02: React controlled inputs', () => {
  test('a value written without events does not reach the React state', async ({ openFixture }) => {
    const { form } = await openFixture('02-react');
    await form.getByLabel('First name').evaluate((input: HTMLInputElement) => {
      input.value = 'Ana';
    });
    expect(await submittedData(form)).toMatchObject({ firstName: '' });
  });

  test('values filled by the extension reach the React state', async ({ openFixture }) => {
    const { form, panel } = await openFixture('02-react');
    await fillFromPanel(panel);

    expect(await submittedData(form)).toEqual({
      firstName: 'Ana',
      lastName: 'Example',
      email: 'ana.example@example.com',
      country: 'PT',
      euAuthorized: 'Yes',
      remote: true,
      about: 'Draft written for Ana Example.',
    });
  });
});

test.describe('fixture 06: custom combobox with search', () => {
  test('reads the options, then picks them by clicking and by searching', async ({
    openFixture,
    request,
    apiKey,
  }) => {
    const { form, panel } = await openFixture('06-combobox');
    await fillFromPanel(panel);

    expect(await submittedData(form)).toEqual({ country: 'Portugal', city: 'Lisbon' });
    await expect(form.locator('[role="listbox"]')).toHaveCount(0);

    // The country list only exists while open; it was read so the model could choose from it.
    const [sent] = await sentRequests(request, apiKey);
    expect(sent?.fields).toMatchObject([
      {
        label: 'Country',
        type: 'combobox',
        options: ['Brazil', 'Portugal', 'Spain', 'United Kingdom'],
      },
      { label: 'City', type: 'combobox' },
    ]);
    expect(sent?.fields[1]?.options).toBeUndefined();
  });
});
