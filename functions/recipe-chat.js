// functions/recipe-chat.js
// Cloudflare Pages Function — context-aware recipe assistant via Gemini

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

  const GEMINI_KEY = context.env.GEMINI_API_KEY;
  if (!GEMINI_KEY) {
    return new Response(JSON.stringify({ error: 'GEMINI_API_KEY not configured' }), { status: 500, headers });
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
- Rough nutritional estimates, including calories per serving, when asked. This is a normal, expected feature of this app. Base the estimate on standard nutritional values for the listed ingredients and quantities, divide by the stated servings, and present it as an approximate figure (e.g. "roughly 450 kcal per serving"). Always caveat that it's an estimate, not a substitute for a proper nutritional analysis, but do provide the number.

Keep responses focused and practical. Use metric measurements. Do not use bullet points for simple answers — prose is fine for short responses. For lists of substitutions or steps, a short list is appropriate. Be warm but efficient.`;

  const geminiMessages = messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: {
            role: 'system',
            parts: [{ text: systemPrompt }],
          },
          contents: geminiMessages,
          generationConfig: {
            maxOutputTokens: 1024,
            temperature: 0.7,
            thinkingConfig: { thinkingBudget: 0 },
          },
          safetySettings: [
            { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
            { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
          ],
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: 'Gemini API error', detail: err }), { status: 502, headers });
    }

    const data = await res.json();
    const candidate = data.candidates?.[0];

    if (!candidate) {
      const blockReason = data.promptFeedback?.blockReason || 'unknown';
      return new Response(JSON.stringify({ error: `Response blocked: ${blockReason}` }), { status: 502, headers });
    }

    const reply = candidate.content?.parts?.[0]?.text || 'Sorry, I could not generate a response.';
    const finishedEarly = candidate.finishReason === 'MAX_TOKENS';
    return new Response(JSON.stringify({ reply, truncated: finishedEarly }), { status: 200, headers });

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
