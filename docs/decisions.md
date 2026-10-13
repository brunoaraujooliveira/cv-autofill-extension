# Design decisions

The choices made where the requirements left room, each with its reason. Several came from running the extension against real portals; those say so.

## Build and stack

- **Vite with `@crxjs/vite-plugin`.** The plugin reads the typed manifest, resolves the entry points (service worker, content script, HTML pages) and gives hot reload in development. Configuring several bundler entries by hand costs more and gains nothing.
- **Preact** for the options page and the side panel. It weighs a few kilobytes and spares managing the DOM by hand in the side panel's lists.
- **Zod** for every contract that crosses a boundary: storage, messages, the model's answer.
- **TypeScript 6** rather than the newest release, because `typescript-eslint` does not accept the next one yet.
- **npm** as the package manager.
- The service worker's entry file is `service-worker.ts`, not `index.ts`: with two entry files named `index.ts`, the build plugin loaded the content script in place of the service worker.

## Architecture

- **The service worker is the only part that touches storage and the LLM provider.** The options page, the side panel and the content script talk to it through typed messages (`src/shared/messages.ts`).
- `src/ui/` holds what the options page and the side panel share: language context, messaging client, base CSS.
- The tab gateway has its interface in `tab-gateway.ts` and its Chrome implementation in `chrome-tab-gateway.ts`, so the orchestrator can be tested without a browser.
- **Iframes.** The content script is injected into every frame the extension can access. Each frame describes itself and the service worker merges them into one step.
- The content script is an IIFE injected with `chrome.scripting` on every activation; a flag keeps it from registering its listener twice. The build removes `web_accessible_resources` from the manifest: it is not needed, and it would let any site detect the extension.

## LLM provider

- Everything specific to the provider (endpoint, default model, header names) lives in `src/background/llm/provider-config.ts`. The manifest imports the host from that file. The provider is named there and in the README, where users need to know which key to get; the rest of the code, the interface and the documentation say "LLM provider".
- `npm run check:mentions` fails if the provider's name shows up anywhere else.
- The API key lives only in `chrome.storage.local` and is never sent back to the interface: pages only learn whether a key is stored.

## Mapper

