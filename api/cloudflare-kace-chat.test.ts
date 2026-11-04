import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  executeKaceChat,
  formatGeminiContents,
  formatClaudeMessages,
  buildKaceSystemPrompt,
  buildContextPayload,
  KACE_LEGAL_DISCLAIMER,
  OFFICIAL_ONTARIO_COURT_FORMS_URL,
  MAX_OUTPUT_TOKENS,
} from './services/kaceChatService';
import { handleChatRequest } from '../functions/api/chat';

describe('Kace Interactive AI Chatbot Service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('Prompt & Context Building', () => {
    it('builds system prompt with mandatory disclaimer and grade-10 tone', () => {
      const prompt = buildKaceSystemPrompt('rights');
      expect(prompt).toContain('Kace');
      expect(prompt).toContain('Grade 10 reading level');
      expect(prompt).toContain('DOCUMENTED FACT');
      expect(prompt).toContain('CYFSA s. 81');
      expect(prompt).toContain('5-DAY INITIAL COURT HEARING RULE');
      expect(prompt).toContain(KACE_LEGAL_DISCLAIMER);
    });

    it('builds forms context with prescribed Ontario Family Law Rules forms and official link', () => {
      const prompt = buildKaceSystemPrompt('forms');
      expect(prompt).toContain('Form 6B');
      expect(prompt).toContain('Form 8B');
      expect(prompt).toContain('Form 10');
      expect(prompt).toContain('Form 14A');
      expect(prompt).toContain('Form 33B.1');
      expect(prompt).toContain(OFFICIAL_ONTARIO_COURT_FORMS_URL);
    });

    it('builds CAS process context with Standards 1-7 and O. Reg. 155/18 complaint pathways', () => {
      const prompt = buildKaceSystemPrompt('cas_process');
      expect(prompt).toContain('Standard 1');
      expect(prompt).toContain('Standard 2');
      expect(prompt).toContain('Standard 6');
      expect(prompt).toContain('Standard 7');
      expect(prompt).toContain('30 calendar days');
      expect(prompt).toContain('O. Reg. 155/18');
      expect(prompt).toContain('CFSRB');
    });

    it('injects report context accurately into payload', () => {
      const { contextText, citations } = buildContextPayload('report', {
        mode: 'report',
        query: 'What does my ESI score mean?',
        reportContext: {
          fileName: 'CAS_Protection_Application.pdf',
          esiScore: 72,
          evidenceQuality: 'Substantiated',
          redFlags: [{ category: 'Hearsay', flag: 'Uncorroborated report', analysis: 'Anonymous referral without corroboration' }],
          chronology: [{ date: '2026-09-15', event: 'Unannounced home visit' }],
          contradictions: [{ issue: 'School attendance', sourceA: 'Worker note', sourceB: 'Principal letter' }],
        },
      });

      expect(contextText).toContain('CAS_Protection_Application.pdf');
      expect(contextText).toContain('Evidence Strength Index (ESI): 72/100');
      expect(contextText).toContain('Uncorroborated report');
      expect(contextText).toContain('School attendance');
      expect(citations.some((c) => c.title.includes('Red Flags'))).toBe(true);
    });
  });

  describe('Multi-turn Message Formatting', () => {
    it('formats turns properly for Gemini REST API', () => {
      const history = [
        { role: 'user' as const, content: 'Can CAS enter my house?' },
        { role: 'model' as const, content: 'No, CAS workers require parental consent or a warrant under s. 81.' },
      ];
      const contents = formatGeminiContents('What if they claim an emergency?', history);

      expect(contents.length).toBe(3);
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts[0].text).toBe('Can CAS enter my house?');
      expect(contents[1].role).toBe('model');
      expect(contents[2].role).toBe('user');
      expect(contents[2].parts[0].text).toBe('What if they claim an emergency?');
    });

    it('merges consecutive same-role turns for Gemini compatibility', () => {
      const history = [
        { role: 'user' as const, content: 'Question 1' },
        { role: 'user' as const, content: 'Question 1 addition' },
        { role: 'assistant' as const, content: 'Answer 1' },
      ];
      const contents = formatGeminiContents('Follow-up', history);

      expect(contents.length).toBe(3);
      expect(contents[0].role).toBe('user');
      expect(contents[0].parts[0].text).toContain('Question 1');
      expect(contents[0].parts[0].text).toContain('Question 1 addition');
      expect(contents[1].role).toBe('model');
      expect(contents[2].role).toBe('user');
    });

    it('formats turns properly for Claude Messages API', () => {
      const history = [
        { role: 'user' as const, content: 'Explain Form 10 Answer.' },
        { role: 'assistant' as const, content: 'Form 10 is your formal response in Ontario child protection court.' },
      ];
      const messages = formatClaudeMessages('What is the deadline to file it?', history);

      expect(messages.length).toBe(3);
      expect(messages[0].role).toBe('user');
      expect(messages[1].role).toBe('assistant');
      expect(messages[2].role).toBe('user');
      expect(messages[2].content).toBe('What is the deadline to file it?');
    });
  });

  describe('Dual-engine Execution (Gemini Default + Claude Option)', () => {
    it('uses Gemini as the default model when GEMINI_API_KEY is provided', async () => {
      let interceptedUrl = '';
      let interceptedBody: any = null;

      const mockFetcher = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        interceptedUrl = url;
        interceptedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: 'CAS workers do not have automatic power to enter a home without parental consent or a judicial warrant under CYFSA s. 81.',
                    },
                  ],
                },
                finishReason: 'STOP',
              },
            ],
            usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 65 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const response = await executeKaceChat(
        { GEMINI_API_KEY: 'test-gemini-key' },
        {
          mode: 'rights',
          query: 'Can a CAS worker enter my house without a warrant?',
        },
        { fetcher: mockFetcher as any }
      );

      expect(interceptedUrl).toContain('generativelanguage.googleapis.com');
      expect(interceptedUrl).toContain('gemini-3.6-flash');
      expect(interceptedBody.generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
      expect(interceptedBody.systemInstruction.parts[0].text).toContain('Kace');
      expect(response.answer).toContain('CYFSA s. 81');
      expect(response.answer).toContain(KACE_LEGAL_DISCLAIMER);
      expect(response.modelUsed).toContain('Gemini');
      expect(response.citations.length).toBeGreaterThan(0);
    });

    it('uses Claude when model: "claude" is explicitly selected', async () => {
      let interceptedUrl = '';
      let interceptedBody: any = null;

      const mockFetcher = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
        interceptedUrl = url;
        interceptedBody = JSON.parse(init?.body as string);
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: 'Form 14A is the general affidavit under Ontario Family Law Rules used to swear firsthand factual evidence.',
              },
            ],
            model: 'claude-3-5-sonnet-20241022',
            usage: { input_tokens: 200, output_tokens: 90 },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const response = await executeKaceChat(
        { ANTHROPIC_API_KEY: 'test-claude-key' },
        {
          mode: 'forms',
          query: 'How should I draft my Form 14A Affidavit?',
          model: 'claude',
          formNumber: '14A',
        },
        { fetcher: mockFetcher as any }
      );

      expect(interceptedUrl).toContain('api.anthropic.com/v1/messages');
      expect(interceptedBody.max_tokens).toBe(MAX_OUTPUT_TOKENS);
      expect(interceptedBody.messages[0].content).toContain('Form 14A');
      expect(response.answer).toContain('Form 14A');
      expect(response.modelUsed).toContain('Claude');
      expect(response.citations.some((c) => c.url === OFFICIAL_ONTARIO_COURT_FORMS_URL)).toBe(true);
    });

    it('falls back to Claude if Gemini call fails with transient error', async () => {
      const mockFetcher = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes('generativelanguage.googleapis.com')) {
          return new Response('Quota exhausted', { status: 429 });
        }
        return new Response(
          JSON.stringify({
            content: [
              {
                type: 'text',
                text: 'Under Ontario Child Protection Standard 2, the investigation must be completed within 30 days.',
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      });

      const response = await executeKaceChat(
        {
          GEMINI_API_KEY: 'gemini-key',
          ANTHROPIC_API_KEY: 'claude-key',
        },
        {
          mode: 'cas_process',
          query: 'What is the investigation timeline under Standard 2?',
        },
        { fetcher: mockFetcher as any }
      );

      expect(mockFetcher).toHaveBeenCalledTimes(2);
      expect(response.answer).toContain('Standard 2');
      expect(response.modelUsed).toContain('Fallback');
    });

    it('throws clean error when question is empty or exceeds length limit', async () => {
      await expect(
        executeKaceChat({ GEMINI_API_KEY: 'key' }, { mode: 'rights', query: '   ' })
      ).rejects.toThrow('Missing question');

      const longQuery = 'x'.repeat(4005);
      await expect(
        executeKaceChat({ GEMINI_API_KEY: 'key' }, { mode: 'rights', query: longQuery })
      ).rejects.toThrow('too long');
    });
  });

  describe('Cloudflare Pages Handler & Tenant Isolation (/api/chat)', () => {
    it('enforces tenant isolation: rejects unauthenticated requests in report mode when FIREBASE_PROJECT_ID is active', async () => {
      const request = new Request('https://cyfsa-navigator.pages.dev/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'report',
          query: 'Summarize my red flags',
          reportContext: { fileName: 'Private_Report.pdf', esiScore: 60 },
        }),
      });

      const response = await handleChatRequest(request, {
        FIREBASE_PROJECT_ID: 'test-project',
        GEMINI_API_KEY: 'key',
      });

      expect(response.status).toBe(403);
      const data = await response.json();
      expect(data.code).toBe('SECURE_REPORT_RETRIEVAL_REQUIRED');
    });

    it('rejects private report payloads disguised as public rights questions before invoking AI', async () => {
      const mockFetcher = vi.fn();
      const request = new Request('https://cyfsa-navigator.pages.dev/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'rights', query: 'Explain this', reportContext: { summary: 'Sensitive case details' } }),
      });
      const response = await handleChatRequest(request, { GEMINI_API_KEY: 'key' }, { fetcher: mockFetcher as any });
      expect(response.status).toBe(403);
      expect((await response.json()).code).toBe('SECURE_REPORT_RETRIEVAL_REQUIRED');
      expect(mockFetcher).not.toHaveBeenCalled();
    });

    it('rejects uploaded private files in forms mode before invoking AI', async () => {
      const mockFetcher = vi.fn();
      const request = new Request('https://cyfsa-navigator.pages.dev/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'forms', query: 'Help', files: [{ name: 'private.txt', content: 'Confidential' }] }),
      });
      const response = await handleChatRequest(request, { GEMINI_API_KEY: 'key' }, { fetcher: mockFetcher as any });
      expect(response.status).toBe(403);
      expect(mockFetcher).not.toHaveBeenCalled();
    });

    it('allows general educational inquiries in rights mode without authentication', async () => {
      const mockFetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'CYFSA s. 94 requires court attendance within 5 days of apprehension.' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const request = new Request('https://cyfsa-navigator.pages.dev/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'rights',
          query: 'How many days does CAS have to bring a child before court?',
        }),
      });

      const response = await handleChatRequest(
        request,
        {
          FIREBASE_PROJECT_ID: 'test-project',
          GEMINI_API_KEY: 'key',
        },
        { fetcher: mockFetcher as any }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.answer).toContain('CYFSA s. 94');
      expect(data.disclaimer).toBe(KACE_LEGAL_DISCLAIMER);
    });

    it('handles legacy focus parameter mapping smoothly for backward compatibility', async () => {
      const mockFetcher = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: 'Educational guidance for Ontario families.' }],
                },
              },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      );

      const request = new Request('https://cyfsa-navigator.pages.dev/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: 'What support is available?',
          focus: 'family-advocate',
        }),
      });

      const response = await handleChatRequest(
        request,
        { GEMINI_API_KEY: 'key' },
        { fetcher: mockFetcher as any }
      );

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.answer).toContain('Educational guidance');
      expect(data.mode).toBe('rights');
    });
  });
});
