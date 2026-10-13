import type { Page } from '@playwright/test';
import exampleResume from '../../examples/resume.example.json' with { type: 'json' };
import { expect, fieldRow, fillFromPanel, sentRequests, test, waitForReview } from './extension';

async function nextStep(panel: Page): Promise<void> {
  await panel.getByRole('button', { name: 'Next step' }).click();
}

async function answerInPanel(panel: Page, label: string, value: string): Promise<void> {
  const row = fieldRow(panel, label);
  await row.getByRole('textbox').fill(value);
  await row.getByRole('button', { name: 'Fill' }).click();
  await expect(row).toHaveAttribute('data-status', 'filled');
}

/** Walks the wizard up to the review of its third step. */
async function reachThirdStep(panel: Page): Promise<void> {
  await fillFromPanel(panel);
  await nextStep(panel);
  await waitForReview(panel, 2);
  await answerInPanel(panel, 'Salary expectation', '65000');
  await nextStep(panel);
  await waitForReview(panel, 3);
}

test.describe('fixture 03: four-step wizard', () => {
  test('advances one step at a time, only when the user confirms', async ({ openFixture }) => {
    const { form, panel } = await openFixture('03-wizard');
    await fillFromPanel(panel);

    await expect(panel.locator('.step-title')).toHaveText('Step 1 · Personal details');
    await expect(form.locator('[name="firstName"]')).toHaveValue('Ana');
    // Filled, reviewed, but not moved: that waits for the user.
    await expect(form.getByRole('tab', { selected: true })).toHaveText('Personal details');

    await nextStep(panel);
    await waitForReview(panel, 2);
    await expect(form.getByRole('tab', { selected: true })).toHaveText('Contact');
    await expect(form.locator('[name="country"]')).toHaveValue('PT');
  });

  test('explains what is missing when the form keeps Next disabled', async ({ openFixture }) => {
    const { form, panel } = await openFixture('03-wizard');
    await fillFromPanel(panel);
    await nextStep(panel);
    await waitForReview(panel, 2);

    // The salary is not in the resume, so the form's Next button stays disabled.
    await nextStep(panel);
    await expect(panel.locator('[data-notice="next_disabled"]')).toContainText(
      'Salary expectation',
    );
    await expect(form.getByRole('tab', { selected: true })).toHaveText('Contact');

    await answerInPanel(panel, 'Salary expectation', '65000');
    await expect(form.locator('[name="salary"]')).toHaveValue('65000');
    await nextStep(panel);
    await waitForReview(panel, 3);
    await expect(form.getByRole('tab', { selected: true })).toHaveText('Questions');
  });

  test('moves on by itself when confidence is high and nothing is pending', async ({
    openFixture,
    sendToWorker,
  }) => {
    const { form, panel } = await openFixture('03-wizard');
    await sendToWorker('settings/save', { autoAdvance: true });
    await panel.getByRole('button', { name: 'Fill this page' }).click();

    // Step 1 is fully answered by the resume; step 2 needs the user, so it stops there.
    await waitForReview(panel, 2);
    await expect(form.getByRole('tab', { selected: true })).toHaveText('Contact');
    await expect(fieldRow(panel, 'Salary expectation')).toHaveAttribute('data-status', 'ask_user');
  });
});

test.describe('fixture 10: reload in the middle of step 3', () => {
  test('restores the step from what was already decided, without asking the model', async ({
    openFixture,
    request,
    apiKey,
  }) => {
    const { form, panel } = await openFixture('03-wizard');
    await reachThirdStep(panel);
    await expect(form.locator('[name="linkedin"]')).not.toHaveValue('');
    const requestsBefore = (await sentRequests(request, apiKey)).length;

    await form.reload();
    await expect(form.getByRole('tab', { selected: true })).toHaveText('Questions');
    await expect(form.locator('[name="linkedin"]')).toHaveValue('');
    await expect(panel.locator('[data-notice="page_reloaded"]')).toBeVisible();

    await panel.getByRole('button', { name: 'Read and fill again' }).click();
    await expect(panel.locator('[data-notice="page_reloaded"]')).toHaveCount(0);
    await waitForReview(panel, 3);

    await expect(form.locator('[name="linkedin"]')).toHaveValue(
      'https://www.linkedin.com/in/ana-example',
    );
    await expect(form.locator('[name="startDate"]')).toHaveValue('2027-01-04');
    await expect(form.locator('[name="euAuthorized"][value="yes"]')).toBeChecked();
    const requestsAfter = await sentRequests(request, apiKey);
    expect(requestsAfter.slice(requestsBefore).map(({ fields }) => fields)).toEqual([]);
  });
});

