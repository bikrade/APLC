# Product

## Vision
APLC (Adi’s Personal Learning Center) is a focused, personalized learning web app designed to help Adi strengthen his foundational math skills through structured, adaptive practice. The goal is to create a simple, engaging, and low-friction environment where Adi can practice daily, build confidence, and progressively improve his ability to solve multiplication problems involving decimals, fractions, and percentages before transitioning to Grade 7.

## User
The primary user is Adi, a CIS Grade 6 student following the IB curriculum. He will use the app independently on a laptop at home. The experience should be simple, intuitive, and minimally distracting, allowing him to focus on solving problems without needing supervision or technical guidance.

## Learning Goals
Over the next 4 months, Adi should significantly improve his ability to solve multiplication problems across the following areas:

Decimal × decimal multiplication
Fraction × fraction multiplication
Percentage-based multiplication
Mixed-type multiplication problems (combining decimals, fractions, and percentages)

The goal is to improve:

Accuracy of answers
Speed of solving problems
Conceptual clarity (not just memorization)
Confidence in handling increasingly complex problems
Put him in the top 5% percentile of in CIS Grade 6 students (think of similar IB schools)

## Scope for Phase 1
Phase 1 began as a dev prototype focused on multiplication and has since expanded to cover three subjects:

- **Multiplication**: Decimal, fraction, percentage, and mixed question types with rule-based and AI-generated questions.
- **Division**: Same question types as Multiplication with division-specific help steps.
- **Reading**: Fresh AI-written story-based comprehension for every new session, with pace-aware scoring, free-text summary for normal pace, and quiz-based comprehension checks for very fast reading.

Phase 1 includes:

A simple dev login (pre-filled, no authentication complexity)
A modern dashboard showing practice stats, progress, and a GitHub-style activity heatmap
A visible daily practice tracker showing how much time Adi spent yesterday and how much he has spent today toward a profile-driven habit goal
A single integrated learning flow across Multiplication, Division, and Reading
Let him start a session that will include 10-15 questions (similar lesson concept as Duolingo)
Before each new session, let him choose either a Guided Session or a Quiz Session
Each session should be designed in a way to finish in 30 min. Add 10-15 questions based on the time goal.
One-question-at-a-time practice flow, can move backwards to see previous questions, but not forward till current question done
Answer input and validation
“Need help” guided learning flow
“Show answer” option with explanation
Tracking time spent per question
Saving all session data locally in JSON files
Engaging, Duolingo-style UI with animated feedback, confetti for correct answers, and encouraging animations for incorrect answers
Landing-page learning coach with a best next step, mastery tracking, compact insight guidance, and parent review notes
Session-end coaching cards that celebrate wins, identify one growth target, and suggest the next short practice move

This phase still avoids a full recommendation engine and heavy analytics dashboards, but it now includes live adaptive behavior across multiplication, division, and reading.

