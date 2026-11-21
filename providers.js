'use strict';
// Public connection presets shared by the browser and the server. Never store keys here.
(function (root, factory) {
  const providers = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = providers;
  else root.HarborlineProviders = providers;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  return Object.freeze({
    openrouter: Object.freeze({label: 'OpenRouter', model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1', keyUrl: 'https://openrouter.ai/keys', protocol: 'chat', hint: 'Auto Free selects free models. Other model IDs can incur charges. Free availability and quotas vary.'}),
    openai: Object.freeze({label: 'OpenAI', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1', keyUrl: 'https://platform.openai.com/api-keys', protocol: 'chat', hint: 'Use an OpenAI API key. API billing is separate from a ChatGPT subscription.'}),
    anthropic: Object.freeze({label: 'Anthropic Claude', model: 'claude-sonnet-4-6', baseUrl: 'https://api.anthropic.com/v1', keyUrl: 'https://platform.claude.com/settings/keys', protocol: 'anthropic', hint: 'Use a Claude API key and a model enabled for your account. Provider usage charges apply.'}),
    gemini: Object.freeze({label: 'Google Gemini', model: 'gemini-3.8-flash', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', keyUrl: 'https://aistudio.google.com/apikey', protocol: 'gemini', hint: 'Use a Google AI Studio API key. Model access, free quotas, and billing depend on your project.'}),
    groq: Object.freeze({label: 'Groq', model: 'openai/gpt-oss-20b', baseUrl: 'https://api.groq.com/openai/v1', keyUrl: 'https://console.groq.com/keys', protocol: 'chat', hint: 'Use a Groq API key. Check your model permissions and free or paid quota in Groq Console.'}),
    deepseek: Object.freeze({label: 'DeepSeek', model: 'deepseek-flash', baseUrl: 'https://api.deepseek.com', keyUrl: 'https://platform.deepseek.com/api_keys', protocol: 'chat', hint: 'Use a DeepSeek API key. Your account must have access to the selected model and sufficient credits.'}),
    mistral: Object.freeze({label: 'Mistral', model: 'mistral-small-latest', baseUrl: 'https://api.mistral.ai/v1', keyUrl: 'https://console.mistral.ai/api-keys', protocol: 'chat', hint: 'Use a Mistral API key. Model availability and charges follow your Mistral account.'}),
    xai: Object.freeze({label: 'xAI Grok', model: 'grok-4.7', baseUrl: 'https://api.x.ai/v1', keyUrl: 'https://console.x.ai', protocol: 'chat', hint: 'Use an xAI API key. API credits are separate from a Grok or X subscription.'}),
    custom: Object.freeze({label: 'Custom compatible endpoint', model: '', baseUrl: '', keyUrl: '', protocol: 'chat', hint: 'For a public HTTPS OpenAI-compatible Chat Completions API with Bearer-key authentication. Enter its API base URL and exact model ID. Azure-specific authentication, local servers, and non-chat services need a dedicated adapter.'})
  });
});
