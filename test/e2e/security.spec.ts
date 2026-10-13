import { expect, fillFromPanel, test } from './extension';

test.describe('what a web page can reach', () => {
  test('a script running inside the page cannot read the stored data', async ({
    openFixture,
    context,
  }) => {
    const { form } = await openFixture('01-plain');
    const [worker] = context.serviceWorkers();

    // Runs in the content-script world of the page: the most a compromised page could reach.
    const reached = await worker?.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      const tabId = tabs.find((tab) => tab.url === url)?.id;
      if (tabId === undefined) throw new Error('Fixture tab not found');
      const [injection] = await chrome.scripting.executeScript({
        target: { tabId },
        func: async () => {
          const ask = (type: string) =>
            chrome.runtime
              .sendMessage<unknown, unknown>({ type, payload: undefined })
              .then((reply) => (reply === undefined ? 'no answer' : 'answered'))
              .catch(() => 'no answer');
          const storage = await chrome.storage.local
            .get(null)
            .then(() => 'readable')
            .catch(() => 'blocked');
          return {
            resume: await ask('resume/get'),
            settings: await ask('settings/get'),
            answers: await ask('answers/list'),
            storage,
          };
        },
      });
      return injection?.result;
    }, form.url());

    expect(reached).toEqual({
      resume: 'no answer',
      settings: 'no answer',
      answers: 'no answer',
      storage: 'blocked',
    });
  });

  test('a working run can be stopped from the panel', async ({ openFixture, sendToWorker }) => {
    // A long delay between fields keeps the run busy long enough to stop it by hand.
    const { form, panel } = await openFixture('01-plain');
    await sendToWorker('settings/save', { fillDelayMs: 2000 });
    await panel.getByRole('button', { name: 'Fill this page' }).click();
    await expect(form.locator('#first')).toHaveValue('Ana');
    await panel.getByRole('button', { name: 'Stop' }).click();

    await expect(panel.locator('[data-notice="cancelled"]')).toBeVisible({ timeout: 20_000 });
    await expect(panel.locator('[data-phase="WAITING_USER_REVIEW"]')).toBeVisible();
    await expect(form.locator('#result')).toBeEmpty();
  });
});

test('the run is not confused by a later, different application in the same tab', async ({
  openFixture,
}) => {
  const { form, panel } = await openFixture('02-react');
  await fillFromPanel(panel);
  await expect(form.getByLabel('About you')).toHaveValue('Draft written for Ana Example.');

  // Same portal and form under another address: nothing typed before may be reused silently.
  await form.goto(form.url().replace('/fixtures/', '/alt/fixtures/'));
  await expect(form.getByLabel('About you')).toHaveValue('');
  await panel.getByRole('button', { name: 'Read and fill again' }).click();
  await expect(panel.locator('.step-title')).toContainText('Step 1');
  await expect(panel.locator('[data-phase="FINAL_REVIEW"]')).toBeVisible({ timeout: 20_000 });
  await expect(form.getByLabel('First name')).toHaveValue('Ana');
});