## Functional Requirements
Adi can enter the app through a simple login screen with a pre-filled name and a login button
After login, Adi can start a multiplication practice session
The app presents one question at a time
Questions are aligned with CIS Grade 6 IB level
Adi can type and submit an answer
The app checks correctness and provides immediate feedback
In Guided Session mode, the app checks correctness and provides immediate feedback after each answer
In Quiz mode, the app records each answer and moves forward without instant right/wrong confirmation, then shows the full result review at the end
Adi can click “Need help” to receive step-by-step guidance without directly revealing the answer
Adi can click “Show answer” to see the correct answer and explanation
The app records:
question type and difficulty
Adi’s answer and correctness
time spent on each question
whether help or answer reveal was used
whether help, retries, or answer reveal were used
Adi cannot move to the next question until the current one is completed
In Quiz mode, a question is considered completed once Adi submits an answer or chooses to show the answer and explanation
Adi can navigate back to previous questions within the session
Each session and dashboard should reflect cumulative learning history, using recent sessions for trend detection and broader history for coaching stability
If there is no enough past data, say that we need at least 3 test data 
Use rule-based question generation or introduce AI early, use Azure Open AI using my API key
Difficulty progression be calculated based on accuracy, first-attempt success, time, hint/reveal usage, and whether the learner needed retries or answer reveal before completing the problem
Difficulty progression should never swing too quickly. The app should wait for a clear short-run pattern before raising or lowering challenge so Adi feels stretched but not punished, supported but not bored.
One gradual way to raise challenge in multiplication and division is to keep the same underlying math structure while sometimes presenting it as a short real-world word problem instead of a plain numeric expression. The app should maintain a mix of direct computation and brief situational prompts so Adi practices both calculation fluency and problem interpretation.
Reading sessions should generate a fresh story for each new session while keeping the passage internally coherent across all pages, the summary guidance, and the comprehension quiz. The goal is to preserve novelty without sacrificing fair comprehension scoring.
Allow him to pause & resume clock on any problem
optimal number of questions per session to be decided by the App & AI to allow Adi to finish in 30 min broadly 
Hints should be dynamically generated, only when help is asked
Real authentication will be done at the absolute end only the product is ready to go live, keep dummy login till then
Bring in an element of past performance influence future question in Phase 1 itself
When difficulty changes, tell Adi clearly and supportively so he understands why the app is adjusting
For reading, treat `130 WPM` as the target pace, score speed by the percentage of that target, and warn plus verify comprehension when pace climbs meaningfully above it
The home experience should include a visible best next step, subject mastery states, detailed insight guidance, and a compact parent review section on the same landing page
The home experience should also show a simple, motivating daily-practice progress bar for yesterday and today so Adi can build a profile-driven daily habit
The app should surface light in-flow reading coaching prompts and a short session-end coach summary so each session closes with celebration, reflection, and a next step

## Non-functional Requirements
The UI should be clean, simple, and child-friendly with minimal distractions
The app should be fast and responsive during local usage
The system should maintain clear separation between frontend and backend
Data should be stored in a structured, readable JSON format for future analysis
The architecture should be extensible for future addition of AI, more subjects, and cloud deployment
The system should be stable for daily usage without crashes or data loss

## User Flows
Primary flow:
Adi logs in → lands on modern dashboard (sees stats, streak, heatmap, daily practice bars, best next step, mastery, detailed insights, and parent review) → chooses Guided or Quiz under a subject → starts the session → sees first question → enters answer → receives the right style of feedback for the selected mode → proceeds through the session

Help flow:
Adi is stuck → clicks “Need help” → receives step-by-step guidance → attempts solution → submits answer

Give-up flow:
Adi cannot solve → clicks “Show answer” → sees solution and explanation → question marked as difficult → proceeds

Session flow:
Adi completes multiple questions → session data is saved locally → next session continues fresh but can use past data later

Quiz flow:
Adi wants a more assessment-like run → picks Quiz mode on the subject card → answers each question without instant correctness confirmation → optionally uses hints or shows the answer when stuck → sees a clean question-by-question review at the end

Learning coach flow:
Adi lands on the dashboard → sees a clear best next step, mastery by subject, and compact detailed insight guidance → starts the most helpful next session with clear purpose

Adaptive math flow:
Adi answers quickly, correctly, and independently across multiple questions → the next questions become a little harder and the UI explains why
Adi slows down, misses first attempts, or relies on reveals → the next questions become a little easier and the UI explains why

Adaptive reading flow:
Adi reads in the target band → writes a summary
Adi reads unusually fast → sees a warning and gets a short multiple-choice comprehension check instead of a summary

Reflection flow:
Adi finishes a session → sees one celebration, one growth area, and one suggested next action for tomorrow

## Celebration & Feedback UX
- Correct answers trigger multiple varieties of Duolingo-style confetti bursts (classic, shooting stars, school pride, cascade) and an animated overlay.
- Correct answers display a green feedback banner with a "Continue" button.
- Wrong answers trigger an encouraging animated overlay ("You can do it! 💪").
- Wrong answers display a blue/red encouragement banner with the AI-generated explanation and a "Next Question" button.
- Timer runs live during each question, changes color when time is running out, and pauses with the session.
- A progress bar and live score are always visible at the top of the session screen.
- Difficulty changes are surfaced with animated, supportive popups so challenge adjustments never feel random or punitive.
- The dashboard includes a calm coaching layer: best-next-step guidance, mastery chips, compact detailed insights, and a parent review panel designed to be readable by both Adi and a parent.
- The dashboard also includes a simple daily-practice habit tracker for today and yesterday against a visible profile-driven goal.
- Subject cards include a lightweight Guided vs Quiz mode picker with clear explanatory copy so Adi understands what kind of session he is starting.
- Reading pages can include light checkpoint prompts that steer attention toward meaning, inference, and page-level understanding without interrupting flow too heavily.

