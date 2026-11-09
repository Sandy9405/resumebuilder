// One Sarvam chat completion, to confirm the API key and SDK work.
// Run: node --env-file=.env scripts/sarvam-hello.mjs   (or on Railway, where SARVAM_API_KEY is set)
import { SarvamAIClient } from 'sarvamai';

const apiSubscriptionKey = process.env.SARVAM_API_KEY;
if (!apiSubscriptionKey) {
  console.error('SARVAM_API_KEY is not set.');
  process.exit(1);
}

const client = new SarvamAIClient({ apiSubscriptionKey });
const res = await client.chat.completions({
  model: 'sarvam-105b', // the only chat model this endpoint serves (besides sarvam-105b-conversations)
  messages: [{ role: 'user', content: 'Say hello in one short sentence.' }],
});
console.log(res.choices[0]?.message?.content);
