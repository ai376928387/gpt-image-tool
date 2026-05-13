# Internal Image Tool

This context covers the operator-only standalone local app for generating and downloading images. Its key boundary is that it runs separately from the public website and uses a local provider gateway rather than a shared backend.

## Language

**Internal image tool**:
An operator-only workspace for generating and downloading images for internal use.
_Avoid_: public feature, website tool, customer tool

**Standalone local app**:
A separately run local application that is not mounted inside the public website.
_Avoid_: hidden route, private page inside the website, internal tab

**Local Node server**:
A machine-local server process that supports the standalone app without becoming a shared backend.
_Avoid_: remote backend, public API server

**Provider Gateway**:
The local Node server boundary that holds provider credentials, forwards generation requests to the AinaibaHub responses API, and returns image results.
_Avoid_: full backend, job system, content library

**Reference image**:
A single optional uploaded image that guides generation without promising direct editing of the uploaded image.
_Avoid_: source image, editable original, multi-image set

**Generation result**:
A one-time image output used for immediate preview and download in the current session.
_Avoid_: asset library item, saved history record

**Download result**:
A direct download of the current generation result using an automatic filename.
_Avoid_: export job, save preset

**Operator error**:
A concise user-facing failure message for the operator, optionally paired with expanded technical details.
_Avoid_: raw log dump, provider contract

**Provider configuration**:
Environment-driven settings that define the AinaibaHub base URL, the top-level text model, and the image_generation tool model used by the provider gateway.
_Avoid_: operator setting, UI form field

**Sample prompt**:
A static example prompt embedded in the UI to help the operator start quickly.
_Avoid_: template, managed prompt asset

**Upload reference image**:
A local file-selection action that provides zero or one reference image to a request.
_Avoid_: drag-and-drop intake, pasted image, URL import

**Launch command**:
A single operator-facing command that starts the standalone local app, even if multiple local processes run underneath.
_Avoid_: manual multi-step startup, installer workflow

**Regenerate**:
A repeat generation action that reuses the current operator workflow without creating saved history.
_Avoid_: save and rerun, queued retry

**Technical details**:
Expandable provider-facing failure details shown beneath a concise operator error.
_Avoid_: default primary error copy, log stream

**Localhost-only**:
A runtime binding model where the local app and provider gateway listen only on the operator's machine.
_Avoid_: LAN tool, shared internal service

**Clean cutover**:
A one-time migration that removes the website-hosted image tool when the standalone local app replaces it.
_Avoid_: parallel run, dual maintenance period

## Relationships

- The **Internal image tool** is separate from the **Public website**
- The **Internal image tool** should be delivered as a **Standalone local app** rather than a route inside the **Public website**
- The **Standalone local app** lives alongside the website project in the same workspace rather than inside the website app
- The **Standalone local app** may use a **Local Node server**
- The **Local Node server** acts as a **Provider Gateway**
- The **Provider Gateway** holds provider credentials and forwards generation requests without owning product data
- **Provider configuration** is fixed by environment settings rather than operator input
- **Sample prompts** are static UI helpers rather than managed assets
- The operator uses one **Launch command** to start the local app
- The local app is **Localhost-only**
- Migration from the website-hosted tool to the standalone app should happen as a **Clean cutover**
- A request contains a prompt and zero or one **Reference image**
- A **Reference image** enters the request through **Upload reference image**
- If a request includes a **Reference image** and the provider rejects it, the request fails rather than silently degrading to prompt-only generation
- A request produces one **Generation result**
- A **Generation result** may be turned into a **Download result**
- After success, the operator may **Regenerate** or create a **Download result**
- An **Operator error** may include expandable **Technical details**

## Example dialogue

> **Dev:** "Should we link the internal image tool from the public website?"
> **Domain expert:** "No — the internal image tool is operator-only and must stay separate from the public website."
>
> **Dev:** "Can we still keep it as a hidden route inside the site?"
> **Domain expert:** "No — it should run as a standalone local app, not as a route inside the public website."
>
> **Dev:** "Does the local Node server own history and content management?"
> **Domain expert:** "No — it acts as a provider gateway and only protects credentials and forwards image-generation requests."
>
> **Dev:** "If the operator uploads one reference image, do we treat it as a source image edit?"
> **Domain expert:** "No — the reference image only guides generation. The request still yields a one-time generation result for immediate preview and download result."
>
> **Dev:** "If the provider rejects the reference image, do we silently continue with prompt-only generation?"
> **Domain expert:** "No — the whole request fails, and the operator sees an operator error with optional technical details."

## Flagged ambiguities

- "local app" was resolved to mean an internal image tool, not a public website feature
- "internal" was resolved to mean a standalone local app, not a hidden route inside the website
- "no backend" was resolved to mean no remote backend; a local Node server is allowed
- "reference image" was resolved to mean guidance input, not source-image editing
- "download" was resolved to mean a direct download result, not an export workflow
- "error details" was resolved to mean concise operator error copy with optional technical details
