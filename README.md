# CV Autofill

A Chrome extension (Manifest V3) that fills in job application forms from a structured resume.

It has no per-site rules. It reads whatever form is on screen in a generic way, asks a large language model what belongs in each field, fills the fields in, and shows you what it did. It works one step at a time, waits for your review before moving on, and **never submits the application**: the final click is always yours.

## Why

Many employers ask you to retype your whole resume into their own portal, and the "import from CV" features of those portals tend to be poor. This extension does the typing for you on portals it has never seen before.

## What it does

- **Reads any form generically.** It resolves each field's label from `<label for>`, a wrapping label, `aria-labelledby`, `aria-label`, a label placed beside the field, the placeholder or the nearest visible text. It ignores invisible, disabled, hidden and password fields.
- **Handles real-world widgets.** Native inputs, selects, radio groups, checkboxes, textareas, file uploads, and custom comboboxes (ARIA `combobox`/`listbox`/`option`), including ones that only list options while open or that only suggest and accept free text.
- **Works with reactive frameworks.** Values are set through the native setter and followed by the events React, Vue and Angular listen for.
- **Reaches into open shadow DOM and iframes**, including iframes from another origin, once you grant access to that origin.
- **Only fills what you can see.** Fields that are transparent, parked off-screen or otherwise hidden are skipped, whatever they are labelled, so a page cannot collect your data behind your back.
- **Never invents data.** A field the resume does not answer is handed to you as a question. Values for selects, radios and comboboxes must be one of the options the form offers.
- **Copies your resume as written.** Names, titles and descriptions go in word for word, in the language of your resume.
- **Corrects itself from validation errors.** If the page rejects a value (a date format, for instance), the error message goes back to the model for a corrected value, at most twice per field.
- **Walks multi-step forms.** It finds the "Next" button in several languages, waits for the step to change, and stops at the final review. Only a button whose own text says "next" is ever clicked; a button of unknown purpose never is.
- **Fills repeatable sections.** It clicks "Add" until there is one block per work experience, degree, certificate or language in your resume, including on forms that only allow a new block once the previous one is filled in.
- **Resumes after a reload.** What was already decided is restored without asking the model again.
- **Learns.** Answers you give to questions outside your resume are kept in an answer bank. Field mappings confirmed on a site are cached, so the next application on that site needs few or no model calls.
- **Attaches your resume file** to upload fields.
- **English and Portuguese interface.**

## How it works

| Part           | Role                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Service worker | Orchestrates each run. The only part that calls the LLM provider and reads or writes storage.        |
| Content script | Injected only when you activate the extension on a tab. Reads the form, fills fields, clicks "Next". |
| Side panel     | Shows progress and every field with its value, origin and status. Where you answer and confirm.      |
| Options page   | API key, model, resume JSON, resume file, answer bank and per-site cache.                            |

A run moves through explicit states:

```
IDLE → EXTRACTING → MAPPING → FILLING → VALIDATING → WAITING_USER_REVIEW → ADVANCING → (next step) … → FINAL_REVIEW → DONE
```

Submitting is not one of them. A button whose text may submit or send the application is never offered as a way forward, and is refused again at the moment of the click.

## Requirements

