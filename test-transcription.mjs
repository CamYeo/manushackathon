// Test script to verify transcription API works
import { config } from 'dotenv';
config();

const FORGE_API_URL = process.env.BUILT_IN_FORGE_API_URL;
const FORGE_API_KEY = process.env.BUILT_IN_FORGE_API_KEY;

console.log('Testing transcription API...');
console.log('FORGE_API_URL:', FORGE_API_URL ? 'Set' : 'NOT SET');
console.log('FORGE_API_KEY:', FORGE_API_KEY ? 'Set' : 'NOT SET');

// Test 1: Check if we can upload to storage
async function testStorageUpload() {
  console.log('\n--- Test 1: Storage Upload ---');
  
  // Create a simple audio file (just some bytes for testing)
  const testData = Buffer.from('test audio data');
  const fileName = `test/transcription-test-${Date.now()}.txt`;
  
  const uploadUrl = new URL('v1/storage/upload', FORGE_API_URL.endsWith('/') ? FORGE_API_URL : `${FORGE_API_URL}/`);
  uploadUrl.searchParams.set('path', fileName);
  
  const formData = new FormData();
  const blob = new Blob([testData], { type: 'text/plain' });
  formData.append('file', blob, 'test.txt');
  
  try {
    const response = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FORGE_API_KEY}`,
      },
      body: formData,
    });
    
    if (!response.ok) {
      const text = await response.text();
      console.log('Upload failed:', response.status, text);
      return null;
    }
    
    const result = await response.json();
    console.log('Upload successful!');
    console.log('URL:', result.url);
    
    // Test if URL is accessible
    const checkResponse = await fetch(result.url, { method: 'HEAD' });
    console.log('URL accessible:', checkResponse.ok, checkResponse.status);
    
    return result.url;
  } catch (error) {
    console.log('Upload error:', error.message);
    return null;
  }
}

// Test 2: Test transcription with a real audio URL
async function testTranscription() {
  console.log('\n--- Test 2: Transcription API ---');
  
  // Use a public test audio file
  const testAudioUrl = 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3';
  
  const transcriptionUrl = new URL('v1/audio/transcriptions', FORGE_API_URL.endsWith('/') ? FORGE_API_URL : `${FORGE_API_URL}/`);
  
  // First download a small portion of the audio
  console.log('Downloading test audio...');
  try {
    const audioResponse = await fetch(testAudioUrl);
    if (!audioResponse.ok) {
      console.log('Failed to download test audio:', audioResponse.status);
      return;
    }
    
    // Get first 100KB only
    const audioBuffer = Buffer.from(await audioResponse.arrayBuffer()).slice(0, 100000);
    console.log('Audio size:', audioBuffer.length, 'bytes');
    
    // Upload to S3 first
    const fileName = `audio/test-${Date.now()}.mp3`;
    const uploadUrl = new URL('v1/storage/upload', FORGE_API_URL.endsWith('/') ? FORGE_API_URL : `${FORGE_API_URL}/`);
    uploadUrl.searchParams.set('path', fileName);
    
    const uploadForm = new FormData();
    const audioBlob = new Blob([audioBuffer], { type: 'audio/mpeg' });
    uploadForm.append('file', audioBlob, 'test.mp3');
    
    const uploadResponse = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${FORGE_API_KEY}` },
      body: uploadForm,
    });
    
    if (!uploadResponse.ok) {
      console.log('Audio upload failed:', uploadResponse.status);
      return;
    }
    
    const uploadResult = await uploadResponse.json();
    console.log('Audio uploaded to:', uploadResult.url);
    
    // Wait for S3 propagation
    console.log('Waiting 2 seconds for S3 propagation...');
    await new Promise(r => setTimeout(r, 2000));
    
    // Now transcribe
    console.log('Calling transcription API...');
    
    // Download the audio from S3 URL
    const s3AudioResponse = await fetch(uploadResult.url);
    if (!s3AudioResponse.ok) {
      console.log('Failed to download from S3:', s3AudioResponse.status);
      return;
    }
    
    const s3AudioBuffer = Buffer.from(await s3AudioResponse.arrayBuffer());
    console.log('Downloaded from S3:', s3AudioBuffer.length, 'bytes');
    
    const transcribeForm = new FormData();
    const transcribeBlob = new Blob([s3AudioBuffer], { type: 'audio/mpeg' });
    transcribeForm.append('file', transcribeBlob, 'audio.mp3');
    transcribeForm.append('model', 'whisper-1');
    transcribeForm.append('response_format', 'verbose_json');
    transcribeForm.append('prompt', 'Transcribe this audio');
    
    const transcribeResponse = await fetch(transcriptionUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${FORGE_API_KEY}`,
        'Accept-Encoding': 'identity',
      },
      body: transcribeForm,
    });
    
    if (!transcribeResponse.ok) {
      const text = await transcribeResponse.text();
      console.log('Transcription failed:', transcribeResponse.status, text);
      return;
    }
    
    const result = await transcribeResponse.json();
    console.log('Transcription successful!');
    console.log('Text:', result.text?.substring(0, 200) || 'No text');
    console.log('Language:', result.language);
    console.log('Duration:', result.duration);
    
  } catch (error) {
    console.log('Transcription error:', error.message);
  }
}

// Run tests
async function main() {
  await testStorageUpload();
  await testTranscription();
  console.log('\n--- Tests complete ---');
}

main().catch(console.error);
