const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    // POST / — image generation (FLUX.2 dev)
    if (request.method === 'POST' && url.pathname === '/') {
      try {
        const { prompt, width = 1024, height = 1024, reference_images = [] } = await request.json()
        if (!prompt) {
          return new Response(JSON.stringify({ error: 'prompt is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          })
        }

        const response = await runFlux2Dev(env.AI, {
          prompt,
          width,
          height,
          steps: 25,
          referenceImages: reference_images,
        })

        const image = decodeImagePayload(response.image)
        return new Response(image.bytes, {
          headers: { 'Content-Type': image.mimeType, ...CORS_HEADERS },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        })
      }
    }

    return new Response(JSON.stringify({ error: 'not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    })
  },
}

function decodeBase64Image(imageBase64) {
  return Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0))
}

function detectImageMimeType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }

  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }

  if (bytes.length >= 4 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x38) {
    return 'image/gif'
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }

  return 'application/octet-stream'
}

function extensionForMimeType(mimeType) {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg'
    case 'image/png':
      return 'png'
    case 'image/gif':
      return 'gif'
    case 'image/webp':
      return 'webp'
    default:
      return 'bin'
  }
}

function decodeImagePayload(imageBase64) {
  const bytes = decodeBase64Image(imageBase64)
  const mimeType = detectImageMimeType(bytes)
  return {
    bytes,
    mimeType,
    extension: extensionForMimeType(mimeType),
  }
}

async function runFlux2Dev(ai, { prompt, width, height, steps = 25, referenceImages = [] }) {
  const form = new FormData()
  form.append('prompt', prompt)
  form.append('width', String(width || 1024))
  form.append('height', String(height || 1024))
  form.append('steps', String(steps))

  referenceImages
    .filter((image) => typeof image === 'string' && image.trim())
    .slice(0, 4)
    .forEach((image, index) => {
      const decoded = decodeImagePayload(image)
      form.append(
        `input_image_${index}`,
        new Blob([decoded.bytes], { type: decoded.mimeType }),
        `reference-${index + 1}.${decoded.extension}`
      )
    })

  const formRequest = new Request('http://dummy', {
    method: 'POST',
    body: form,
  })
  const formStream = formRequest.body
  const formContentType = formRequest.headers.get('content-type') || 'multipart/form-data'

  return ai.run('@cf/black-forest-labs/flux-2-dev', {
    multipart: {
      body: formStream,
      contentType: formContentType,
    },
  })
}
