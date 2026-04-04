import { useState, useRef, useEffect } from 'react';
import { useData } from '@/hooks/useData';
import { MessageCircle, X, Send, Loader2 } from 'lucide-react';
import { formatCurrency, formatNumber, formatPercent } from '@/lib/dataService';

function buildContext(accounts: any[], settings: any): string {
  const mappings = (() => {
    try {
      const stored = localStorage.getItem('accountMappings');
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  })();

  const getMapping = (name: string) => {
    const match = mappings.find((m: any) => m.sheetName?.trim().toLowerCase() === name.trim().toLowerCase());
    return { program: match?.program || 'Done For You', status: match?.status || 'Active' };
  };

  const accountSummaries = accounts.map(a => {
    const { program, status } = getMapping(a.accountName);
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
      dials: a.totalDials,
      dialsPerLead: a.leads > 0 ? +(a.totalDials / a.leads).toFixed(1) : 0,
      leadToApptPct: a.leads > 0 ? +((a.appointments / a.leads) * 100).toFixed(1) : 0,
      showRate: a.appointments > 0 ? +((showedCount / a.appointments) * 100).toFixed(1) : 0,
      closed: a.closed,
      revenue: a.revenue,
    };
  });

  return JSON.stringify(accountSummaries, null, 2);
}

const SYSTEM_PROMPT = `You are the AI performance analyst for SocialWorks Pro, a performance marketing agency that runs Facebook/Instagram ads and appointment setting for outdoor living contractors (pergolas, pools, turf, pavers, outdoor kitchens).

You have access to live account performance data. When the user asks a question, analyze the data and respond.

BUSINESS CONTEXT:
- "Done For You" (DFY) accounts: we run ads AND set appointments. Primary metric is Cost Per Appointment (CPA).
- "Done With You" (DWY) accounts: we only run ads, client handles their own leads. Primary metric is Cost Per Lead (CPL).
- We charge clients per appointment (PPA model).

PERFORMANCE TARGETS:
- Cost per appointment (DFY): green under $180, yellow $180-240, red above $240
- Cost per lead: green under $35, yellow $35-55, red above $55
- Dials per lead: green 5-20, yellow 20-40, red under 5 (not working leads) or above 40 (grinding dead list)
- Lead-to-appointment rate: green above 15%, yellow 5-15%, red under 5%
- Dial booking rate: green above 8%, yellow 2-8%, red under 2%

RULES:
- Be direct and specific. No fluff. Sound like a sharp analyst, not a corporate bot.
- Reference specific account names and numbers when answering.
- If asked what needs attention, prioritize accounts that are red on key metrics.
- When diagnosing problems, trace the funnel: high CPA could be caused by high CPL (ad problem) or low lead-to-appt rate (call center problem). Identify which.
- Keep responses concise — 3-5 bullet points for overview questions, 2-3 sentences for specific account questions.
- Do not show status as "showed" — we don't fully trust that data because people forget to fill it out.`;

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
    const apiKey = settings.anthropicApiKey;
    if (!apiKey) {
      setMessages(prev => [...prev,
        { role: 'user', content: input.trim() },
        { role: 'assistant', content: 'No API key configured. Go to Settings → AI Assistant and add your Anthropic API key.' }
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
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
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
      setMessages(prev => [...prev, { role: 'assistant', content: 'Failed to reach Claude API. Check your API key and try again.' }]);
    } finally {
      setLoading(false);
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-40 w-12 h-12 rounded-full bg-primary text-primary-foreground shadow-lg hover:opacity-90 transition-opacity flex items-center justify-center"
      >
        <MessageCircle className="w-5 h-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-40 w-96 h-[32rem] rounded-xl border bg-card shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
        <div className="flex items-center gap-2">
          <MessageCircle className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold">Performance AI</span>
        </div>
        <button onClick={() => setOpen(false)} className="p-1 rounded hover:bg-muted">
          <X className="w-4 h-4" />
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
              <button onClick={() => { setInput('Is our call center dialing enough?'); }} className="block w-full text-left text-xs text-muted-foreground hover:text-foreground bg-muted/30 rounded-md px-3 py-2 transition-colors">
                Is our call center dialing enough?
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
          <button onClick={sendMessage} disabled={!input.trim() || loading} className="p-1.5 rounded-md bg-primary text-primary-foreground disabled:opacity-50">
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
