import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Ozlon Chat Edge Function
 * 
 * This is Agent 0 - the main coordinating brain that handles all user requests.
 * It routes to specialized agents based on intent.
 * 
 * DEVELOPER NOTES for future integrations:
 * - CHECK_MONEY: Integrate with Plaid, banking APIs for real financial data
 * - CHECK_MAIL: Integrate with Gmail/Outlook APIs for email access
 * - DAILY_DIGEST: Integrate with Google Calendar, Todoist, etc.
 * - ANALYZE_DAY: Integrate with journaling apps, activity trackers
 */

const buildSystemPrompt = (systemName: string) => `You are ${systemName}, a personal operating system shell for the user's life and work.
You are the single coordinating brain that talks to specialized agents for money, email, daily digest, and day analysis.

Your name is ${systemName}. Always refer to yourself as ${systemName} when introducing yourself or when relevant.

Goals:
- Talk like a thoughtful, competent human assistant.
- Ask clarifying questions when needed, but don't overdo it.
- Adapt your style to the context: sometimes conversational paragraphs, sometimes structured lists.

Style rules:
- No emojis.
- Be concise but not robotic.
- Use bullet points or numbered lists when they genuinely improve clarity (e.g., summarizing steps or priorities), and use normal paragraphs when that's more natural.
- Make sure responses are easy to scan for a busy user.

Behavior:
- When the intent is CHECK_MONEY, reason as if you have access to a money/finances agent, but in this shell version you may only provide example insights and a clear description of what will happen once real integrations are connected.
- When the intent is CHECK_MAIL, act as if reading and summarizing email, but again, in this shell version you describe what will be done once email integration is attached.
- When the intent is DAILY_DIGEST, organize the response into: schedule, priorities, and suggested focus.
- When the intent is ANALYZE_DAY, help the user reflect, extract lessons, and suggest next actions.
- For freeform chat, behave like a general-purpose assistant who knows the user is interacting with the ${systemName} personal OS shell.

Always clearly distinguish between:
- Real actions you can perform now (reasoning, planning, drafting), and
- Future actions that will depend on integrated agents and external APIs.

When describing shell/placeholder functionality, be helpful and demonstrate what the experience WILL be like, using realistic example data to illustrate the value.`;

// Intent-specific context additions
const INTENT_CONTEXTS: Record<string, string> = {
  CHECK_MONEY: `
The user wants to check their financial situation. In this shell version, demonstrate what the money agent will provide:
- Show example account balances and recent transactions
- Highlight spending patterns and insights
- Note that real banking integration (via Plaid or similar) will enable live data
Be helpful and show the VALUE of having this integration, using realistic placeholder data.`,
  
  CHECK_MAIL: `
The user wants to check their email. In this shell version, demonstrate what the mail agent will provide:
- Show example important/urgent emails that would be surfaced
- Summarize what's in the inbox
- Note that real email integration (Gmail, Outlook) will enable live access
Show the value of intelligent email summarization using realistic examples.`,
  
  DAILY_DIGEST: `
The user wants their daily digest. In this shell version, demonstrate what the digest agent will provide:
Structure your response as:
1. Today's Schedule - example calendar events
2. Top Priorities - what needs attention
3. Suggested Focus - what to tackle first
Note that calendar/task integrations will enable real data. Use realistic examples.`,
  
  ANALYZE_DAY: `
The user wants to analyze their day. In this shell version, help them reflect:
- Ask about wins and challenges
- Help identify patterns and lessons
- Suggest actionable next steps
This is something you CAN do now through conversation, even without integrations.`,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { messages, intent, systemName = 'Ozlon' } = await req.json();
    const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    
    if (!ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY is not configured');
    }

    // Build system prompt with custom name and intent context
    let systemPrompt = buildSystemPrompt(systemName);
    if (intent && INTENT_CONTEXTS[intent]) {
      systemPrompt += `\n\nCURRENT INTENT: ${intent}\n${INTENT_CONTEXTS[intent]}`;
    }

    console.log('Calling Claude with intent:', intent || 'general', 'systemName:', systemName, 'messages:', messages.length);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        system: systemPrompt,
        messages: messages.map((m: { role: string; content: string }) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content,
        })),
        stream: true,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', response.status, errorText);
      
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      
      return new Response(JSON.stringify({ error: 'AI service error' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Transform Claude's SSE format to OpenAI-compatible format
    const transformStream = new TransformStream({
      transform(chunk, controller) {
        const text = new TextDecoder().decode(chunk);
        const lines = text.split('\n');
        
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') {
              controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              continue;
            }
            
            try {
              const parsed = JSON.parse(data);
              
              if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
                const openAIFormat = {
                  choices: [{
                    delta: { content: parsed.delta.text }
                  }]
                };
                controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(openAIFormat)}\n\n`));
              } else if (parsed.type === 'message_stop') {
                controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              }
            } catch {
              // Skip unparseable lines
            }
          }
        }
      }
    });

    return new Response(response.body?.pipeThrough(transformStream), {
      headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
    });

  } catch (error) {
    console.error('Chat function error:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
