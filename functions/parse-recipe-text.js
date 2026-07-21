// functions/parse-recipe-text.js
// Cloudflare Pages Function — turns pasted recipe text into structured JSON via Gemini

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

  const prompt = `You are a recipe digitisation assistant. The user has pasted raw recipe text below. Extract a clean structured recipe from it.

Rules:
- Use metric units (g, kg, ml, l, tsp, tbsp). Convert imperial/US units to metric.
- "title": short clean recipe name.
- "prepTime" and "cookTime": strings like "15 min" or "1 hr 30 min", or null if unknown.
- "servings": a number, default 4 if not stated.
- "ingredients": array of { "amount": "200g", "name": "plain flour" }. Amount can be empty string if no quantity given.
- "steps": array of strings, one clear instruction per step.
- "categories": array using only these values where applicable: "quick" (30 min or less total), "vegetarian", "baking", "weekend" (90+ min total). Empty array if none apply.
- "emoji": single emoji representing the dish.
- "description": one sentence summary or null.

Return ONLY a raw JSON object matching this exact shape. If some information isn't present in the text, use your best reasonable judgement to fill it in rather than leaving the recipe incomplete — you must always return a usable recipe object, never plain text or an explanation.

{
  "title": "",
  "description": null,
  "prepTime": null,
  "cookTime": null,
  "servings": 4,
  "categories": [],
  "ingredients": [{ "amount": "", "name": "" }],
  "steps": [],
  "emoji": "🍽"
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
            temperature: 0.2,
            maxOutputTokens: 4096,
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
    const candidate = data.candidates?.[0];
    const raw = candidate?.content?.parts?.[0]?.text;

    if (!raw) {
      if (candidate?.finishReason === 'MAX_TOKENS') {
        return new Response(JSON.stringify({ error: 'Recipe was too long for the AI to finish, try pasting a shorter excerpt' }), { status: 502, headers });
      }
      return new Response(JSON.stringify({ error: 'Gemini returned no content' }), { status: 502, headers });
    }

    // Strip any accidental markdown fences and find the JSON object
    const cleaned = raw
      .replace(/```json\n?/gi, '')
      .replace(/```\n?/g, '')
      .trim();

    // Extract just the JSON object in case there's any preamble
    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      const hint = candidate?.finishReason === 'MAX_TOKENS' ? ' (response was cut off — try a shorter paste)' : '';
      return new Response(JSON.stringify({ error: `Could not find JSON in AI response${hint}` }), { status: 502, headers });
    }

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      const hint = candidate?.finishReason === 'MAX_TOKENS' ? ' (response was cut off — try a shorter paste)' : '';
      return new Response(JSON.stringify({ error: `Could not parse AI response into a recipe${hint}` }), { status: 502, headers });
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
