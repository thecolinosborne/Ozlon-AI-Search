/**
 * Chat Service for Ozlon
 * 
 * DEVELOPER NOTE: This is a shell implementation. Real integrations would:
 * - CHECK_MONEY: Connect to banking APIs (Plaid, etc.) for real financial data
 * - CHECK_MAIL: Connect to email APIs (Gmail, Outlook) for real email summaries
 * - DAILY_DIGEST: Connect to calendar APIs (Google Calendar, Outlook) for schedule
 * - ANALYZE_DAY: Connect to journaling/task apps for day analysis
 */

type Message = { role: 'user' | 'assistant'; content: string };

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat`;

export async function streamChat({
  messages,
  intent,
  onDelta,
  onDone,
  onError,
}: {
  messages: Message[];
  intent?: string;
  onDelta: (deltaText: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}) {
  try {
    const resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
      },
      body: JSON.stringify({ messages, intent }),
    });

    if (!resp.ok) {
      const errorData = await resp.json().catch(() => ({}));
      onError(errorData.error || `Request failed: ${resp.status}`);
      return;
    }

    if (!resp.body) {
      onError('No response body');
      return;
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith('\r')) line = line.slice(0, -1);
        if (line.startsWith(':') || line.trim() === '') continue;
        if (!line.startsWith('data: ')) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === '[DONE]') {
          onDone();
          return;
        }

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) onDelta(content);
        } catch {
          // Re-buffer incomplete JSON
          textBuffer = line + '\n' + textBuffer;
          break;
        }
      }
    }

    onDone();
  } catch (error) {
    onError(error instanceof Error ? error.message : 'Connection error');
  }
}