test.describe('fixture 11: final step with a Submit button', () => {
  test('stops at the final review and never clicks Submit', async ({ openFixture }) => {
    const { form, panel } = await openFixture('03-wizard');
    await reachThirdStep(panel);
    await nextStep(panel);

    await expect(panel.locator('[data-phase="FINAL_REVIEW"]')).toBeVisible({ timeout: 20_000 });
    await expect(form.getByRole('tab', { selected: true })).toHaveText('Review');
    await expect(form.getByRole('button', { name: 'Submit application' })).toBeVisible();
    // There is no way forward left for the extension: no "Next step" button at all.
    await expect(panel.getByRole('button', { name: 'Next step' })).toHaveCount(0);
    await expect(form.locator('#summary')).toContainText('"salary":"65000"');

    await panel.getByRole('button', { name: 'Mark as done' }).click();
    await expect(panel.locator('[data-phase="DONE"]')).toBeVisible();
    await expect(form.locator('#result')).toBeEmpty();
  });
});

test.describe('fixture 04: conditional field', () => {
  test('fills a field that only appears after another one is answered', async ({ openFixture }) => {
    const { form, panel } = await openFixture('04-conditional');
    await fillFromPanel(panel);

    await expect(form.locator('#employed')).toHaveValue('yes');
    await expect(form.locator('#notice')).toHaveValue('60 days');
    await expect(fieldRow(panel, 'Notice period')).toHaveAttribute('data-status', 'filled');
  });
});

test.describe('fixture 05: repeatable sections', () => {
  test('adds one block per resume entry and fills each with its own entry', async ({
    openFixture,
  }) => {
    const { form, panel } = await openFixture('05-repeatable');
    await fillFromPanel(panel);

    await form.getByRole('button', { name: 'Submit application' }).click();
    expect(JSON.parse(await form.locator('#result').innerText())).toEqual({
      companies: ['Acme Payments', 'Globex Retail'],
      titles: ['Senior Software Engineer', 'Full Stack Engineer'],
      schools: ['Example University'],
    });
  });

  test('does not add blocks again when the page is read a second time', async ({ openFixture }) => {
    const { form, panel } = await openFixture('05-repeatable');
    await fillFromPanel(panel);
    await panel.getByRole('button', { name: 'Read and fill again' }).click();
    await waitForReview(panel);

    await expect(form.locator('#work fieldset')).toHaveCount(2);
    await expect(form.locator('#education fieldset')).toHaveCount(1);
  });
});

test.describe('list that only grows once its last block is filled', () => {
  const JOBS = ['Acme', 'Globex', 'Initech', 'Umbrella', 'Hooli'].map((name, index) => ({
    name,
    position: `Engineer ${index + 1}`,
  }));
  const expected = JOBS.map(({ name, position }) => ({ position, company: name }));

  test('fills a block, adds the next and repeats until the resume is covered', async ({
    openFixture,
    sendToWorker,
  }) => {
    const { form, panel } = await openFixture('10-gated-list');
    await sendToWorker('resume/save', { ...exampleResume, work: JOBS });
    // The form starts with one empty block and its "Add" button disabled.
    await expect(form.getByRole('button', { name: 'Add another work experience' })).toBeDisabled();
    await fillFromPanel(panel);

    await expect(form.locator('.work-exp')).toHaveCount(5);
    await expect(panel.locator('[data-shortfall]')).toHaveCount(0);
    await form.getByRole('button', { name: 'Submit application' }).click();
    expect(JSON.parse(await form.locator('#result').innerText())).toEqual(expected);
  });

  test('builds the whole list again after the page lost it', async ({
    openFixture,
    sendToWorker,
  }) => {
    const { form, panel } = await openFixture('10-gated-list');
    await sendToWorker('resume/save', { ...exampleResume, work: JOBS });
    await fillFromPanel(panel);
    await expect(form.locator('.work-exp')).toHaveCount(5);

    await form.reload();
    await expect(form.locator('.work-exp')).toHaveCount(1);
    await expect(panel.locator('[data-notice="page_reloaded"]')).toBeVisible();
    await panel.getByRole('button', { name: 'Read and fill again' }).click();
    await expect(panel.locator('[data-notice="page_reloaded"]')).toHaveCount(0);
    await waitForReview(panel);

    await expect(form.locator('.work-exp')).toHaveCount(5);
    await form.getByRole('button', { name: 'Submit application' }).click();
    expect(JSON.parse(await form.locator('#result').innerText())).toEqual(expected);

    // And once more from nothing, with the step done over.
    await form.reload();
    await expect(panel.locator('[data-notice="page_reloaded"]')).toBeVisible();
    await panel.getByRole('button', { name: 'Start over' }).click();
    await expect(panel.locator('[data-notice="page_reloaded"]')).toHaveCount(0);
    await waitForReview(panel);
    await expect(form.locator('.work-exp')).toHaveCount(5);
  });
});
