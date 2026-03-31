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

    // POST / — image generation (FLUX.1-schnell)
    if (request.method === 'POST' && url.pathname === '/') {
      try {
        const { prompt, width = 1024, height = 1024 } = await request.json()
        if (!prompt) {
          return new Response(JSON.stringify({ error: 'prompt is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          })
        }

        const response = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', {
          prompt,
          width,
          height,
          num_steps: 4,
        })

        const imageBytes = Uint8Array.from(atob(response.image), (c) => c.charCodeAt(0))
        return new Response(imageBytes, {
          headers: { 'Content-Type': 'image/png', ...CORS_HEADERS },
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
        const { subject_prompt, scene_prompt, style_prompt, feedback } = await request.json()
        if (!feedback) {
          return new Response(JSON.stringify({ error: 'feedback is required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          })
        }

        const systemMsg = `You are an AI image generation prompt refinement assistant.
Rules:
1. Output ONLY a valid JSON object with keys "subject_prompt", "scene_prompt", "style_prompt". No markdown, no explanation.
2. ALL output values MUST be in English only — translate any non-English feedback to English.
3. Apply the user's feedback precisely. Only change the parts relevant to the feedback. Keep everything else identical to the original.`

        const userMsg = `Current prompts:
subject_prompt: "${subject_prompt || ''}"
scene_prompt: "${scene_prompt || ''}"
style_prompt: "${style_prompt || ''}"

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
        const { image_base64, prompt } = await request.json()
        if (!image_base64 || !prompt) {
          return new Response(JSON.stringify({ error: 'image_base64 and prompt required' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          })
        }

        const imageBytes = Uint8Array.from(atob(image_base64), (c) => c.charCodeAt(0))

        // FLUX.2 dev requires multipart form data for reference images
        const form = new FormData()
        form.append('prompt', prompt)
        form.append('input_image_0', new Blob([imageBytes], { type: 'image/png' }), 'reference.png')
        form.append('steps', '25')
        form.append('width', '1024')
        form.append('height', '1024')

        const response = await env.AI.run('@cf/black-forest-labs/flux-2-dev', form)

        // FLUX.2 returns base64
        const outBytes = Uint8Array.from(atob(response.image), (c) => c.charCodeAt(0))
        return new Response(outBytes, {
          headers: { 'Content-Type': 'image/png', ...CORS_HEADERS },
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
