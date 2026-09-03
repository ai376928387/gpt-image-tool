---
name: gpt-image-2-local
description: Generate, review, or edit raster images through this project's local GPT Image 2 MCP service, including multiple reference images and masked point edits.
---

# Local GPT Image 2

Use this skill when the user asks to generate an image, inspect an image visually, create variants, edit an existing image, combine reference images, or make a targeted/masked edit.

The MCP server is named `gpt_image_2_local`. It connects to the gateway already running on `GATEWAY_PORT` (default `3001`). Do not expose or request the provider API key in chat.

## Route the request

- New image from a prompt: call `generate_image`.
- Visual critique, prompt alignment, or art direction: call `review_image`.
- Any change to an existing image, combining references, or a local/masked edit: call `edit_image`.
- If the user explicitly asks to review and then revise, review first and use the returned edit prompt for the next edit call.

## Image inputs

- Pass local absolute paths in `image_paths`.
- `image_paths` may contain multiple PNG, JPEG, or WebP files. Keep the order meaningful: the first image is the primary image and the remaining images are references.
- For a targeted edit, pass `mask_path` as a same-size PNG with an alpha channel. The mask applies to the first image. State that unmasked regions should remain unchanged.
- If the user supplied an attachment but no usable local path is available, ask for the absolute path instead of pretending the attachment was sent to the MCP tool.

## Prompt behavior

- Preserve the user's creative intent and language. Add only the minimum operational detail needed to protect identity, composition, typography, or unmasked areas.
- For edits, explicitly distinguish what must change from what must stay unchanged.
- Do not claim that a mask guarantees pixel-perfect boundaries; use it as spatial guidance and reinforce the intended region in the prompt.
- Use the requested `size`, `quality`, and `output_format` when provided. Otherwise let the tool use its configured defaults.

## Variants and subagents

When the user requests independent alternatives, use one generation/edit call per materially different direction. Codex may delegate independent variants to subagents and combine the results, but default to no more than three variants unless the user asks for more. Do not launch duplicate calls for a single requested image.

## Results and failures

- The tool saves generated images under `.image-output/` and returns an absolute path plus image content. Show the result using that path and identify whether it was generated or edited.
- Keep the provider's base64 payload out of the response; mention the saved file path instead.
- If the gateway is unavailable, tell the user to start it with `npm run dev:gateway` from the project root, then retry.
- If the provider rejects a mask, explain that the mask must be PNG, include an alpha channel, and match the first image's dimensions.

## Examples

```text
Generate a cinematic product hero image of a translucent glass tea bottle on wet black stone.
```

```text
Review these three poster options for hierarchy, typography, and prompt alignment:
D:\\Images\\poster-a.png
D:\\Images\\poster-b.png
D:\\Images\\poster-c.png
```

```text
Edit D:\\Images\\scene.png using D:\\Images\\scene-mask.png. Replace only the masked background area with a blue-hour city skyline; preserve the subject, camera angle, lighting on the subject, and all unmasked pixels as closely as possible.
```
