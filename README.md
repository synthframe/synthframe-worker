# synthframe-worker

Cloudflare Worker used by the Synthframe API for character-set image generation.

## Endpoints

- `POST /` - generate an image with `@cf/black-forest-labs/flux-2-dev` using up to 4 reference images

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
