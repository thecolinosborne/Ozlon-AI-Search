# Revised plan: make email queries reliable across the board

## Goal
Fix the recurring email-query failure pattern systemically, not just for Ben Tamburello / Gemini notes.

## What this will cover
This work will target the full class of email-reading requests, including:
- finding a specific person’s email
- summarizing an email body
- pulling linked Google Docs content from an email
- analyzing attachments when the useful content is not in the body
- returning a useful partial answer instead of the dead-end max-step fallback

## What I’ll change

### 1. Add a general anti-loop guard in the chat backend
Prevent repeated Gmail read cycles from consuming the whole tool budget.

This will detect patterns like:
- repeated `list_email_ids` calls with near-identical queries
- repeated `get_email` calls on the same message/thread
- repeated search → fetch → search loops that are not producing new information

When that happens, the backend will stop re-searching and switch to final synthesis from the material it already has.

### 2. Add explicit routing for common email intents
Tighten routing rules so the agent uses the shortest valid path for these email tasks:
- **Find + summarize email** → search once, fetch once, summarize
- **Find email + scan notes/doc** → search once, fetch once, then go straight to docs/attachment analysis
- **Analyze attachment** → use attachment-analysis path instead of bouncing inside Gmail tools
- **Analyze linked Google Doc** → detect the link/doc ID and move directly into document retrieval

### 3. Improve termination behavior for all email queries
If the backend has enough material to answer, it should answer.

I’ll make the loop terminate earlier when it already has:
- the relevant message body
- the relevant attachment metadata/content
- the linked doc target

And if the data is incomplete, it should return:
- what it found
- what it could not access
- the next missing step

Instead of the current generic “try again with a simpler request.”

### 4. Harden email content analysis paths
Review the Gmail/content-extraction flow so email queries work across:
- nested MIME emails
- Gemini notes style emails
- emails where the useful content is in the snippet/body
- emails where the useful content is in a linked doc
- emails where the useful content is in an attachment

### 5. Verify both backend and frontend end-to-end
I’ll validate both sides:

**Backend**
- chat tool loop termination
- Gmail read path
- analysis/doc handoff path
- final-answer synthesis

**Frontend**
- streamed response handling
- task/progress display during email analysis
- surfaced error/fallback messaging so failures are informative rather than dead ends

### 6. Re-test against multiple email-query patterns
I’ll test more than one scenario so this is not another one-off patch:
- summarize a person’s email
- summarize Gemini notes from an email
- pull notes from an email that links to a Google Doc
- analyze an email attachment

## Boundaries
- No UI redesign
- No broad architecture rewrite
- Surgical reliability improvements in the existing email/chat pipeline

## Expected outcome
After this work, email queries should stop repeatedly burning through the step budget. The system should either:
1. return the requested answer directly, or
2. return a precise partial-result explanation based on the real data it already gathered.

This is the broader fix for the recurring email issue, not just the Ben Tamburello case.