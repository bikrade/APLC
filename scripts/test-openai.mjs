const base = 'http://localhost:3001'

async function test() {
  // Test 1: Start session (triggers OpenAI question generation)
  console.log('=== TEST 1: Start Session (AI Question Generation) ===')
  let startData
  try {
    const startRes = await fetch(base + '/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'adi', questionCount: 12 }),
    })
    startData = await startRes.json()
    console.log('Status:', startRes.status)
    console.log('Session ID:', startData.sessionId)
    console.log('Question count:', startData.questions?.length)
    console.log('First 3 questions:')
    startData.questions?.slice(0, 3).forEach((q) => console.log('  ', q.type, '-', q.prompt))
  } catch (err) {
    console.error('Session start failed:', err.message)
    return
  }

  const sid = startData.sessionId
  const uid = 'adi'

  // Test 2: Submit a wrong answer (triggers AI explanation)
  console.log('\n=== TEST 2: Submit Answer (AI Explanation) ===')
  const ansRes = await fetch(base + '/session/' + uid + '/' + sid + '/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionIndex: 0, answer: '999', elapsedMs: 5000, selfRating: 3 }),
  })
  const ansData = await ansRes.json()
  console.log('Status:', ansRes.status)
  console.log('isCorrect:', ansData.isCorrect)
  console.log('Explanation:', ansData.explanation)

  // Test 3: Get help on current question (triggers AI hints)
  console.log('\n=== TEST 3: Need Help (AI Hints) ===')
  const helpRes = await fetch(base + '/session/' + uid + '/' + sid + '/help', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ questionIndex: 1 }),
  })
  const helpData = await helpRes.json()
  console.log('Status:', helpRes.status)
  console.log('Help source:', helpData.helpSource)
  console.log('Hint steps:', helpData.helpSteps)

  console.log('\n=== ALL TESTS COMPLETE ===')
}

test().catch((e) => console.error('Test error:', e))