- **Structured output with a JSON Schema instead of a forced tool call.** The default model does not accept forcing a tool call; structured output gives the same guarantee about the format. The answer still goes through Zod.
- Beyond the format, every decision is checked against its field: a value for a select, radio or combobox must be one of the options (and is rewritten to the option's exact text), a checkbox only takes a boolean, text cannot be empty. When something fails, the mapper asks once more, saying what was wrong; whatever is still invalid becomes "ask the user". A value the field cannot take never reaches the page.
- Generated free text always carries `needsReview`.
- **Resume content is copied as written**, in the resume's language, whatever the language of the form. This is an instruction to the model, not a check in code, which is one reason long text fields are flagged for review.
- The model's effort is set to `medium`: this is a matching task, and the user is waiting.
- HTTP 429, 5xx and network errors are retried up to three attempts, honouring `retry-after`.

## Reading the form

- A radio group is **one** field, with the labels of its radios as options.
- A select is described by the **text** of its options, not their `value`: that is what the user sees and what the model can compare with the resume.
- Radios and checkboxes whose native input is hidden count as visible when their label is.
- Password fields are never read or filled.
- **Custom comboboxes.** When the options are not in the DOM, the extension opens the popup to read them (up to 150) and closes it. When nothing shows up (a remote search), the field goes on without options.
- **A placeholder that only shows a format is not a label.** `dd-mm-yyyy` says how to answer, not what is asked, so the text beside the field wins. A field known only by a format never enters the cache or the answer bank: it would match every other date field. _(From a real portal, where the applicant's birth date ended up in every date field.)_
- **A `<label>` placed beside the control but not wired to it** (no `for`, or a `for` that points nowhere) outranks the placeholder, which on such forms is usually an example of what to type. Loose text beside the field still ranks below the placeholder. _(From a real portal.)_
- **Nearby text does not cross another field.** If what comes before already belongs to another control, the field is left without a label rather than inheriting its neighbour's.
- **Buttons do not have to be `<button>`.** Many sites use styled `<div>` or `<a>` elements. Besides real buttons, the extension accepts elements with "btn" or "button" in their class, links without a real destination and, without relying on names, any element the page made clickable (pointer cursor) that holds nothing but a short text. The innermost such element counts, and never one that contains form fields. Classification is the same, so a "Submit" made of a `<div>` is not clicked either. _(From a real portal.)_
- **Buttons injected by other browser extensions** (grammar checkers, password managers) are ignored.

## Filling

- Text is set through the prototype's value setter and followed by `input`, `change` and `blur`, so frameworks that track the value notice the change.
- Radios and checkboxes are clicked rather than assigned.
- **A combobox with no list of options accepts typed text.** If no suggestion matches, the typed text stands as the answer; if the field erases it on losing focus, that is a failure. Where there is a closed list, only what is on the list counts. _(From a real portal.)_
- A native `input type="date"` only takes `YYYY-MM-DD`; the format is passed to the model as a hint and checked before filling.
- **Custom date pickers have no "use the picker" fallback.** The extension types the date; if the page rejects it, the error goes back to the model to fix the format and, once corrections run out, the field goes to the user. Driving arbitrary calendars by clicks is not reliable without per-site rules.
- The resume file is attached to upload inputs through a `DataTransfer`. If the page does not keep it, the field is handed to the user.

## Validation and correction

- A field's error message is read, in order, from: `aria-errormessage`; `aria-describedby`, when the field is `aria-invalid` or the element looks like an error; an error element in the smallest wrapper that holds only that field; and finally the browser's own validity.
- A required field left empty is not an error: it is a question not answered yet.
- A field is filled at most three times: the first try and two corrections. After that it becomes "needs your answer", with the page's message.
- Every step is read again after filling. That is how both errors and conditional fields are found.

## Steps and navigation

- The state machine is in `src/shared/run-machine.ts`, not under `content/`: the service worker drives it. It is a pure function, testable without a DOM. There is a single way into `ADVANCING`: the `CONFIRM` event from `WAITING_USER_REVIEW`.
- **Submit is never clicked, in three layers.** The machine has no submit event; the orchestrator never offers a button classified as submit, not even to the model; and the content script classifies the button again at the moment of the click and refuses.
- A button is "submit" if its text holds any submit word, even when it also holds "continue". Erring towards not clicking costs the user one click.
- A step whose only way forward is to submit goes straight to the final review, single-page forms included.
- The model is only asked about buttons when there is more than one "next" candidate or no recognised button.
- A step change is detected through DOM mutations (a different address or a different set of fields). The 15-second timeout is only a safety limit. When the click loads another document, the service worker waits for the tab to finish loading.
- The limit on passes over one step (40) is only a safety net. What ends the passes is running out of work: corrections are capped per field and blocks by the size of the resume.

## Repeatable sections

- The extension clicks "Add" until there is one block per resume entry.
- **What a button repeats** comes from the button's own text. The section heading only adds to it when both talk about the same thing, so "Courses and certifications" counts for "Add another course" but not for "Add another language" on the same page. _(From a real portal.)_
- **A section that mixes kinds** (courses and certifications in one list) gets one block per entry of each kind.
- **Existing blocks** are counted in what comes before the "Add" button, never past another "Add" button, which is another list.
- **Blocks with no label of their own** (several "Course, Institution" under a single heading) are told apart by structure: the question asked most often marks the blocks, and each block is the branch of their common ancestor that holds one occurrence. Each gets a numbered group, so the model can match it to a different resume entry.
- **The page is read again after each list**, because adding blocks moves the "Add" buttons that come after them.
- **Lists that only grow once the last block is filled.** Some forms show "Add" disabled, or swap the button for another element, while the last block is empty. So the button is looked for again after every pass that filled something, not only when an earlier attempt failed. _(From a real portal; fixture 10 reproduces it.)_
- **A new block with a known identity.** A block added just now can have the same selector and label as a field decided on an earlier reading. It counts as pending work while it is empty on the page, even though it already has a decision.
- **The ceiling on added blocks is per reading of a step.** The page's own count decides how many are missing; what was already added only stops a list that cannot be counted from growing past the resume. Keeping that number across readings blocked later runs: after blocks were deleted or the page reloaded, the extension believed it had added everything.

## Resuming and doing over

- Everything decided is kept by field identifier. When a step is read again, what the page lost is put back without asking the model.
- A run is keyed by the host and path where it started, with the tab id only as an index, so it can be resumed after the tab is closed. It expires after seven days and is deleted when marked as done.
- Writes of the run state are queued, so updates published in quick succession never overwrite each other.
- **"Read and fill again" does the step over.** Reapplying old decisions repeated the same mistakes. The button forgets the decisions, results and correction counts of the fields on the step, empties the text fields the extension itself filled (a wrong value must not linger when the new decision is "ask"), skips the cache for that pass and asks the model again. The user's own answers and choice fields are not emptied. The exception is a reloaded page: there the same button restores, which is what the notice promises.
- **"Copy diagnostics"** produces a description of a run (what was read, decided and done), to investigate a failure without access to the page.

## Cache and answer bank

- The cache keeps, per site, the **value** that went into each field, where it came from (a path in the resume or an answer from the bank) and a hash of that data. When the data changes, the entry stops being valid. Keeping only the path would not do: the final value is often transformed (a country spelled out, a date in the field's format).
- A field's key is its type, label and position in its section, not its selector, so it holds for another job on the same portal.
- A lookup prefers the same step and falls back to other steps of the same site, because conditional fields change a step's signature.
- Never cached: generated text, fields showing an error, open questions, and answers given for one form only.
- The answer bank keeps what the user answers in the side panel, except checkboxes (consent) and uploads. Matching a question worded differently is left to the model, which receives the bank; there are no local embeddings.
- The resume file is kept in `chrome.storage.local` (4 MB limit) rather than IndexedDB: it fits comfortably and uses the same testable repository as the rest.

## Permissions

- `activeTab` and `scripting`: code is only injected into a tab when the user clicks the icon or uses a shortcut. The side panel is opened from the click handler (`chrome.action.onClicked`) because that event is what grants `activeTab`.
- A fixed host permission only for the LLM provider's API.
- `optional_host_permissions`, requested at run time, one origin at a time, when the page embeds a frame from another site that holds part of the form.

## Language

- Code and identifiers in English.
- Interface in English and Portuguese, chosen in the options (`auto` follows the browser). `chrome.i18n` cannot switch language at run time, so the messages live in `src/shared/i18n/`.

## Resume

- Based on JSON Resume, with `x-extra` for what the standard does not cover.
- Required: `basics.name` and `basics.email`. Everything else is optional and unknown properties are kept.
- Dates are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`.
- URLs are not validated, so values like `linkedin.com/in/user` are accepted.

## Tests

- Vitest with happy-dom for unit tests. The test DOM has no layout, so visibility checks take an injectable probe.
- End-to-end tests use Playwright with the built extension loaded in a real Chromium. The LLM is replaced by a deterministic local HTTP server; the `--mode e2e` build points the client at it, adds `http://localhost/*` to the manifest and writes to `dist-e2e/`, so it can never be mistaken for the `dist/` meant for real use.
- The fixtures are a small Vite site in `test/fixtures/pages`, served by the same local server.
- In the tests the side panel is opened as a regular page with `?tabId=`, because Playwright cannot click the extension's icon.
