# synthframe-worker

Cloudflare Worker used by the Synthframe API for image generation, image analysis, prompt refinement, and img2img flows.

## Endpoints

- `POST /` - generate an image with `@cf/black-forest-labs/flux-2-dev`
- `POST /analyze` - analyze an uploaded image into a slot prompt
- `POST /refine-prompt` - refine subject, scene, and style prompts from user feedback
- `POST /img2img` - generate a modified image from a reference image and prompt

## Requirements

- Cloudflare Workers
- Workers AI binding named `AI`
- Node.js 18+

## Local Development

```bash
npm install
npm run dev
```

## Deploy

```bash
npm run deploy
```

## Wrangler Config

`wrangler.toml` must include an AI binding:

```toml
[ai]
binding = "AI"
```

## Notes

- This project does not store local secrets in source files.
- Do not commit `.wrangler/` or `node_modules/`.
