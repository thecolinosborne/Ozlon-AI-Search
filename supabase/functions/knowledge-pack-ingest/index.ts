import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================================
// WISDOM PACK INGEST
// Ships curated, originally-synthesized framework summaries for
// well-known thinkers. Content is original synthesis, not verbatim
// quotation, to avoid copyright issues.
// ============================================================

type PackEntry = {
  title: string;
  content: string;
  category: string;
  domain: string;
  tags: string[];
};

type Pack = {
  id: string;
  person: string;
  title: string;
  type: string;
  entries: PackEntry[];
};

const PACKS: Record<string, Pack> = {
  hormozi: {
    id: 'hormozi',
    person: 'Alex Hormozi',
    title: 'Hormozi Core Frameworks',
    type: 'frameworks',
    entries: [
      { title: 'The Value Equation', content: 'Perceived value = (Dream Outcome × Perceived Likelihood of Achievement) / (Time Delay × Effort & Sacrifice). Increase the numerator and shrink the denominator to make any offer dramatically more compelling.', category: 'framework', domain: 'pricing', tags: ['offer','value','pricing'] },
      { title: 'Grand Slam Offer', content: 'Build an offer so good people feel stupid saying no: stack bonuses, add risk-reversal guarantees, layer urgency and scarcity, and price to anchor the alternatives as inferior.', category: 'framework', domain: 'sales', tags: ['offer','sales','conversion'] },
      { title: 'Core Four Lead Sources', content: 'Every business has only four lead sources: warm outreach, cold outreach, paid ads, and content. Master all four sequentially, not simultaneously.', category: 'framework', domain: 'marketing', tags: ['leads','growth'] },
      { title: 'Volume Negates Luck', content: 'Most people quit before the law of large numbers can work for them. The cure to a bad week is more reps, not a new strategy.', category: 'principle', domain: 'mindset', tags: ['volume','consistency'] },
      { title: 'Risk Reversal', content: 'Move the risk from the buyer onto yourself with conditional guarantees. The bigger and more specific the guarantee, the higher the conversion.', category: 'strategy', domain: 'sales', tags: ['guarantee','sales'] },
      { title: 'Price Is a Marketing Decision', content: 'Charging more lets you spend more on acquisition, deliver more value, and attract higher-quality customers. Cheap prices trap you in a low-margin race.', category: 'principle', domain: 'pricing', tags: ['pricing','positioning'] },
      { title: 'CAC < LTV / 3', content: 'A healthy business needs lifetime value at least three times customer acquisition cost. If not, fix LTV (raise price, increase retention) before scaling spend.', category: 'framework', domain: 'finance', tags: ['ltv','cac','unit-economics'] },
      { title: 'The 100-Hour Test', content: 'Before deciding a strategy does not work, give it 100 focused hours of execution. Most failures are quitting too early disguised as strategic pivots.', category: 'principle', domain: 'mindset', tags: ['discipline','execution'] },
      { title: 'Niche Down to Scale Up', content: 'Specificity sells. The narrower your avatar, the higher your prices, the easier your marketing, the faster your growth.', category: 'strategy', domain: 'marketing', tags: ['positioning','niche'] },
      { title: 'Leverage Hierarchy', content: 'Order of leverage: labor, capital, code, content. Always be moving up the stack — every hour spent on lower-leverage work is opportunity cost.', category: 'mental_model', domain: 'leadership', tags: ['leverage','productivity'] },
    ],
  },
  munger: {
    id: 'munger',
    person: 'Charlie Munger',
    title: 'Munger Mental Models',
    type: 'mental_models',
    entries: [
      { title: 'Inversion', content: 'To solve a hard problem, invert it: instead of asking how to succeed, ask what would guarantee failure, then avoid those things. Avoiding stupidity is easier than seeking brilliance.', category: 'mental_model', domain: 'decision_making', tags: ['inversion','thinking'] },
      { title: 'Circle of Competence', content: 'Know the boundary of what you actually understand. Inside the circle, act with confidence. Outside it, default to no or to learning before acting.', category: 'principle', domain: 'decision_making', tags: ['humility','expertise'] },
      { title: 'Lollapalooza Effect', content: 'When several biases or forces point the same direction simultaneously, the result is extreme and non-linear. Watch for them in markets, manias, and your own decisions.', category: 'mental_model', domain: 'decision_making', tags: ['bias','psychology'] },
      { title: 'Incentives Drive Behavior', content: 'Never, ever think about something else when you should be thinking about the power of incentives. If the incentive is wrong, the behavior will be wrong.', category: 'principle', domain: 'leadership', tags: ['incentives','management'] },
      { title: 'Latticework of Models', content: 'You need a few dozen big mental models from many disciplines hanging together in a lattice. Single-discipline thinkers consistently make worse decisions.', category: 'mental_model', domain: 'decision_making', tags: ['multi-disciplinary'] },
      { title: 'Sit on Your Ass Investing', content: 'The big money is not in the buying or selling but in the waiting. Patience is a competitive advantage because almost no one has it.', category: 'principle', domain: 'finance', tags: ['patience','investing'] },
      { title: 'Avoid Stupidity', content: 'It is remarkable how much long-term advantage people like us have gotten by trying to be consistently not stupid, instead of trying to be very intelligent.', category: 'principle', domain: 'mindset', tags: ['simplicity'] },
      { title: 'Fluency Over Flash', content: 'Master the fundamentals of accounting, probability, and basic psychology. They show up in every business decision you will ever make.', category: 'principle', domain: 'finance', tags: ['fundamentals'] },
    ],
  },
  naval: {
    id: 'naval',
    person: 'Naval Ravikant',
    title: 'Naval — Wealth & Leverage',
    type: 'principles',
    entries: [
      { title: 'Specific Knowledge', content: 'Build skills that cannot be trained for and cannot be outsourced. Specific knowledge is found by pursuing your genuine curiosity and passion, not by following a script.', category: 'principle', domain: 'mindset', tags: ['skills','career'] },
      { title: 'Permissionless Leverage', content: 'Code and media are leverage that does not require permission. They work while you sleep and have near-zero marginal cost. Prefer them over labor and capital leverage.', category: 'mental_model', domain: 'growth', tags: ['leverage','code','media'] },
      { title: 'Play Long-Term Games With Long-Term People', content: 'All returns in life — wealth, relationships, knowledge — come from compound interest. Repeat games with the same trustworthy people are how compounding happens.', category: 'principle', domain: 'leadership', tags: ['relationships','compounding'] },
      { title: 'Wealth, Not Money', content: 'Wealth is assets that earn while you sleep. Money is how we transfer time and wealth. Status is a zero-sum game; wealth is positive-sum. Pursue wealth, ignore status.', category: 'principle', domain: 'finance', tags: ['wealth','assets'] },
      { title: 'Be the Best in the World at What You Do', content: 'Keep redefining what you do until that is true. Niche down until you are the only obvious choice for the work you most want.', category: 'strategy', domain: 'mindset', tags: ['positioning','mastery'] },
      { title: 'Read What You Love Until You Love to Read', content: 'The genuine love of reading itself, when fed, will lead you to the knowledge you need. Forced reading produces forgotten knowledge.', category: 'principle', domain: 'mindset', tags: ['learning'] },
      { title: 'Output Equals Effort × Leverage', content: 'Working harder has linear returns. Adding leverage — capital, people, code, media — has non-linear returns. Always be looking for more leverage on your work.', category: 'framework', domain: 'growth', tags: ['leverage','productivity'] },
    ],
  },
  buffett: {
    id: 'buffett',
    person: 'Warren Buffett',
    title: 'Buffett — Investing Principles',
    type: 'principles',
    entries: [
      { title: 'Margin of Safety', content: 'Only buy when the price is meaningfully below your conservative estimate of intrinsic value. The bigger the gap, the more room for being wrong.', category: 'principle', domain: 'finance', tags: ['investing','risk'] },
      { title: 'Be Fearful When Others Are Greedy', content: 'Crowd sentiment is a contrarian signal at extremes. Maximum optimism marks tops; maximum pessimism marks bottoms.', category: 'principle', domain: 'finance', tags: ['psychology','markets'] },
      { title: 'Buy Wonderful Businesses at Fair Prices', content: 'A great business at a fair price beats a fair business at a great price. Quality compounds; mediocrity erodes.', category: 'principle', domain: 'finance', tags: ['investing','quality'] },
      { title: 'Economic Moats', content: 'Durable competitive advantages — brand, network effects, switching costs, scale — protect returns. Without a moat, profits get competed away.', category: 'mental_model', domain: 'finance', tags: ['moat','competition'] },
      { title: 'Time Is the Friend of the Wonderful Business', content: 'A great business compounds in your favor the longer you hold it. A bad business gets worse the longer you wait.', category: 'principle', domain: 'finance', tags: ['compounding','patience'] },
      { title: 'Reputation Takes 20 Years, Five Minutes to Lose', content: 'Protect your name. In business, the long-term value of trust dwarfs any short-term gain from cutting corners.', category: 'principle', domain: 'leadership', tags: ['integrity','reputation'] },
    ],
  },
  godin: {
    id: 'godin',
    person: 'Seth Godin',
    title: 'Seth Godin — Marketing & Tribes',
    type: 'frameworks',
    entries: [
      { title: 'Purple Cow', content: 'In a crowded marketplace, fitting in is failing. Be remarkable — literally worth making a remark about — or be invisible.', category: 'principle', domain: 'marketing', tags: ['differentiation'] },
      { title: 'Permission Marketing', content: 'Earn the right to deliver anticipated, personal, relevant messages to people who actually want to get them. Interruption is dying; permission is the asset.', category: 'framework', domain: 'marketing', tags: ['email','consent'] },
      { title: 'The Smallest Viable Audience', content: 'Stop trying to reach everyone. Find the smallest market you can serve with such delight that they tell others. Growth follows.', category: 'strategy', domain: 'marketing', tags: ['niche','tribe'] },
      { title: 'Ship It', content: 'The lizard brain resists shipping because shipping invites criticism. Resistance is a signal you are doing important work. Ship anyway, on schedule, every time.', category: 'principle', domain: 'mindset', tags: ['execution','resistance'] },
      { title: 'Tribes', content: 'People want connection, growth, and something new. Lead a tribe — a group of people connected to each other, to a leader, and to an idea — and they will follow.', category: 'mental_model', domain: 'leadership', tags: ['community','leadership'] },
      { title: 'The Dip', content: 'Quit the wrong stuff fast and stick with the right stuff. The Dip is the long slog between starting and mastery; only those who push through become the best.', category: 'framework', domain: 'mindset', tags: ['quit','persistence'] },
    ],
  },
  dalio: {
    id: 'dalio',
    person: 'Ray Dalio',
    title: 'Dalio — Principles',
    type: 'principles',
    entries: [
      { title: 'Pain + Reflection = Progress', content: 'Embrace painful mistakes as gifts. The reflection on what went wrong, written down honestly, is what compounds into wisdom.', category: 'principle', domain: 'mindset', tags: ['learning','reflection'] },
      { title: 'Radical Truth and Transparency', content: 'In meaningful work and relationships, prioritize honesty over comfort. Hidden problems compound; surfaced problems get solved.', category: 'principle', domain: 'leadership', tags: ['honesty','culture'] },
      { title: 'Believability-Weighted Decision Making', content: 'When opinions conflict, weight them by track record and reasoning, not seniority or volume. Best ideas should win, not best politicians.', category: 'framework', domain: 'decision_making', tags: ['meritocracy','process'] },
      { title: 'The Five-Step Process', content: '1) Set clear goals. 2) Identify problems blocking them. 3) Diagnose root causes. 4) Design solutions. 5) Execute. Most failures live in step 3.', category: 'framework', domain: 'leadership', tags: ['process','execution'] },
      { title: 'Machines, Not Just People', content: 'Design your business as a machine: roles, responsibilities, and feedback loops that produce outcomes. People are operators of the machine; the machine is the asset.', category: 'mental_model', domain: 'ops', tags: ['systems','organization'] },
      { title: 'Diversification Is the Holy Grail', content: 'Combining 15-20 uncorrelated return streams reduces risk by 80% without reducing return. Most investors hold concentrated correlated bets and call it diversification.', category: 'principle', domain: 'finance', tags: ['portfolio','risk'] },
    ],
  },
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const url = new URL(req.url);
    let body: any = null;
    if (req.method !== 'GET') {
      try { body = await req.json(); } catch { body = null; }
    }
    const wantList =
      url.searchParams.get('list') === '1' ||
      req.method === 'GET' ||
      body?.list === true;

    if (wantList) {
      return new Response(JSON.stringify({
        packs: Object.values(PACKS).map(p => ({
          id: p.id, person: p.person, title: p.title, type: p.type, entry_count: p.entries.length,
        })),
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const pack_id = body?.pack_id;
    if (!pack_id || !PACKS[pack_id]) {
      return new Response(JSON.stringify({ error: 'Unknown pack_id', available: Object.keys(PACKS) }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const pack = PACKS[pack_id];

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Idempotency: skip if same pack already installed
    const { data: existing } = await adminClient
      .from('knowledge_sources')
      .select('id')
      .eq('user_id', user.id)
      .eq('person', pack.person)
      .eq('title', pack.title)
      .maybeSingle();

    if (existing) {
      return new Response(JSON.stringify({
        success: true,
        already_installed: true,
        source_id: existing.id,
        entries_count: pack.entries.length,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY not configured');

    // Embed entries
    const textsToEmbed = pack.entries.map(e => `${e.title}: ${e.content}`);
    const embRes = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'text-embedding-3-small', input: textsToEmbed }),
    });
    if (!embRes.ok) throw new Error('Failed to embed pack entries');
    const embData = await embRes.json();
    const embeddings: number[][] = embData.data.map((d: { embedding: number[] }) => d.embedding);

    // Create source
    const { data: sourceData, error: sourceError } = await adminClient
      .from('knowledge_sources')
      .insert({ user_id: user.id, person: pack.person, title: pack.title, type: pack.type, entry_count: pack.entries.length })
      .select('id')
      .single();
    if (sourceError) throw new Error('Failed to create source');

    const rows = pack.entries.map((e, i) => ({
      user_id: user.id,
      source_id: sourceData.id,
      source_person: pack.person,
      source_material: pack.title,
      category: e.category,
      domain: e.domain,
      title: e.title,
      content: e.content,
      embedding: JSON.stringify(embeddings[i]),
      tags: e.tags,
    }));
    const { error: insertError } = await adminClient.from('knowledge_entries').insert(rows);
    if (insertError) throw new Error('Failed to insert pack entries');

    return new Response(JSON.stringify({
      success: true,
      source_id: sourceData.id,
      entries_count: pack.entries.length,
      person: pack.person,
      title: pack.title,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('knowledge-pack-ingest error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
