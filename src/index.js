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

    // POST /analyze — vision (LLaVA 1.5)
    if (request.method === 'POST' && url.pathname === '/analyze') {
      try {
        const { image_base64, slot_type } = await request.json()
        if (!image_base64) {
          return new Response(JSON.stringify({ error: 'image_base64 is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          })
        }

        const promptText = slotPrompt(slot_type)
        const imageBytes = Uint8Array.from(atob(image_base64), (c) => c.charCodeAt(0))

        const response = await env.AI.run('@cf/unum/uform-gen2-qwen-500m', {
          image: [...imageBytes],
          prompt: promptText,
        })

        const prompt = (response.description || '').trim()
        return new Response(JSON.stringify({ prompt }), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        })
      }
    }

    // POST /refine-prompt — text LLM prompt refinement (Llama 3.1 8B)
    if (request.method === 'POST' && url.pathname === '/refine-prompt') {
      try {
        const { subject_prompt, scene_prompt, style_prompt, feedback, history = [] } = await request.json()
        if (!feedback) {
          return new Response(JSON.stringify({ error: 'feedback is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          })
        }

        const recentHistory = Array.isArray(history)
          ? history
              .filter((item) => item && typeof item.content === 'string' && typeof item.role === 'string')
              .slice(-6)
              .map((item) => `${item.role}: ${item.content.trim()}`)
              .join('\n')
          : ''

        const systemMsg = `You are an AI image generation prompt refinement assistant.
Rules:
1. Output ONLY a valid JSON object with keys "subject_prompt", "scene_prompt", "style_prompt". No markdown, no explanation.
2. ALL output values MUST be in English only — translate any non-English feedback to English.
3. Apply the user's feedback precisely. Only change the parts relevant to the feedback. Keep everything else identical to the original.
4. Preserve identity, pose, composition, clothing, camera angle, and scene continuity unless the user explicitly asks to change them.
5. When prior conversation exists, treat it as persistent context for the current image edit chain.`

        const userMsg = `Current prompts:
subject_prompt: "${subject_prompt || ''}"
scene_prompt: "${scene_prompt || ''}"
style_prompt: "${style_prompt || ''}"

Recent conversation:
${recentHistory || '(none)'}

User feedback: ${feedback}

Output JSON only:`

        const response = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
          messages: [
            { role: 'system', content: systemMsg },
            { role: 'user', content: userMsg },
          ],
          max_tokens: 300,
          temperature: 0.4,
        })

        const content = response.response || ''
        const start = content.indexOf('{')
        const end = content.lastIndexOf('}')

        let parsed = {
          subject_prompt: subject_prompt || '',
          scene_prompt: scene_prompt || '',
          style_prompt: style_prompt || '',
        }

        if (start >= 0 && end > start) {
          try {
            const extracted = JSON.parse(content.slice(start, end + 1))
            if (extracted.subject_prompt) parsed.subject_prompt = extracted.subject_prompt
            if (extracted.scene_prompt) parsed.scene_prompt = extracted.scene_prompt
            if (extracted.style_prompt) parsed.style_prompt = extracted.style_prompt
          } catch {
            // fallback to originals
          }
        }

        return new Response(JSON.stringify(parsed), {
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        })
      } catch (e) {
        return new Response(JSON.stringify({ error: e.message }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
        })
      }
    }

    // POST /img2img — FLUX.2 dev: reference-guided image editing (preserves face/subject)
    if (request.method === 'POST' && url.pathname === '/img2img') {
      try {
        const { image_base64, prompt, reference_images = [], width = 1024, height = 1024 } = await request.json()
        if (!image_base64 || !prompt) {
          return new Response(JSON.stringify({ error: 'image_base64 and prompt required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          })
        }

        const response = await runFlux2Dev(env.AI, {
          prompt,
          width,
          height,
          steps: 25,
          primaryImage: image_base64,
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

function slotPrompt(slotType) {
  switch (slotType) {
    case 'subject':
      return 'Describe only the main subject/character. Be concise, comma-separated.'
    case 'scene':
      return 'Describe only the setting/background environment. Be concise.'
    case 'style':
      return 'Describe only the artistic style, color palette, and lighting. Be concise.'
    default:
      return 'Describe the image concisely.'
  }
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

async function runFlux2Dev(ai, { prompt, width, height, steps = 25, primaryImage, referenceImages = [] }) {
  const form = new FormData()
  form.append('prompt', prompt)
  form.append('width', String(width || 1024))
  form.append('height', String(height || 1024))
  form.append('steps', String(steps))

  if (primaryImage) {
    const image = decodeImagePayload(primaryImage)
    form.append('input_image_0', new Blob([image.bytes], { type: image.mimeType }), `primary.${image.extension}`)
  }

  referenceImages
    .filter((image) => typeof image === 'string' && image.trim())
    .slice(0, 4)
    .forEach((image, index) => {
      const decoded = decodeImagePayload(image)
      form.append(
        `input_image_${index + 1}`,
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
