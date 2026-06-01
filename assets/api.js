/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  api.js — Mahiru AI Model Engine                            ║
 * ║  Supports: Gemini, Grok, MahiruXUltra (special)            ║
 * ║  LangitDev © 2025                                           ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const MahiruAPI = (() => {

  // ── Model Registry ─────────────────────────────────────────────
  const MODELS = [
    {
      id: 'mahiru-x-ultra',
      label: '✦ MahiruX Ultra',
      badge: 'SPECIAL',
      desc: 'Model spesial Mahiru — paling cerdas & kreatif',
      provider: 'mahiru',
      icon: '✦',
      color: '#f59e0b',
    },
    {
      id: 'gemini-2.0-flash',
      label: 'Gemini 2.0 Flash',
      badge: 'FAST',
      desc: 'Cepat & akurat dari Google DeepMind',
      provider: 'gemini',
      icon: '◈',
      color: '#4285f4',
    },
    {
      id: 'gemini-1.5-pro',
      label: 'Gemini 1.5 Pro',
      badge: 'PRO',
      desc: 'Analisis mendalam, konteks panjang',
      provider: 'gemini',
      icon: '◈',
      color: '#4285f4',
    },
    {
      id: 'gemini-1.5-flash',
      label: 'Gemini 1.5 Flash',
      badge: 'FREE',
      desc: 'Ringan, cocok untuk percakapan sehari-hari',
      provider: 'gemini',
      icon: '◈',
      color: '#34a853',
    },
    {
      id: 'grok-3-mini',
      label: 'Grok 3 Mini',
      badge: 'FREE',
      desc: 'Model reasoning dari xAI / X',
      provider: 'grok',
      icon: '𝕏',
      color: '#e7e7e7',
    },
    {
      id: 'grok-beta',
      label: 'Grok Beta',
      badge: 'BETA',
      desc: 'Model Grok terbaru dengan kemampuan penuh',
      provider: 'grok',
      icon: '𝕏',
      color: '#e7e7e7',
    },
  ];

  // ── System prompt Mahiru ────────────────────────────────────────
  const SYSTEM_PROMPT = `Kamu adalah Mahiru, asisten AI canggih buatan LangitDev.
Kamu bisa membantu dalam coding, penulisan, analisis, kreatif, dan pertanyaan umum.
Jawab dalam bahasa yang sama dengan user. Default: Bahasa Indonesia.
Jika ditanya siapa kamu: kamu adalah Mahiru, AI dari LangitDev — bukan dari Google, xAI, atau perusahaan lain.
Bersikap ramah, cerdas, dan to the point.`;

  const MAHIRU_ULTRA_SYSTEM = `Kamu adalah MahiruX Ultra — versi paling canggih dari Mahiru AI buatan LangitDev.
Kamu memiliki kemampuan reasoning yang luar biasa, kreativitas tinggi, dan pemahaman mendalam.
Kamu selalu memberikan jawaban yang komprehensif, kreatif, dan sangat terstruktur.
Jika ditanya siapa kamu: kamu adalah MahiruX Ultra, AI eksklusif dari LangitDev.
Jawab dalam bahasa yang sama dengan user.`;

  // ── Get keys from settings ─────────────────────────────────────
  function getKeys() {
    const settings = MahiruAuth.getSettings();
    return {
      gemini: settings.geminiKey || '',
      grok:   settings.grokKey || '',
    };
  }

  // ── Gemini API ─────────────────────────────────────────────────
  async function callGemini(modelId, messages, onChunk) {
    const keys = getKeys();
    if (!keys.gemini) throw new Error('API Key Gemini belum diatur. Minta admin untuk mengatur di Settings.');

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:streamGenerateContent?alt=sse&key=${keys.gemini}`;

    // Convert messages to Gemini format
    const contents = messages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }]
    }));

    // Inject system prompt as first user turn if no system turn
    const systemInstruction = { parts: [{ text: SYSTEM_PROMPT }] };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: systemInstruction,
        contents,
        generationConfig: {
          temperature: 0.9,
          topK: 40,
          topP: 0.95,
          maxOutputTokens: 2048,
        },
        safetySettings: [
          { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
          { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        ]
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.error?.message || `HTTP ${response.status}`;
      if (response.status === 400) throw new Error('API Key Gemini tidak valid atau request error: ' + msg);
      if (response.status === 429) throw new Error('Rate limit Gemini tercapai. Coba lagi nanti.');
      throw new Error('Gemini error: ' + msg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data || data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
          if (text) {
            fullText += text;
            onChunk(text);
          }
        } catch {}
      }
    }

    return fullText;
  }

  // ── Grok API ───────────────────────────────────────────────────
  async function callGrok(modelId, messages, onChunk) {
    const keys = getKeys();
    if (!keys.grok) throw new Error('API Key Grok/xAI belum diatur. Minta admin untuk mengatur di Settings.');

    const apiMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...messages.map(m => ({ role: m.role, content: m.content }))
    ];

    const response = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${keys.grok}`,
      },
      body: JSON.stringify({
        model: modelId,
        messages: apiMessages,
        stream: true,
        max_tokens: 2048,
        temperature: 0.85,
      })
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      const msg = err.error?.message || `HTTP ${response.status}`;
      if (response.status === 401) throw new Error('API Key Grok tidak valid.');
      if (response.status === 429) throw new Error('Rate limit Grok tercapai.');
      throw new Error('Grok error: ' + msg);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let fullText = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            onChunk(delta);
          }
        } catch {}
      }
    }

    return fullText;
  }

  // ── MahiruX Ultra (uses best available model) ──────────────────
  async function callMahiruUltra(messages, onChunk) {
    const keys = getKeys();

    // Try Gemini 1.5 Pro first (most capable free tier), fallback to Flash
    if (keys.gemini) {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-pro:streamGenerateContent?alt=sse&key=${keys.gemini}`;
      const contents = messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: MAHIRU_ULTRA_SYSTEM }] },
          contents,
          generationConfig: {
            temperature: 1.0,
            topK: 64,
            topP: 0.95,
            maxOutputTokens: 4096,
          },
        })
      });

      if (!response.ok) {
        if (keys.grok) return callGrok('grok-beta', messages, onChunk);
        const err = await response.json().catch(() => ({}));
        throw new Error('MahiruX Ultra error: ' + (err.error?.message || response.status));
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '', fullText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (!data || data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text || '';
            if (text) { fullText += text; onChunk(text); }
          } catch {}
        }
      }
      return fullText;
    }

    if (keys.grok) return callGrok('grok-beta', messages, onChunk);
    throw new Error('Tidak ada API key tersedia untuk MahiruX Ultra. Minta admin mengatur di Settings.');
  }

  // ── Main send function ─────────────────────────────────────────
  async function send(modelId, messages, onChunk) {
    const model = MODELS.find(m => m.id === modelId);
    if (!model) throw new Error('Model tidak dikenali: ' + modelId);

    if (modelId === 'mahiru-x-ultra') return callMahiruUltra(messages, onChunk);
    if (model.provider === 'gemini') return callGemini(modelId, messages, onChunk);
    if (model.provider === 'grok') return callGrok(modelId, messages, onChunk);

    throw new Error('Provider tidak dikenali');
  }

  return { MODELS, send };

})();
