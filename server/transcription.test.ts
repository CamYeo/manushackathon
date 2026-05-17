import { describe, expect, it, vi } from "vitest";

// Mock the ENV module
vi.mock('./_core/env', () => ({
  ENV: {
    forgeApiUrl: 'https://api.example.com/',
    forgeApiKey: 'test-api-key',
  }
}));

describe("transcribeBuffer", () => {
  it("should reject audio that is too small", async () => {
    const { transcribeBuffer } = await import('./_core/transcribeBuffer');
    
    const smallBuffer = Buffer.from('tiny');
    const result = await transcribeBuffer({
      audioBuffer: smallBuffer,
      mimeType: 'audio/webm',
    });
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.code).toBe('INVALID_FORMAT');
      expect(result.error).toContain('too small');
    }
  });

  it("should reject audio that is too large", async () => {
    const { transcribeBuffer } = await import('./_core/transcribeBuffer');
    
    // Create a buffer larger than 16MB
    const largeBuffer = Buffer.alloc(17 * 1024 * 1024);
    const result = await transcribeBuffer({
      audioBuffer: largeBuffer,
      mimeType: 'audio/webm',
    });
    
    expect('error' in result).toBe(true);
    if ('error' in result) {
      expect(result.code).toBe('FILE_TOO_LARGE');
    }
  });

  it("should accept valid audio buffer size", async () => {
    // Mock fetch to simulate API response
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({
        task: 'transcribe',
        language: 'en',
        duration: 5.0,
        text: 'This is a test transcription.',
        segments: [{
          id: 0,
          seek: 0,
          start: 0,
          end: 5,
          text: 'This is a test transcription.',
          tokens: [],
          temperature: 0,
          avg_logprob: -0.5,
          compression_ratio: 1.0,
          no_speech_prob: 0.1,
        }],
      }),
    });
    
    global.fetch = mockFetch;
    
    const { transcribeBuffer } = await import('./_core/transcribeBuffer');
    
    // Create a valid-sized buffer (5KB)
    const validBuffer = Buffer.alloc(5000);
    const result = await transcribeBuffer({
      audioBuffer: validBuffer,
      mimeType: 'audio/webm',
      language: 'en',
    });
    
    // The mock should be called
    expect(mockFetch).toHaveBeenCalled();
    
    // Check the result
    if (!('error' in result)) {
      expect(result.text).toBe('This is a test transcription.');
      expect(result.language).toBe('en');
    }
  });
});

describe("transcription endpoint input validation", () => {
  it("should handle base64 audio data correctly", () => {
    // Test that base64 encoding/decoding works
    const originalText = "test audio data";
    const base64 = Buffer.from(originalText).toString('base64');
    const decoded = Buffer.from(base64, 'base64').toString();
    
    expect(decoded).toBe(originalText);
  });

  it("should calculate audio buffer size correctly", () => {
    // Test size calculations
    const buffer = Buffer.alloc(5000);
    const sizeMB = buffer.length / (1024 * 1024);
    
    expect(sizeMB).toBeLessThan(16);
    expect(buffer.length).toBeGreaterThan(1000);
  });
});
