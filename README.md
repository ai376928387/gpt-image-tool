# Image Generator App

A standalone local app for generating images from text prompts, with an optional uploaded reference image.

## Overview

This project has two parts:

- `client/` — a React + Vite UI for entering prompts, uploading one reference image, previewing results, and downloading the generated image.
- `gateway/` — a local Express server that accepts form submissions, keeps the provider API key on the local machine, forwards requests to the configured provider, and returns image results to the client.

The app runs locally and listens on localhost only:

- Client: `http://127.0.0.1:5173`
- Gateway: `http://127.0.0.1:3001`

## Requirements

- Node.js 20+
- npm
- A provider API key

## Setup

Create an `.env` file in `image-generator-app/` with at least:

```env
API_KEY=your_api_key_here
```

Optional provider settings:

```env
BASE_URL=https://api-xai.ainaibahub.com/v1
TEXT_MODEL=gpt-5.5
IMAGE_MODEL=gpt-image-2
IMAGE_SIZE=1024x1024
IMAGE_QUALITY=high
IMAGE_OUTPUT_FORMAT=png
```

Notes:

- `API_KEY` is required.
- The UI and gateway currently default `size` to `1024x1024`.
- The gateway currently uses the provider's `/responses` endpoint with an image-generation tool configuration.
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

1. The operator enters a prompt in the client UI.
2. The operator may optionally upload a single PNG, JPEG, or WebP reference image.
3. The client submits a `multipart/form-data` request to `POST /generate` on the local gateway.
4. The gateway validates the request, converts the uploaded image to a data URL when present, and sends the request to the configured provider.
5. The gateway normalizes the provider response into a browser-displayable image data URL.
6. The client displays the generated image and offers it as a direct download.

## Request Inputs

The gateway accepts these form fields on `POST /generate`:

- `prompt` — required text prompt
- `referenceImage` — optional PNG, JPEG, or WebP file
- `size` — optional image size string such as `1024x1024`
- `quality` — one of `auto`, `low`, `medium`, `high`
- `output_format` — one of `png`, `jpeg`, `webp`

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
      openai.ts
      server.ts
  tests/
  package.json
  playwright.config.ts
  CONTEXT.md
```

## Troubleshooting

- If the UI shows a provider error, expand the technical details panel in the client.
- If generation fails immediately, verify `API_KEY` is present in `.env`.
- If uploads fail, make sure the reference image is PNG, JPEG, or WebP and under the gateway upload limit.
- If the client cannot connect, confirm the gateway is running on `127.0.0.1:3001`.

## Notes For Development

- The gateway uses in-memory upload handling via `multer`.
- The client does not persist generation history.
- Generated images are intended for immediate preview and download in the current session.
