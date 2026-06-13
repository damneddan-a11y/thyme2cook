// functions/scrape-recipe.js
// Cloudflare Pages Function — scrapes JSON-LD recipe data directly from a URL

export async function onRequestPost(context) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Content-Type': 'application/json',
  };

  let url;
  try {
    ({ url } = await context.request.json());
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid request body' }), { status: 400, headers });
  }

  if (!url) return new Response(JSON.stringify({ error: 'url is required' }), { status: 400, headers });

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-GB,en;q=0.9',
      },
      redirect: 'follow',
    });

    if (!res.ok) return new Response(JSON.stringify({ error: `Could not fetch page (${res.status})` }), { status: 502, headers });

    const html = await res.text();

    // Extract all JSON-LD blocks
    const jsonLdBlocks = [];
    const regex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
    let match;
    while ((match = regex.exec(html)) !== null) {
      try {
        const parsed = JSON.parse(match[1].trim());
        if (Array.isArray(parsed)) jsonLdBlocks.push(...parsed);
        else if (parsed['@graph']) jsonLdBlocks.push(...parsed['@graph']);
        else jsonLdBlocks.push(parsed);
      } catch { /* skip malformed blocks */ }
    }

    // Find the Recipe block
    const raw = jsonLdBlocks.find(b => {
      const type = b['@type'];
      return type === 'Recipe' || (Array.isArray(type) && type.includes('Recipe'));
    });

    if (!raw) {
      return new Response(JSON.stringify({
        error: 'No recipe found on that page. The site may not support automatic import — try adding it manually instead.'
      }), { status: 404, headers });
    }

    const recipe = {
      title:       raw.name || 'Untitled Recipe',
      source:      extractDomain(url),
      sourceUrl:   url,
      image:       extractImage(raw.image),
      description: raw.description || null,
      prepTime:    formatDuration(raw.prepTime),
      cookTime:    formatDuration(raw.cookTime || raw.totalTime),
      servings:    parseServings(raw.recipeYield),
      categories:  guessCategories(raw),
      ingredients: normaliseIngredients(raw.recipeIngredient || []),
      steps:       normaliseSteps(raw.recipeInstructions || []),
      emoji:       guessEmoji(raw.name || ''),
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

// ── Helpers ────────────────────────────────────────────────────────────────

function extractDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

function extractImage(img) {
  if (!img) return null;
  if (typeof img === 'string') return img;
  if (Array.isArray(img)) return extractImage(img[0]);
  return img.url || img.contentUrl || null;
}

function formatDuration(iso) {
  if (!iso) return null;
  const m = String(iso).match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
  if (!m) return iso;
  const h = parseInt(m[1] || 0);
  const mins = parseInt(m[2] || 0);
  if (h && mins) return `${h} hr ${mins} min`;
  if (h) return `${h} hr`;
  if (mins) return `${mins} min`;
  return iso;
}

function parseServings(raw) {
  if (!raw) return 4;
  const val = Array.isArray(raw) ? raw[0] : raw;
  const n = parseInt(String(val));
  return isNaN(n) ? 4 : n;
}

function normaliseIngredients(arr) {
  return arr.map(item => {
    if (typeof item !== 'string') return { amount: '', name: String(item) };
    const m = item.match(/^([\d½¼¾\s\-–]+(?:g|kg|ml|l|tsp|tbsp|cups?|oz|lb|x)?\s*)/i);
    if (m && m[1].trim()) return { amount: m[1].trim(), name: item.slice(m[1].length).trim() };
    return { amount: '', name: item.trim() };
  }).filter(i => i.name);
}

function normaliseSteps(arr) {
  return arr.flatMap(item => {
    if (typeof item === 'string') return [item];
    if (item['@type'] === 'HowToSection') return normaliseSteps(item.itemListElement || []);
    if (item['@type'] === 'HowToStep') return [item.text || item.name || ''];
    return [item.text || item.description || String(item)];
  }).filter(Boolean).map(s => s.replace(/<[^>]+>/g, '').trim());
}

function guessCategories(raw) {
  const cats = [];
  const text = [raw.name, raw.recipeCategory, raw.keywords, raw.recipeCuisine].filter(Boolean).join(' ').toLowerCase();
  const totalMins = (() => {
    const t = raw.totalTime || raw.cookTime || '';
    const m = String(t).match(/PT(?:(\d+)H)?(?:(\d+)M)?/i);
    if (!m) return 999;
    return (parseInt(m[1]||0) * 60) + parseInt(m[2]||0);
  })();
  if (totalMins <= 30) cats.push('quick');
  if (/vegan|vegetarian|veggie/.test(text)) cats.push('vegetarian');
  if (/cake|bread|bak|pastry|biscuit|cookie|tart|pie|loaf|scone|muffin/.test(text)) cats.push('baking');
  if (totalMins > 90) cats.push('weekend');
  return cats;
}

function guessEmoji(title) {
  const t = title.toLowerCase();
  const map = [
    [/pasta|spaghetti|linguine|penne|carbonara|lasagna|lasagne/, '🍝'],
    [/steak|ribeye|sirloin/, '🥩'],
    [/chicken|poultry/, '🍗'],
    [/fish|salmon|cod|tuna|sea bass|trout|prawn|shrimp/, '🐟'],
    [/soup|broth|chowder|bisque/, '🍲'],
    [/salad/, '🥗'],
    [/pizza/, '🍕'],
    [/burger/, '🍔'],
    [/cake|cupcake/, '🎂'],
    [/bread|loaf|sourdough|focaccia/, '🍞'],
    [/cookie|biscuit/, '🍪'],
    [/tart|pie/, '🥧'],
    [/curry|dhal|dal/, '🍛'],
    [/ramen|noodle/, '🍜'],
    [/rice|risotto/, '🍚'],
    [/egg/, '🥚'],
    [/chocolate/, '🍫'],
    [/cheese/, '🧀'],
    [/lamb/, '🫕'],
    [/pork|bacon|pancetta|sausage/, '🥓'],
    [/mushroom/, '🍄'],
    [/tomato/, '🍅'],
    [/lemon|citrus/, '🍋'],
  ];
  for (const [re, emoji] of map) if (re.test(t)) return emoji;
  return '🍽';
}
