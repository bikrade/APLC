# Prompts

## Prompting Strategy

- Phase 1 uses OpenAI API for question generation, hints, and per-answer explanations when configured.
- Rule-based fallback preserved for all three capabilities when OpenAI is not configured or API calls fail.

## System Prompts

### Hint Generation

> You are a Grade 6 math tutor. Return exactly 3 concise hint steps in plain text, one step per line, no final answer.

- Temperature: 0.3 | Max tokens: 160
- User message: `Question: <prompt>`

### Question Generation

> You are a Grade 6 math question generator for an IB student practising multiplication.
> Generate exactly {count} questions, rotating evenly through these types: decimal, fraction, percentage, mixed.
> Return ONLY a JSON array (no markdown fences, no commentary). Each element must have:
> { "prompt", "type", "answer" (number), "tolerance": 0.01, "helpSteps" (3 items), "explanation" }
> Rules: decimal = two 1-decimal-place numbers; fraction = two simple fractions, answer as decimal;
> percentage = percent of a whole number; mixed = decimal × fraction.

- Temperature: 0.7 | Max tokens: 2000
- User message: `Generate {count} multiplication practice questions now.`

### Explanation Generation

> You are a supportive Grade 6 math tutor. Given a multiplication question, the student's answer,
> and the correct answer, provide a concise 1–2 sentence explanation.
> [Correct]: briefly congratulate and reinforce the method.
> [Incorrect]: explain where they likely went wrong, show the correct approach, be encouraging.

- Temperature: 0.3 | Max tokens: 150
- User message: `Question: <prompt>\nStudent's answer: <userAnswer>\nCorrect answer: <correctAnswer>`

## Evaluation Criteria

- Hint clarity for Grade 6 learner.
- Mathematical correctness and step quality.
- Question variety and appropriate difficulty.
- Explanation accuracy and supportive tone.

## Reading Comprehension Evaluation

Reading mode uses a rule-based scoring system (no AI call):

- **Story**: "The Monsoon Clock" — 5 pages, ~5,000 words total.
- **Flow**: 5 reading pages (auto-pass, records read time) + 1 free-text summary question (~100 words).
- **Comprehension score** (0–10): keyword group coverage across 10 thematic groups (mira, dev, clock, notebook, tower, storm, warning, canal, town, teamwork). Each matched group = +1 point.
- **Speed score** (0–10): based on average WPM across the 5 reading pages. Target range: 120–140 WPM.
- **Overall score**: 65% comprehension + 35% speed. Score >= 7 = pass.

## Safety Notes

- Avoid unsafe, biased, or discouraging language.
- Never expose secrets, keys, or internal config in prompt content.
- AI responses are validated server-side before being sent to the client.

## Iteration Log

- Phase 1 now supports runtime OpenAI hints in `Need Help` flow when configured.
- OpenAI question generation added: all session questions generated via one API call at session start.
- OpenAI explanation generation added: personalized feedback after each answer submission.
- Fallback to rule-based questions and static explanations on any AI failure.
- Switched from Azure OpenAI to OpenAI API directly (simpler config: just OPENAI_API_KEY + optional OPENAI_MODEL).
- All OpenAI calls now emit structured console logs with latency, token counts, model, and finish reason.
- Call-stat accumulator captures per-call metrics in memory for downstream logging.
- Application Insights auto-collects outbound HTTP calls (including OpenAI API requests) for end-to-end tracing.
