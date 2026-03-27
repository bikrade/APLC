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

## Reading Generation And Evaluation

Reading mode now prefers AI-generated, original middle-grade fiction when OpenAI is configured, with a rule-based fallback only if AI generation is unavailable.

### Reading Story Generation Prompt

System prompt goals:

- Write fresh, original fiction for an 11-13 year old reader.
- Aim for the atmosphere, narrative momentum, emotional sincerity, and intellectual richness often found in acclaimed middle-grade literature, without imitating any specific copyrighted book, author, series, or character.
- Return structured JSON with:
  - `title`
  - `pages` (5 pages)
  - `summaryPrompt`
  - `summaryGuidance`
  - `keywordGroups`
  - `quizItems`
- Keep every story fresh and avoid prior titles from the learner's earlier sessions.
- Gradually raise depth, inference load, and sentence sophistication when recent reading speed and comprehension show Adi is comfortably above target.
- The runtime prompt now also uses a quality benchmark list for literary depth and age fit:
  - `The Hobbit`
  - `The Golden Compass`
  - `The Mysterious Benedict Society`
  - `Artemis Fowl`
  - `Island of the Blue Dolphins`
  - `Roll of Thunder, Hear My Cry`
  - `The Witch of Blackbird Pond`
  - `Where the Mountain Meets the Moon`
  - `Bomb: The Race to Build—and Steal—the World's Most Dangerous Weapon`
  - `I Am Malala`
- Those titles are used only as a benchmark for quality, depth, readability, courage, atmosphere, and intellectual richness. The prompt explicitly forbids imitation, paraphrase, homage plotting, or reuse of copyrighted characters or signature story structures.

Runtime prompt context includes:

- session seed / session id
- recent reading-performance summary
- challenge tier: `core`, `stretch`, or `advanced`
- list of prior story titles to avoid repeating

### Reading Scoring

- **Flow**: 6 reading pages (auto-pass, records read time) + either 1 free-text summary question or 1 multiple-choice comprehension quiz when reading pace is very high.
- **Comprehension score** (0–10): based on keyword-group coverage for summaries or quiz correctness for fast-reader quiz mode.
- **Vocabulary score** (0–10): summary-mode only, based on how many target passage words the learner uses or explains accurately in context.
- **Quiz comprehension score** (0–10): based on 4 story-specific multiple-choice questions.
- **Speed score** (0–10): uses the floored percentage of the `130 WPM` target pace, capped at 10, and only speeds meaningfully above target are treated as very fast.
- **Warnings**: very high pace can trigger a caution that the learner may be skimming rather than reading carefully.
- **Overall score**: summary mode blends comprehension, pace, and vocabulary use; quiz mode blends comprehension plus pace. Score >= 7 = pass.
- **WPM source of truth**: reading WPM is calculated on the server from reading-page word counts and reading-page elapsed time only, and the client summary now displays that server-recorded value instead of recomputing its own version.

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
