// Quick test: does the OpenAI API key work?
import { readFileSync } from 'fs'

// Manual .env parse since dotenv isn't available at root
const envPath = new URL('../server/.env', import.meta.url).pathname
const envContent = readFileSync(envPath, 'utf8')
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/)
  if (match) process.env[match[1].trim()] = match[2].trim()
}

const apiKey = process.env.OPENAI_API_KEY
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'
console.log('API Key prefix:', apiKey?.slice(0, 12) + '...')
console.log('Model:', model)
console.log('Key length:', apiKey?.length)

try {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Say hello in one word.' }],
      max_tokens: 10,
    }),
  })
  console.log('HTTP Status:', res.status)
  const body = await res.text()
  console.log('Response:', body)
} catch (err) {
  console.error('Fetch error:', err.message)
}
