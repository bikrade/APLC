# APLC Redesign Plan

## 1. UI/UX Strategy (Duolingo-style)
- **Color Palette**: 
  - Primary: #58cc02 (Green - Success/Continue)
  - Secondary: #1cb0f6 (Blue - Main Actions/Start)
  - Warning/Error: #ff4b4b (Red - Incorrect)
  - Background: #ffffff (White) with #f7f9fc (Light Gray) for app shell
  - Text: #4b4b4b (Dark Gray)
- **Typography**: Large, readable sans-serif (Inter or similar), bold headings.
- **Components**: Rounded corners (16px+), soft shadows, clear visual hierarchy.
- **Animations**: Bouncy, playful but not distracting. Confetti for success, subtle shake for errors.

## 2. Frontend Architecture
- **Component Split**: Break down `App.tsx` into smaller components:
  - `Dashboard`: Home screen with stats, heatmap, and subject selection.
  - `Session`: The main learning flow.
  - `QuestionCard`: Displays the prompt and input.
  - `FeedbackBanner`: Success/Error states.
  - `ProgressBar`: Top of the session screen.
- **State Management**: Keep using React state but organize it better.
- **Styling**: Update `App.css` with the new design system. Add Tailwind-like utility classes or just write clean CSS.

## 3. Backend Updates
- **Dashboard Stats**: Add an endpoint `/dashboard/:userId` to calculate:
  - Total sessions completed.
  - Average accuracy.
  - Streak (days active).
  - Recent activity for a heatmap.
- **Subject Selection**: Update `/session/start` to accept a `subject` parameter (Multiplication, Division, Reading).

## 4. Implementation Steps
1. **Backend**: Add the `/dashboard/:userId` endpoint.
2. **Frontend - Dashboard**: Build the new home screen with stats and subject cards.
3. **Frontend - Session**: Redesign the session UI (progress bar, question card, input).
4. **Frontend - Feedback**: Enhance the feedback banners and animations.
5. **Testing**: Run end-to-end flows.

## 5. Reliability Status (Completed)
- Investigated "Failed to fetch" issue: frontend was running but backend was down/unreachable on port `3001`.
- Added backend runtime hardening:
  - Express error middleware
  - `unhandledRejection` and `uncaughtException` logging
  - server `error` event logging
- Added reliable local run scripts in `server/package.json`:
  - `dev:local`
  - `start:local`
  Both write logs to `data/server.log`.
- Added env-based API URL support in frontend:
  - `VITE_API_BASE_URL` in client
  - `.env.example` updated.
- Updated README with troubleshooting and reliable startup flow.
