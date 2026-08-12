import { useState, useRef, useEffect } from 'react';
import { useData } from '@/hooks/useData';
import { MessageCircle, X, Send, Loader2, Bot } from 'lucide-react';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/dataService';
import { loadAccountMappings, getAccountMapping } from '@/lib/config';

/**
 * Server-side endpoint that proxies the Anthropic call.
 *
 * EMPTY UNTIL THE PROXY IS DEPLOYED, and empty is the correct value today: the
 * Anthropic key is a server-side secret, so the browser has nothing to call with.
 * When the proxy exists, set VITE_AI_PROXY_ENDPOINT to its URL.
 *
 * ⛔ Do NOT point this at api.anthropic.com. That is what it used to do, using a
 * key read out of a world-readable settings table. The endpoint must be OURS, and
 * the key must never travel through the browser.
 *
 * ⚠️ VITE_* values are compiled into the bundle and are PUBLIC. A URL is fine here.
 * A KEY IS NOT. Never introduce VITE_ANTHROPIC_API_KEY — it would be exactly as
 * exposed as the settings row was, just harder to notice.
 */
const AI_PROXY_ENDPOINT: string =
  import.meta.env.VITE_AI_PROXY_ENDPOINT ??
  // Default to the Supabase edge function shipped in supabase/functions/anthropic-proxy.
  // Deriving it means deploying the function is the ONLY step — no extra env var to
  // forget, and forgetting one would leave this empty and the assistant silently dark.
  (import.meta.env.VITE_SUPABASE_URL
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/anthropic-proxy`
    : '');

function buildContext(accounts: any[], settings: any): string {
  const mappings = loadAccountMappings();

  const accountSummaries = accounts.map(a => {
    const { program, status } = getAccountMapping(a.accountName, mappings);
    const showedCount = a.appointmentList?.filter((apt: any) => {
      const s = (apt.showStatus || '').toLowerCase();
      return s === 'showed' || s === 'show';
    }).length || 0;

    return {
      name: a.accountName,
      program,
      status,
      spend: a.spend,
      leads: a.leads,
      cpl: a.cpl,
      appointments: a.appointments,
      costPerAppt: a.costPerAppt,
      leadToApptPct: a.leads > 0 ? +((a.appointments / a.leads) * 100).toFixed(1) : 0,
      showRate: a.appointments > 0 ? +((showedCount / a.appointments) * 100).toFixed(1) : 0,
      closed: a.closed,
      revenue: a.revenue,
    };
  });

  return JSON.stringify(accountSummaries, null, 2);
}

const SYSTEM_PROMPT = `You are the performance analyst for SocialWorks Pro, a performance marketing agency running Facebook/Instagram ads and appointment setting for outdoor living contractors.

You have access to live account performance data. Your job is not to read numbers back, since the team can see numbers on the dashboard. Your job is to DIAGNOSE problems and RECOMMEND specific actions.

BUSINESS MODEL:

- "Done For You" (DFY): we run ads AND we set appointments. We charge per appointment.

- "Done With You" (DWY): we only run ads, client handles leads. We charge for ad management.

PERFORMANCE TARGETS:

- Cost per appointment (DFY): green under $180, yellow $180-240, red above $240

- Cost per lead: green under $35, yellow $35-55, red above $55

- Lead-to-appointment rate: green above 15%, yellow 5-15%, red under 5%

HOW TO DIAGNOSE, always trace the funnel:

- High CPA can be caused by: (1) high CPL meaning ads are inefficient, which is a media buyer problem, or (2) low lead-to-appt rate meaning leads exist but arent converting, which is a follow-up problem

- Low lead-to-appt rate with a healthy CPL means the leads are arriving but not converting. Compare lead-to-appt across accounts on the same program before blaming targeting

- DWY accounts with high CPL: purely an ad problem since we dont do appointment setting for them

RESPONSE RULES:

- When the user says hi or hello, respond with one brief sentence and ask what they want to know. Do NOT give unsolicited analysis.

- When asked about performance, diagnose the ROOT CAUSE, not just the symptom. Never just say "CPA is high." Say WHY its high and WHAT to do.

- Always name the specific person or role responsible: "media buyer needs to..." or "Rory needs to flag this with the client..."

- Reference specific account names and specific numbers.

- When comparing accounts, look for patterns across the whole book: if every account on one program shows the same shape, it is a systemic issue, not an account-specific one.

- Do not use markdown formatting like bold with asterisks or bullet points with dashes. Write in short natural paragraphs. Use ALL CAPS sparingly for emphasis.

- Be direct. Sound like a sharp operator, not a corporate report.

- Keep responses concise, 2-4 short paragraphs max for overview questions.

- Never use em-dashes in your replies. Use commas, full stops or brackets instead.`;

export default function AIChatPanel() {
  const { accounts, settings } = useData();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<{ role: 'user' | 'assistant'; content: string }[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const sendMessage = async () => {
    if (!input.trim() || loading) return;
    // ⛔ THE DIRECT BROWSER CALL TO api.anthropic.com IS GONE — do not restore it.
    //
    // It read `settings.anthropicApiKey`, which was persisted to `app_settings`,
    // a table readable by the anon role — so the key was retrievable from the open
    // internet. It also sent the key from the user's browser on every message, with
    // the header `anthropic-dangerous-direct-browser-access: true`. Anthropic named
    // that header accurately.
    //
    // The key is a server-side secret now, so this panel cannot work until a proxy
    // exists. It says so, explicitly, rather than rendering an empty or generic
    // failure — a dead feature that looks merely idle is the defect this whole
    // project is about. It also must NOT tell the user to go add a key: that field
    // is deliberately gone, and following that instruction re-opened the exposure.
    if (!AI_PROXY_ENDPOINT) {
      setMessages(prev => [...prev,
        { role: 'user', content: input.trim() },
        {
          role: 'assistant',
          content:
            'The AI assistant is unavailable: it needs a server-side proxy that has not been ' +
            'deployed yet. The Anthropic key is no longer held in the browser, which is ' +
            'deliberate — it was previously readable by anyone. Nothing to configure here.',
        },
      ]);
      setInput('');
      return;
    }

    const userMsg = input.trim();
    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const context = buildContext(accounts, settings);
      // Calls OUR proxy. The proxy holds the key; the browser never sees it.
      const response = await fetch(AI_PROXY_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 1024,
          system: SYSTEM_PROMPT + '\n\nCURRENT ACCOUNT DATA:\n' + context,
          messages: [
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMsg },
          ],
        }),
      });

      const data = await response.json();
      const assistantMsg = data.content?.[0]?.text || 'Sorry, something went wrong.';
      setMessages(prev => [...prev, { role: 'assistant', content: assistantMsg }]);
    } catch (err) {
      // No longer says "check your API key" — there is no key for the user to check.
      setMessages(prev => [...prev, { role: 'assistant', content: 'Could not reach the AI service. This is a failure, not an empty answer.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        // ONE ACCENT COLOUR. This was an indigo→violet gradient in raw hex, a second brand
        // colour on top of Relay blue, floating over every page in the app.
        className="fixed bottom-5 right-5 z-40 flex items-center gap-2 px-4 py-2.5 rounded-full shadow-lg bg-primary text-primary-foreground hover:brightness-95 transition-[filter] focus:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center">
          <Bot className="w-3.5 h-3.5" />
        </div>
        <span className="text-sm font-medium">Ask AI</span>
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 sm:bottom-5 right-4 sm:right-5 z-40 w-[calc(100vw-2rem)] sm:w-96 h-[70vh] sm:h-[32rem] rounded-xl border bg-card shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center justify-between" style={{ background: 'linear-gradient(135deg, #6366f1, #8b5cf6)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
            <Bot className="w-4 h-4 text-white" />
          </div>
          <div>
            <span className="text-sm font-semibold text-white">Performance AI</span>
            <p className="text-[10px] text-white/70">Analyzing your accounts live</p>
          </div>
        </div>
        <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-white/10">
          <X className="w-4 h-4 text-white/70" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <p className="text-sm text-muted-foreground mb-4">Ask me anything about your accounts.</p>
            <div className="space-y-2">
              <button onClick={() => { setInput('Which accounts need attention right now?'); }} className="block w-full text-left text-xs text-muted-foreground hover:text-foreground bg-muted/30 rounded-md px-3 py-2 transition-colors">
                Which accounts need attention right now?
              </button>
              <button onClick={() => { setInput('What are the biggest levers to improve performance?'); }} className="block w-full text-left text-xs text-muted-foreground hover:text-foreground bg-muted/30 rounded-md px-3 py-2 transition-colors">
                What are the biggest levers to improve performance?
              </button>
              <button onClick={() => { setInput('Which accounts have the worst cost per appointment?'); }} className="block w-full text-left text-xs text-muted-foreground hover:text-foreground bg-muted/30 rounded-md px-3 py-2 transition-colors">
                Which accounts have the worst cost per appointment?
              </button>
            </div>
          </div>
        )}
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${msg.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted'}`}>
              <p className="whitespace-pre-wrap">{msg.content}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-muted rounded-lg px-3 py-2">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t px-4 py-3">
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') sendMessage(); }}
            placeholder="Ask about performance..."
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || loading}
            className="p-1.5 rounded-md transition-colors disabled:opacity-30"
            style={{ background: input.trim() && !loading ? '#6366f1' : 'transparent' }}
          >
            <Send className={`w-4 h-4 ${input.trim() && !loading ? 'text-white' : 'text-muted-foreground'}`} />
          </button>
        </div>
      </div>
    </div>
  );
}
