# Image Generator App

A standalone local app for generating, reviewing, and editing images through YAI Router's GPT Image 2-compatible API. It also exposes the gateway to Codex through a local stdio MCP server.

## Overview

This project has two parts:

- `client/` — a React + Vite UI for entering prompts, uploading one reference image, previewing results, and downloading the generated image.
- `gateway/` — a local Express server that accepts form submissions, keeps the provider API key on the local machine, forwards requests to the configured provider, and returns image results to the client.
- `.agents/skills/gpt-image-2-local/` — the project-scoped Codex skill that routes image tasks to MCP tools.
- `.codex/config.toml` — the project-scoped Codex MCP registration.

The app runs locally and listens on localhost only:

- Client: `http://127.0.0.1:5173` (由 `CLIENT_PORT` 配置)
- Gateway: `http://127.0.0.1:3001` (由 `GATEWAY_PORT` 配置)

## Requirements

- Node.js 20+
- npm
- A provider API key

## Setup

Create an `.env` file in the project root (`gpt-image-tool/`) with at least:

```env
XAI_API_KEY=your_yai_router_api_key_here
```

Optional provider settings:

```env
BASE_URL=https://api.yairouter.com/v1
CLIENT_PORT=5173
GATEWAY_PORT=3001
TEXT_MODEL=gpt-5.5
IMAGE_MODEL=gpt-image-2
IMAGE_SIZE=1024x1024
IMAGE_QUALITY=high
IMAGE_OUTPUT_FORMAT=png
MAX_REFERENCE_IMAGES=8
IMAGE_OUTPUT_DIR=.image-output
# MCP_GATEWAY_URL=http://127.0.0.1:3001
```

Notes:

- `XAI_API_KEY` is required. The legacy `API_KEY` name is still accepted as a fallback.
- `CLIENT_PORT` and `GATEWAY_PORT` are optional and default to `5173` and `3001`.
- `MAX_REFERENCE_IMAGES` defaults to `8`.
- `IMAGE_OUTPUT_DIR` defaults to `.image-output` for files created by the Codex MCP adapter.
- The UI and gateway default `size` to `1024x1024`.
- Simple generation uses `/images/generations`; editing uses `/images/edits`; visual review uses `/responses` with image inputs.
- The provider request timeout is 5 minutes.

## Install

Dependencies are already managed from the workspace root. If you need to install or refresh them:

```bash
npm install
```

Run this from `image-generator-app/`.

## Run

Start both the client and gateway together:

```bash
npm run dev
```

Or start them separately:

```bash
npm run dev:client
npm run dev:gateway
```

The Codex MCP adapter is started on demand by Codex. The gateway must already be running. After trusting/reloading the project in Codex, the `gpt_image_2_local` tools are available through the project MCP configuration. The project skill can be invoked explicitly with `$gpt-image-2-local` or selected implicitly for matching image tasks.

## Build

Build both workspaces:

```bash
npm run build
```

Build individual parts:

```bash
npm --prefix client run build
npm --prefix gateway run build
```

## Test

Run the Playwright end-to-end test suite:

```bash
npm run test:e2e
```

## How It Works

1. The operator enters a prompt in the client or asks Codex to use the local image skill.
2. The browser UI may upload one reference image; Codex MCP accepts one or more absolute local image paths.
3. The gateway validates the request and keeps the provider key server-side.
4. Generation calls `/images/generations`; edits call `/images/edits` with repeated `image[]` parts and an optional alpha-channel PNG mask; review calls `/responses` with `input_image` content.
5. The gateway normalizes provider output into an image data URL or review text.
6. The browser displays the result, while MCP saves generated images under `.image-output/` and returns both the path and image content to Codex.

## Request Inputs

The gateway accepts these form fields on `POST /generate`:

- `prompt` — required text prompt
- `referenceImage` — optional PNG, JPEG, or WebP file
- `size` — optional image size string such as `1024x1024`
- `quality` — one of `auto`, `low`, `medium`, `high`
- `output_format` — one of `png`, `jpeg`, `webp`

Additional local gateway routes:

- `POST /api/images/generate` — JSON body with `prompt`, `size`, `quality`, and `output_format`
- `POST /api/images/edit` — multipart body with `prompt`, one or more `image[]` files, and an optional `mask` PNG
- `POST /api/images/review` — multipart body with one or more `image[]` files and an optional `review_focus`
- `GET /health` — local gateway health and non-secret configuration status

## Codex MCP tools

The project MCP server exposes:

- `generate_image({ prompt, size?, quality?, output_format? })`
- `edit_image({ prompt, image_paths, mask_path?, size?, quality?, output_format? })`
- `review_image({ image_paths, review_focus? })`

`image_paths` and `mask_path` must be absolute local paths. Masks must be PNG files with an alpha channel; the provider applies a mask to the first input image.

Examples:

```text
Generate a cinematic product hero image of a translucent glass tea bottle on wet black stone.
```

```text
Review these images for composition and typography:
D:\\Images\\poster-a.png
D:\\Images\\poster-b.png
```

```text
Edit D:\\Images\\scene.png with D:\\Images\\scene-mask.png. Change only the masked background area and preserve the subject and all unmasked content.
```

## Project Structure

```text
image-generator-app/
  client/
    src/
      App.tsx
      index.css
      main.tsx
      promptCatalog.ts
  gateway/
      src/
        mcp-server.ts
        openai.ts
        server.ts
  .agents/
    skills/
      gpt-image-2-local/
        SKILL.md
  .codex/
    config.toml
  tests/
  package.json
  playwright.config.ts
  CONTEXT.md
```

## Troubleshooting

- If the UI shows a provider error, expand the technical details panel in the client.
- If generation fails immediately, verify `XAI_API_KEY` is present in `.env` or in the shell environment.
- If uploads fail, make sure the reference image is PNG, JPEG, or WebP and under the gateway upload limit.
- If the client cannot connect, confirm the gateway is running on `127.0.0.1` and that its configured `GATEWAY_PORT` is available.

## Notes For Development

- The gateway uses in-memory upload handling via `multer`.
- The client does not persist generation history.
- Generated images are intended for immediate preview and download in the current session.
