import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LarkRestApi } from '../larkRestApi';

describe('LarkRestApi', () => {
  let api: LarkRestApi;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const tokenResponse = () =>
    new Response(
      JSON.stringify({
        code: 0,
        expire: 7200,
        msg: 'ok',
        tenant_access_token: 'test-token',
      }),
      { headers: { 'Content-Type': 'application/json' }, status: 200 },
    );

  const okResponse = (data: Record<string, any> = {}) =>
    new Response(JSON.stringify({ code: 0, data, msg: 'ok' }), {
      headers: { 'Content-Type': 'application/json' },
      status: 200,
    });

  beforeEach(() => {
    api = new LarkRestApi('cli_xxx', 'secret', 'lark');
    fetchSpy = vi.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getTenantAccessToken', () => {
    it('should fetch and cache tenant access token', async () => {
      fetchSpy.mockResolvedValueOnce(tokenResponse());

      const token = await api.getTenantAccessToken();
      expect(token).toBe('test-token');

      // Second call should use cache (no additional fetch)
      const token2 = await api.getTenantAccessToken();
      expect(token2).toBe('test-token');
      expect(fetchSpy).toHaveBeenCalledOnce();
    });

    it('should use larksuite.com base URL for lark platform', async () => {
      fetchSpy.mockResolvedValueOnce(tokenResponse());

      await api.getTenantAccessToken();

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('open.larksuite.com');
    });

    it('should use feishu.cn base URL for feishu platform', async () => {
      const feishuApi = new LarkRestApi('cli_xxx', 'secret', 'feishu');
      fetchSpy.mockResolvedValueOnce(tokenResponse());

      await feishuApi.getTenantAccessToken();

      const [url] = fetchSpy.mock.calls[0] as [string, RequestInit];
      expect(url).toContain('open.feishu.cn');
    });

    it('should throw on auth error code', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response(
          JSON.stringify({ code: 10003, msg: 'invalid app_secret' }),
          { headers: { 'Content-Type': 'application/json' }, status: 200 },
        ),
      );

      await expect(api.getTenantAccessToken()).rejects.toThrow('Lark auth error: 10003');
    });

    it('should throw on HTTP error', async () => {
      fetchSpy.mockResolvedValueOnce(
        new Response('Unauthorized', { status: 401 }),
      );

      await expect(api.getTenantAccessToken()).rejects.toThrow('Lark auth failed: 401');
    });
  });

  describe('sendMessage', () => {
    it('should send text message', async () => {
      fetchSpy
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse({ message_id: 'om_xxx' }));

      const result = await api.sendMessage('oc_chat1', 'Hello');
      expect(result).toEqual({ messageId: 'om_xxx' });

      const [url, opts] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('/im/v1/messages');
      expect(JSON.parse(opts.body as string)).toEqual({
        content: JSON.stringify({ text: 'Hello' }),
        msg_type: 'text',
        receive_id: 'oc_chat1',
      });
    });

    it('should truncate long messages', async () => {
      fetchSpy
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse({ message_id: 'om_xxx' }));

      const longText = 'a'.repeat(5000);
      await api.sendMessage('oc_chat1', longText);

      const body = JSON.parse((fetchSpy.mock.calls[1] as [string, RequestInit])[1].body as string);
      const content = JSON.parse(body.content);
      expect(content.text.length).toBe(4000);
      expect(content.text.endsWith('...')).toBe(true);
    });
  });

  describe('editMessage', () => {
    it('should edit message by messageId', async () => {
      fetchSpy
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse({}));

      await api.editMessage('om_xxx', 'Updated');

      const [url, opts] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('/im/v1/messages/om_xxx');
      expect(opts.method).toBe('PUT');
    });
  });

  describe('replyMessage', () => {
    it('should reply to a message', async () => {
      fetchSpy
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(okResponse({ message_id: 'om_reply' }));

      const result = await api.replyMessage('om_xxx', 'Reply text');
      expect(result).toEqual({ messageId: 'om_reply' });

      const [url] = fetchSpy.mock.calls[1] as [string, RequestInit];
      expect(url).toContain('/im/v1/messages/om_xxx/reply');
    });
  });

  describe('error handling', () => {
    it('should throw on API logical error (code != 0)', async () => {
      fetchSpy
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response(
            JSON.stringify({ code: 230001, msg: 'bot not in chat' }),
            { headers: { 'Content-Type': 'application/json' }, status: 200 },
          ),
        );

      await expect(api.sendMessage('oc_chat1', 'Hello')).rejects.toThrow(
        'Lark API POST /im/v1/messages?receive_id_type=chat_id failed: 230001 bot not in chat',
      );
    });

    it('should throw on HTTP error', async () => {
      fetchSpy
        .mockResolvedValueOnce(tokenResponse())
        .mockResolvedValueOnce(
          new Response('Internal Server Error', { status: 500 }),
        );

      await expect(api.sendMessage('oc_chat1', 'Hello')).rejects.toThrow(
        'Lark API POST /im/v1/messages?receive_id_type=chat_id failed: 500',
      );
    });
  });
});