- Chrome 116 or later.
- Node.js 22.12 or later, to build.
- An [Anthropic API](https://console.anthropic.com) key. The extension calls the Messages API and uses `claude-sonnet-5-5` by default; you can choose another model in the options. Usage is billed by Anthropic to your account, separately from any Claude subscription.

## Install

```bash
npm install
npm run build
```

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and choose the `dist/` folder.
3. Pin the extension, click its icon to open the side panel, then **Open options**.

After changing the code, run `npm run build` again and press the reload button on the extension's card.

## Set up

On the options page:

1. **LLM provider** — paste your Anthropic API key (it starts with `sk-ant-`). It is stored only in this browser and is never shown again.
2. **Resume** — paste your resume as JSON and click **Validate and save**. **Load example** fills in [`examples/resume.example.json`](examples/resume.example.json) as a starting point.
3. **Resume file** — choose the PDF to attach to upload fields (up to 4 MB).
4. **Behavior** — language, delay between fields, and automatic advance.

### Resume format

The resume follows [JSON Resume](https://jsonresume.org/schema). Only `basics.name` and `basics.email` are required. Dates are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`. Unknown properties are kept and sent to the model, so you can add any detail you want it to know.

What the standard does not cover goes under `x-extra`:

```json
{
  "x-extra": {
    "nationality": ["Portuguese"],
    "dateOfBirth": "1990-01-31",
    "availability": "Immediately",
    "noticePeriod": "60 days",
    "workAuthorization": ["European Union"],
    "links": [{ "label": "Portfolio", "url": "https://example.com" }]
  }
}
```

The more your resume says, the fewer questions you are asked.

## Use

1. Open the application form in a tab.
2. Click the extension icon **with that tab in focus** (or press `Alt+Shift+A`). That click is what grants the extension access to the page; without it, nothing is read or changed.
3. In the side panel, click **Fill this page** (`Alt+Shift+F`). Optionally paste the job description first; it grounds generated answers such as cover letters.
4. Review the list. Fields that need you come first and can be answered right there; your answer is typed into the page and kept in the answer bank.
5. Click **Next step** (`Alt+Shift+N`). The extension reads and fills the next step, then stops again.
6. On the last step the panel shows **Final review**. Submit the form yourself.

Shortcuts can be changed at `chrome://extensions/shortcuts`.

### Field statuses

| Status            | Meaning                                                                                |
| ----------------- | -------------------------------------------------------------------------------------- |
| Filled            | The value was applied. Shows where it came from: the model, the cache, or your answer. |
| Review            | Generated text, or anything worth a second look. Read it before moving on.             |
| Needs your answer | Neither the resume nor the answer bank covers the question.                            |
| Could not fill    | The page rejected the value even after two corrections; its message is shown.          |
| Do it manually    | An upload with no file stored, or one the site did not accept.                         |
| Skipped           | Optional with nothing applicable, or already correct.                                  |

### Buttons in the side panel

- **Read and fill again** does the current step over from nothing: it forgets what was decided for it, empties the text the extension typed, and decides every field again without the cache. What you typed stays. After a page reload, the same button restores the step instead, without calling the model.
- **Start over** discards everything decided in the whole application.
- **Stop** appears while the extension is working. It ends the run before the next field and leaves the page as it is.
- **Copy diagnostics** copies a description of the run (what was read, decided and done) to paste into a bug report. By default it leaves out the values that went into the form and the query of the page address; tick the box beside it to include them, and check the result before sharing.

## Privacy

- The only network calls the extension makes are to the LLM provider (`api.anthropic.com`).
- Each call carries: the description of the visible fields (type, label, options, validation message), your resume, your answer bank and, if you pasted one, the job description. When several buttons read like "Next", their texts are sent too.
- A field's current value is sent only when the extension itself filled it or when it is a choice among the page's own options. Text you typed by hand, or that the site filled in from your account, is replaced by a marker saying the field is already answered.
- It never sends the page's HTML, selectors, cookies, hidden fields or password fields.
- Your API key, resume, resume file, answers and cache live in `chrome.storage.local`, in your browser profile. They are not encrypted beyond what your operating system and Chrome provide.
- The API key and the resume are never written to logs.
- Nothing runs on a page until you activate the extension on that tab.
- Scripts running inside web pages cannot read the extension's storage or ask its service worker for your data: storage is restricted to the extension's own pages, and requests are only served to them.
- Consent and agreement checkboxes are never ticked for you. That is enforced in code, not left to the model.

Your resume is personal data and it is sent to a third-party service on every run. Read [Anthropic's privacy policy](https://www.anthropic.com/legal/privacy) before using the extension.

## Permissions

| Permission                          | Why                                                                                                                                               |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `storage`                           | Keep settings, API key, resume, answers and cache in the browser                                                                                  |
| `sidePanel`                         | Show the side panel                                                                                                                               |
| `activeTab`                         | Access only the tab you activated the extension on, until you leave it                                                                            |
| `scripting`                         | Inject, into that tab, the script that reads and fills the form                                                                                   |
| Host of the LLM provider's API      | The extension's only network destination                                                                                                          |
| Optional hosts, requested on demand | Read a frame from another site embedded in the form, one origin at a time. Given back when the application is marked as done or its tab is closed |

The extension declares no permanent access to any site and exposes no resources to pages.

## Limitations

- **Custom date pickers.** The extension types the date and fixes the format from the page's error message. It does not navigate calendars that only accept clicks.
- **Closed shadow DOM** is not read.
- **The final step is recognised by signs on the page**: a button whose text submits, sends or confirms (in English, Portuguese, Spanish, French, German and Italian), the last position of a stepper, or a title such as "Review". When in doubt a button is treated as submitting and is not clicked. A form whose last button says only "Continue", with no stepper and no such title, is not recognised as final; this is why the default is to stop for your review at every step.
- **Steps without a recognisable "Next" button** are not advanced: click it on the page yourself, then read the new step.
- **Fields covered by another element** are not detected as hidden.
- **Repeatable sections** are recognised by their "Add" button and section title, in the same languages.
- **Verbatim copying is an instruction to the model**, not a check in code. Long text fields are flagged for review for that reason.
- **Model output varies.** The same form can be filled slightly differently on two runs. Always review before submitting.
- **Cost.** Each pass over a step is one model call that includes your resume. Long lists that grow one block at a time take one call per block. Automatic advance stops after 20 steps.
- **Long model calls.** Chrome may stop an extension's service worker when a network response takes more than about 30 seconds. A very large step can hit that; the panel then reports the run as interrupted and reading the page again resumes it.
- An application is identified by the full address where the run started. Portals that reuse one address for different jobs may need **Start over**.

## Development

| Command                  | What it does                                                           |
| ------------------------ | ---------------------------------------------------------------------- |
| `npm run dev`            | Development build with reload                                          |
| `npm run build`          | Type-check and production build into `dist/`                           |
| `npm test`               | Unit tests with coverage (80% minimum)                                 |
| `npm run test:e2e`       | Builds a test version and runs end-to-end tests in a real Chromium     |
| `npm run lint`           | ESLint and Prettier                                                    |
| `npm run check:mentions` | Checks that the provider's name appears only in its configuration file |

The end-to-end tests need Playwright's Chromium once: `npx playwright install chromium`.

They load a separate build (`dist-e2e/`) that talks to a local stand-in for the LLM provider, so they need no API key and cost nothing. The pages they fill are in [`test/fixtures/pages`](test/fixtures/pages): a plain form, React controlled inputs, a four-step wizard, a conditional field, repeatable sections, a searchable combobox, shadow DOM, a cross-origin iframe, validation errors, and a list that only grows once its last block is filled.

### Project layout

```
src/
  background/   service worker: orchestrator, LLM client and mapper, storage
  content/      extractor, filler, validation, step navigation, repeatable sections
  sidepanel/    side panel UI
  options/      options page UI
  shared/       types, messages, state machine, i18n
test/
  unit/         Vitest
  e2e/          Playwright specs, test server and stand-in LLM
  fixtures/     pages the end-to-end tests fill
```

Design decisions and the reasons behind them are recorded in [`docs/decisions.md`](docs/decisions.md).

### Using another LLM provider

Everything specific to Anthropic is in [`src/background/llm/provider-config.ts`](src/background/llm/provider-config.ts) (endpoint, default model, headers) and in the request and response shapes in [`src/background/llm/client.ts`](src/background/llm/client.ts). The rest of the code depends only on the `LlmClient` interface: a function that takes a system prompt, a user message and a JSON Schema, and returns JSON. By convention the provider is named only in that configuration file and in this README; `npm run check:mentions` enforces it.

## Contributing

Issues and pull requests are welcome. Before opening a pull request, run:

```bash
npm run lint
npm test
npm run test:e2e
```

When a form is not filled correctly, **Copy diagnostics** in the side panel is the most useful thing to attach. Remove personal data from it first. Fixes should stay generic: no rules for a specific site.

## Disclaimer

This is an independent project and is not affiliated with any job portal or applicant tracking system. Automating form filling may be restricted by the terms of some sites; check them before use. You are responsible for reviewing everything before you submit an application. The software is provided as is, without warranty of any kind.

## License

[MIT](LICENSE)
