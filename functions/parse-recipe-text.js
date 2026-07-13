// functions/parse-recipe-text.js
// Cloudflare Pages Function — turns pasted/raw recipe text into structured recipe JSON via Gemini

export async function onRequestPost(context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  let text;
  try {
    ({ text } = await context.request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  if (!text || !text.trim()) {
    return new Response(JSON.stringify({ error: 'Paste some recipe text first' }), { status: 400, headers });
  }

  const GEMINI_KEY = context.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), { status: 500, headers });
  }

  const prompt = `You are a recipe digitisation assistant. The user has pasted raw recipe text below (it might be messy, copied from a website, a screenshot transcription, a handwritten note, or a forwarded message). Extract a clean, structured recipe from it.

Rules:
- Use metric units (g, kg, ml, l, tsp, tbsp). If the source uses imperial/US units, convert to metric and round sensibly.
- "title" should be a short, clean recipe name.
- "prepTime" and "cookTime" should be short strings like "15 min" or "1 hr 30 min". Use null if genuinely not stated or inferable.
- "servings" should be a number. Default to 4 if not stated.
- "ingredients" is an array of objects: { "amount": "200g", "name": "plain flour" }. The amount field can be an empty string if there's genuinely no quantity (e.g. "salt, to taste").
- "steps" is an array of strings, one per method step, written as clear instructions in the same language as the source.
- "categories" is an array using only these allowed values where applicable: "quick" (30 min or less total), "vegetarian", "baking", "weekend" (90+ min total). Include zero, one, or more as appropriate. Use an empty array if none apply.
- "emoji" should be a single emoji that best represents the dish.
- "description" is a one sentence summary, or null.
- Do not invent ingredients or steps that are not implied by the text. If the text is not a recipe at all, still do your best to structure whatever cooking information is present.

Return ONLY valid JSON matching this exact shape, with no markdown formatting, no code fences, and no commentary:

{
  "title": string,
  "description": string | null,
  "prepTime": string | null,
  "cookTime": string | null,
  "servings": number,
  "categories": string[],
  "ingredients": [{ "amount": string, "name": string }],
  "steps": string[],
  "emoji": string
}

RECIPE TEXT:
"""
${text}
"""`;

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
          },
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Gemini API error', detail: err }), { status: 502, headers });
    }

    const data = await res.json();
    const raw = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!raw) {
      return new Response(JSON.stringify({ error: 'Gemini returned no content' }), { status: 502, headers });
    }

    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return new Response(JSON.stringify({ error: 'Could not parse the AI response into a recipe' }), { status: 502, headers });
    }

    const recipe = {
      title:       parsed.title || 'Untitled Recipe',
      source:      'Pasted text',
      sourceUrl:   null,
      image:       null,
      description: parsed.description || null,
      prepTime:    parsed.prepTime || null,
      cookTime:    parsed.cookTime || null,
      servings:    typeof parsed.servings === 'number' ? parsed.servings : (parseInt(parsed.servings) || 4),
      categories:  Array.isArray(parsed.categories) ? parsed.categories.filter(c => ['quick','vegetarian','baking','weekend'].includes(c)) : [],
      ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients.map(i => ({ amount: i.amount || '', name: i.name || '' })).filter(i => i.name) : [],
      steps:       Array.isArray(parsed.steps) ? parsed.steps.filter(Boolean) : [],
      emoji:       parsed.emoji || '🍽',
      addedAt:     Date.now(),
      favourite:   false,
    };

    return new Response(JSON.stringify(recipe), { status: 200, headers });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Internal error', detail: err.message }), { status: 500, headers });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type' },
  });
}
