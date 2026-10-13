import { expect, fieldRow, fillFromPanel, OPTIONS_PAGE, sentRequests, test } from './extension';

test.describe('mapping cache', () => {
  test('fills a second application on the same portal without asking the model', async ({
    openFixture,
    openExtensionPage,
    request,
    apiKey,
  }) => {
    const first = await openFixture('02-react');
    await fillFromPanel(first.panel);
    await first.panel.getByRole('button', { name: 'Mark as done' }).click();
    await expect(first.panel.locator('[data-phase="DONE"]')).toBeVisible();
    expect(await sentRequests(request, apiKey)).toHaveLength(1);

    // Same portal and same form, reached through the address of another job.
    const second = await openFixture('02-react', '/alt/fixtures/02-react/');
    await fillFromPanel(second.panel);

    await expect(second.form.getByLabel('First name')).toHaveValue('Ana');
    await expect(second.form.getByLabel('Country')).toHaveValue('PT');
    await expect(fieldRow(second.panel, 'First name')).toContainText('from cache');
    // Only the generated text, which is never cached, went back to the model.
    const requests = await sentRequests(request, apiKey);
    expect(requests).toHaveLength(2);
    expect(requests[1]?.fields.map((field) => field.label)).toEqual(['About you']);

    const options = await openExtensionPage(OPTIONS_PAGE);
    await expect(options.getByText(/localhost: \d+ fields in 1 steps/)).toBeVisible();
    await options.getByRole('button', { name: 'Clear' }).click();
    await expect(options.getByText('Nothing learnt yet.')).toBeVisible();
  });
});

test.describe('answer bank', () => {
  test('keeps an answer given in the panel and offers it to later applications', async ({
    openFixture,
    openExtensionPage,
    request,
    apiKey,
  }) => {
    const first = await openFixture('01-plain');
    await fillFromPanel(first.panel);

    const salary = fieldRow(first.panel, 'Salary expectation');
    await salary.getByRole('textbox').fill('65000');
    await salary.getByRole('button', { name: 'Fill' }).click();
    await expect(first.form.locator('#salary')).toHaveValue('65000');
    await expect(salary).toContainText('your answer');

    // Consent is answered for this form only; it never goes to the bank.
    const privacy = fieldRow(first.panel, 'I agree to the privacy policy');
    await privacy.getByRole('checkbox').check();
    await privacy.getByRole('button', { name: 'Fill' }).click();
    await expect(first.form.locator('[name="privacy"]')).toBeChecked();

    const options = await openExtensionPage(OPTIONS_PAGE);
    await expect(options.getByLabel('Salary expectation (EUR/year)')).toHaveValue('65000');
    await expect(options.getByText('I agree to the privacy policy')).toHaveCount(0);

    const second = await openFixture('04-conditional');
    await fillFromPanel(second.panel);
    const lastRequest = (await sentRequests(request, apiKey)).at(-1);
    expect(JSON.parse(lastRequest?.raw ?? '{}')).toMatchObject({
      answers: [{ question: 'Salary expectation (EUR/year)', answer: '65000' }],
    });
  });
});
