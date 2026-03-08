import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.spyOn approach instead of vi.mock to avoid hoisting issues.
// We test the DiscordRestApi public interface by intercepting the underlying REST calls.

describe('DiscordRestApi', () => {
  let api: any;
  let mockRest: any;

  beforeEach(async () => {
    // Create a mock REST object with spied methods
    mockRest = {
      delete: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockResolvedValue(undefined),
      patch: vi.fn().mockResolvedValue(undefined),
      post: vi.fn().mockResolvedValue({ id: 'msg_123' }),
    };

    // Dynamically import the module and construct DiscordRestApi
    const mod = await import('../discordRestApi');
    api = new mod.DiscordRestApi('test-token');

    // Replace the internal REST instance with our mock
    (api as any).rest = mockRest;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('editMessage', () => {
    it('should call REST patch with correct route and content', async () => {
      await api.editMessage('chan1', 'msg1', 'new content');

      expect(mockRest.patch).toHaveBeenCalledWith('/channels/chan1/messages/msg1', {
        body: { content: 'new content' },
      });
    });
  });

  describe('triggerTyping', () => {
    it('should call REST post with typing route', async () => {
      await api.triggerTyping('chan1');
      expect(mockRest.post).toHaveBeenCalledWith('/channels/chan1/typing');
    });
  });

  describe('removeOwnReaction', () => {
    it('should call REST delete with encoded emoji', async () => {
      await api.removeOwnReaction('chan1', 'msg1', '👀');

      expect(mockRest.delete).toHaveBeenCalledWith(
        `/channels/chan1/messages/msg1/reactions/${encodeURIComponent('👀')}/@me`,
      );
    });
  });

  describe('updateChannelName', () => {
    it('should truncate name to 100 chars', async () => {
      const longName = 'x'.repeat(200);
      await api.updateChannelName('chan1', longName);

      expect(mockRest.patch).toHaveBeenCalledWith('/channels/chan1', {
        body: { name: 'x'.repeat(100) },
      });
    });
  });

  describe('createMessage', () => {
    it('should call REST post and return message id', async () => {
      mockRest.post.mockResolvedValueOnce({ id: 'new_msg' });

      const result = await api.createMessage('chan1', 'Hello');

      expect(mockRest.post).toHaveBeenCalledWith('/channels/chan1/messages', {
        body: { content: 'Hello' },
      });
      expect(result).toEqual({ id: 'new_msg' });
    });
  });
});