## Observability
- **Application Insights** (`aplc-insights`): auto-collects HTTP requests, dependencies, exceptions, and performance metrics.
- **Log Analytics** (`aplc-logs`): centralized log sink for Container Apps system logs and Application Insights telemetry.
- **Structured logging**: leveled logging (info, warn, error) with timestamps; request logger middleware logs every HTTP request.
- **Health probes**: liveness (30s), readiness (10s), startup (5s) on `/health`.
- **Azure Monitor Alerts**: error spike (≥5 errors in 15min) and container restart (≥3 in 15min).
- All OpenAI API calls are logged to console with latency, model, token usage, and finish reason.
- Startup diagnostics log: reports status of Google auth, Blob Storage, and App Insights configuration.

## Success Metrics
Adi uses the app consistently (daily or near-daily usage)
This has to be habit builder, show Github activity style daily heatmap of how regularly he has been practicing 
Improvement in answer accuracy over time, show key areas 
Reduction in average time taken per question
Increase in ability to handle higher difficulty questions
Reduced reliance on “Show answer” over time
Improved self-confidence in solving multiplication problems
Clearer weekly learning direction across multiplication, division, and reading
More durable progress through revisit practice on fragile skills

## UI UX requirement
Design and build the APLC Phase 1 interface by blending the strongest qualities of Duolingo and IXL. The product should feel warm, motivating, and visually polished like Duolingo, while also staying structured, academically focused, and distraction-free like IXL. This is not a game UI and it should not feel childish. It should feel like a premium personal learning tool for a bright Grade 6 student. The overall experience must be clean, calm, encouraging, and highly usable. Every screen should focus the learner on one clear task at a time, with minimal cognitive overload. Avoid clutter, noisy layouts, excessive widgets, too many competing buttons, or anything that looks like a generic admin dashboard. The design language should use soft rounded corners, clean spacing, large readable typography, clear hierarchy, and subtle positive reinforcement. The base background should stay white or very light. Use color intentionally, not decoratively: green for success and correct answers, red for incorrect feedback or warnings, and one calm primary accent color such as blue or purple for main actions like Start, Submit, Continue, and Next. Do not overuse gradients, shadows, badges, or animations. Motion should be minimal and purposeful.

For the React implementation, prioritize a component-driven architecture with reusable, clean UI primitives. Build the interface so that it feels smooth on laptop screens first, with responsive behavior that still works well on tablets. Use a centered content layout for the learning flow, with strong visual emphasis on the current question, answer box, and next action. The question screen should be the hero of the app. Mathematical expressions must be easy to read, with generous whitespace and strong contrast. Inputs should be large and obvious. Buttons should be easy to distinguish, with one clear primary CTA and secondary actions such as Need Help or Show Answer visually present but less dominant. Feedback after answer submission should be immediate and unmistakable. The user should instantly understand whether the answer was correct, incorrect, or partially correct. The UI should support states like loading, empty state, first-time user state, correct answer, wrong answer, hint mode, and reveal-answer mode in a polished way. Navigation should remain linear and minimal in Phase 1: login, home, session, and progress or summary. Do not introduce complex menus or dashboard-heavy layouts.

From a UX standpoint, optimize for confidence, clarity, and daily repeat use. The app should make Adi feel guided, never lost. Each screen should answer three questions clearly: what am I doing now, what should I do next, and how am I doing. The tone of the interface copy should be supportive, concise, and not overly playful. The app should feel intelligent and encouraging without sounding cartoonish. Use clear section hierarchy, accessible contrast, consistent spacing, and predictable interaction patterns throughout. Build the UI in a way that future phases can extend naturally into division, reading, adaptive recommendations, analytics, and Azure-based login, but keep Phase 1 visually focused on a single multiplication learning journey. Whenever there is a design decision conflict, choose simplicity over feature density, clarity over visual flair, and student focus over developer convenience.
