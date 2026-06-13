// functions/recipe-chat.js
// Cloudflare Pages Function — context-aware recipe assistant via Claude

export async function onRequestPost(context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  let recipe, messages;
  try {
    ({ recipe, messages } = await context.request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  const ANTHROPIC_KEY = context.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_KEY) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY not configured' }), { status: 500, headers });
  }

  const ingredientList = (recipe.ingredients || [])
    .map(i => `- ${i.amount ? i.amount + ' ' : ''}${i.name}`)
    .join('\n');

  const stepList = (recipe.steps || [])
    .map((s, i) => `${i + 1}. ${s}`)
    .join('\n');

  const systemPrompt = `You are a knowledgeable, friendly kitchen assistant embedded in a recipe app called Thyme2Cook. The user is currently viewing this recipe and may have questions about it.

RECIPE: ${recipe.title}
SOURCE: ${recipe.source || 'unknown'}
PREP TIME: ${recipe.prepTime || 'unknown'}
COOK TIME: ${recipe.cookTime || 'unknown'}
SERVES: ${recipe.servings || 'unknown'}

INGREDIENTS:
${ingredientList || 'Not available'}

METHOD:
${stepList || 'Not available'}

Your role is to help the user with this specific recipe. Be concise and practical. You can help with:
- Ingredient substitutions (always suggest metric quantities)
- Dietary adaptations (dairy-free, gluten-free, vegan, etc.)
- Scaling the recipe up or down
- Technique questions
- What to do if something goes wrong
- Storage and make-ahead advice
- Wine or side dish pairings
- Equipment alternatives

Keep responses focused and practical. Use metric measurements. Do not use bullet points for simple answers — prose is fine for short responses. For lists of substitutions or steps, a short list is appropriate. Be warm but efficient.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: systemPrompt,
        messages,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Claude API error', detail: err }), { status: 502, headers });
    }

    const data = await res.json();
    const reply = data.content?.[0]?.text || 'Sorry, I could not generate a response.';
    return new Response(JSON.stringify({ reply }), { status: 200, headers });

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
