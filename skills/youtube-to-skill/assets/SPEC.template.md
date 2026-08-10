# SPEC  --  <video title / topic>

<!--
  Step 7: reconcile notes/claude-pass.md against notes/gemini-pass.md into this
  one file. Label EVERY claim:

    [CONFIRMED]      both readings agree
    [SINGLE SOURCE]  only one reading has it  (note which: claude / gemini)
    [CONFLICT]       the two readings disagree -- FLAG loudly, these are the
                     ones worth double-checking against the actual video

  Trust rules while reconciling:
    * Named things (commands, tool names, exact strings, error messages) are the
      reliable part. Copy them verbatim.
    * Numbers (durations, counts, timestamps) are decoration -- do not trust them.
    * A suspiciously fluent / over-complete line is a candidate for re-checking;
      that is usually training-data fill-in, not something observed in the video.
    * A claim appearing in BOTH gemini samples AND claude's pass is strongest.

  Keep this file (and notes/) inside the finished skill's own folder as its
  provenance. Do not delete after the skill is built -- OPEN QUESTIONS below is
  the most useful part long-term.
-->

- Source video:
- Reviewed window: full  (or START -> END)
- Built from: notes/claude-pass.md  +  notes/gemini-pass.md (2 samples)

## 1. What it teaches

## 2. Step-by-step build

## 3. Exact commands / config / strings

## 4. Assumed tools / dependencies

## 5. Stated prerequisites / asides

## 6. Unclear / ambiguous / presenter-specific

---

## OPEN QUESTIONS
<!--
  Everything the tutorial assumed, skipped, or never actually explained.
  KEEP THIS SECTION even after the skill is built. It is the most useful part of
  the whole output long-term.
-->

-
