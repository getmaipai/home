// AudioWorklet processor for microphone capture (mic-capture.ts). A real
// same-origin file, not a Blob URL: the page's Content-Security-Policy
// (script-src 'self') blocks a blob: module in Safari/WebKit, which made
// every Conversation start fail with "could not start the microphone".
// Posts each 128-sample input quantum to the main thread as a Float32Array.
class WakeWordMicProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel || channel.length === 0) return true;
    this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("wake-word-mic-processor", WakeWordMicProcessor);
