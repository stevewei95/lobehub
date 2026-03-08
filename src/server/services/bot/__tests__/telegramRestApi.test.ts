import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TelegramRestApi } from '../telegramRestApi';

describe('TelegramRestApi', () => {
  let api: TelegramRestApi;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    api = new TelegramRestApi('123:abc');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const okResponse = (result: Record<string, any> = {}) =>
    new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  describe('sendMessage', () => {
    it('should call Telegram API with correct params', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ message_id: 42 }));

      const result = await api.sendMessage('-100123', 'Hello');

      expect(fetchSpy).toHaveBeenCalledOnce();
      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.telegram.org/bot123:abc/sendMessage');
      expect(opts.method).toBe('POST');
      expect(JSON.parse(opts.body as string)).toEqual({
        chat_id: '-100123',
        text: 'Hello',
      });
      expect(result).toEqual({ message_id: 42 });
    });

    it('should truncate text exceeding 4096 characters', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({ message_id: 1 }));

      const longText = 'a'.repeat(5000);
      await api.sendMessage('-100123', longText);

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.text.length).toBe(4096);
      expect(body.text.endsWith('...')).toBe(true);
    });
  });

  describe('editMessageText', () => {
    it('should call editMessageText API', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({}));

      await api.editMessageText('-100123', 42, 'Updated');

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://api.telegram.org/bot123:abc/editMessageText');
      expect(JSON.parse(opts.body as string)).toEqual({
        chat_id: '-100123',
        message_id: 42,
        text: 'Updated',
      });
    });
  });

  describe('sendChatAction', () => {
    it('should default to typing action', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({}));

      await api.sendChatAction('-100123');

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body).toEqual({ action: 'typing', chat_id: '-100123' });
    });
  });

  describe('deleteMessage', () => {
    it('should call deleteMessage API', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({}));

      await api.deleteMessage('-100123', 42);

      const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('/deleteMessage');
      expect(JSON.parse(opts.body as string)).toEqual({
        chat_id: '-100123',
        message_id: 42,
      });
    });
  });

  describe('setMessageReaction', () => {
    it('should set reaction with emoji', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({}));

      await api.setMessageReaction('-100123', 42, '👀');

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.reaction).toEqual([{ emoji: '👀', type: 'emoji' }]);
    });
  });

  describe('removeMessageReaction', () => {
    it('should set empty reaction array', async () => {
      fetchSpy.mockResolvedValueOnce(okResponse({}));

      await api.removeMessageReaction('-100123', 42);

      const body = JSON.parse((fetchSpy.mock.calls[0] as [string, RequestInit])[1].body as string);
      expect(body.reaction).toEqual([]);
    });
  });

  describe('error handling', () => {
    it('should throw on HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Bad Request', { status: 400 }),
      );

      await expect(api.sendMessage('-100123', 'Hi')).rejects.toThrow(
        'Telegram API sendMessage failed: 400',
      );
    });

    it('should throw on logical error (ok: false)', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ description: 'message too old', error_code: 400, ok: false }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        ),
      );

      await expect(api.editMessageText('-100123', 1, 'test')).rejects.toThrow(
        'Telegram API editMessageText failed: 400 message too old',
      );
    });
  });
});
