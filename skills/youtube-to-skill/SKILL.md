---
name: youtube-to-skill
description: >
  Turn a YouTube tutorial into a new, reusable Claude skill. Reads the video with
  two independent AI passes (Gemini server-side, always; Claude frame-by-frame via
  the /watch skill when it is installed), reconciles them into a labelled SPEC that
  separates what BOTH readings confirm from single-source and conflicting claims,
  then hands that SPEC to skill-creator to build the actual skill. Trigger when
  Jonathan Wallace pastes or names a YouTube URL and says "turn this into a skill",
  "make a skill from this video", "watch this tutorial", "learn this and build it",
  "youtube to skill", or asks to convert a tutorial, walkthrough, or demo into a
  skill or repeatable workflow. Built to run inside Claude Cowork with no local
  download required.
---

# youtube-to-skill

Convert a YouTube tutorial into an owned, portable Claude skill.

The whole point is **two independent readings that catch each other's mistakes.**
A single AI reading of a video invents plausible detail that was never on screen.
Two readings, reconciled, let you keep only what holds up. You end with a SPEC
where every claim is labelled, then skill-creator builds the skill from it.

This skill is infrastructure. It exists to move know-how out of scattered videos
and into skills Jonathan Wallace owns, which is the founder-dependency reduction
the Brain's North Star calls for. Any skill it produces that generates
client-facing copy must itself read the Brain North Star and obey the voice rules
(no em dashes, full name Jonathan Wallace, banned cliches, and the rest).

## Where this runs

- **Inside Claude Cowork (default): Gemini pass only.** Gemini fetches the video
  on Google's servers, so nothing is downloaded here and YouTube does not need to
  be reachable from the sandbox. This is the reliable path and it works with just
  a Gemini API key.
- **On a Mac terminal with `/watch` installed: full two-reader run.** There the
  Claude frame pass also runs, giving a genuinely independent second reader. Use
  this when a video is dense or high-stakes and the reconciliation matters.

The skill detects which case it is in and degrades gracefully. It never blocks on
`/watch` being present.

## What you need once

1. **Gemini API key** (free): https://aistudio.google.com/apikey
   Set it in the environment before running:

   ```bash
   export GEMINI_API_KEY=YOUR_KEY
   ```

   If you also want it to persist on your own machine, add that same line to
   `~/.zshrc` or `~/.bashrc`. Shell profile only. Never write the key into a repo,
   a project folder, or anything that syncs or commits.

2. **skill-creator** must be in the skill library (it is). Nothing to install.

3. **Optional, Mac only:** the `/watch` skill, for the second reader.
   `/plugin marketplace add bradautomates/claude-video` then
   `/plugin install watch@claude-video`. On first use it offers to install ffmpeg
   and yt-dlp via Homebrew. Accept. Runs with `--no-whisper` throughout.

## Inputs to gather from Jonathan before starting

Ask for these if he has not already given them. Do not guess.

1. **The YouTube URL.**
2. **What he wants out of it.** What is he building it into, what questions must
   be answered. This becomes the question the readings are told to keep front of
   mind, and it shapes the eventual skill.
3. **Talking vs on-screen.** Mostly a person talking, or mostly on-screen commands
   and terminal output. This sets `--fps` and, for `/watch`, the resolution.
4. **Whole video or one section.** If only one part matters, get a rough
   start and end (for example 2:05 to 3:20) so both readings review the same
   window.

## The workflow

Work from this skill's own directory so `notes/` sits beside the scripts and
becomes the built skill's provenance. Replace `SKILL_DIR` with wherever this skill
lives (its own folder in the skill library, or `skills/youtube-to-skill` in the
website repo).

```bash
cd SKILL_DIR
mkdir -p notes
```

Save Jonathan's question so the scripts pick it up automatically:

```bash
printf '%s\n' "HIS QUESTION HERE" > notes/question.txt
```

### Step 1 (optional, Mac with /watch only): Claude's pass

Only if `/watch` is installed. Skip entirely in Cowork.

```bash
# mostly talking:  add --detail transcript   (or leave default)
# mostly terminal: add --resolution 1024
/watch <URL> --no-whisper [--detail transcript | --resolution 1024] [--start M:SS --end M:SS]
```

Then read the extracted frames and captions and fill in
`notes/claude-pass.md` (copy the template from `assets/claude-pass.template.md`).
Write this BEFORE running the Gemini pass, so Claude's reading does not anchor to
Gemini's. If `/watch` is not available, note that in the file as "not run in this
environment" and move on.

### Step 2 (always): Gemini's pass

```bash
python3 scripts/gemini_review.py <URL> [--start M:SS --end M:SS] [--fps 2]
```

- Zero dependencies. Pure Python 3 standard library. Nothing to install.
- Default `--fps 1` and `--samples 2`. Raise `--fps` only for fast on-screen
  typing. Keep `--samples` at 2: a claim in both samples is far more trustworthy.
- It discovers the current flash-tier Gemini models for the key at run time and
  falls back through them, so a model rename does not break the run.
- Writes both samples, clearly separated, to `notes/gemini-pass.md`.

### Step 3 (always): Reconcile into SPEC.md

Put `notes/claude-pass.md` (if it exists) and `notes/gemini-pass.md` side by side
and write `notes/SPEC.md` from the `assets/SPEC.template.md` scaffold. Label every
claim:

- **CONFIRMED**: both readings agree (or, in Gemini-only mode, both samples agree).
- **SINGLE SOURCE**: only one reading or one sample has it. Note which.
- **CONFLICT**: the two disagree. Flag loudly. These are what Jonathan should
  double-check against the actual video.

End SPEC.md with an **OPEN QUESTIONS** section: everything the tutorial assumed,
skipped, or never explained. Keep this section permanently. It is the most useful
part long-term.

Reconciliation trust rules:

- **Named things are reliable**: commands, tool names, exact strings, file paths,
  error messages, config keys and values. Copy them verbatim.
- **Numbers are decoration**: durations, counts, timestamps. Do not trust them.
- A suspiciously fluent or over-complete line is a re-check candidate. That is
  usually training-data fill-in, not something observed in the video.

### Step 4 (always): Build the skill with skill-creator

Hand `notes/SPEC.md` to skill-creator. Let it interview Jonathan for anything
still missing, then have it write the new skill into the skill library. If the new
skill will produce client-facing copy, tell skill-creator it must read the Brain
North Star and follow the voice rules.

### Step 5 (always): Run the new skill once

Run the finished skill against one real input and fix whatever breaks. A skill
built from a spec but never executed is not finished. Do not report it as done
until it has run successfully once.

Finally, keep `notes/SPEC.md` and the whole `notes/` folder inside the new skill's
own directory, so the skill carries its own provenance.

## The one command to point this at a new video

```bash
cd SKILL_DIR && python3 scripts/gemini_review.py "<NEW_YOUTUBE_URL>"
```

Then reconcile into `notes/SPEC.md` and hand it to skill-creator. Everything else
is Claude reading and writing inside the session.

## gemini_review.py options

| flag | default | when to change |
|------|---------|----------------|
| `--fps N` | `1` | raise to 2+ for fast on-screen typing or rapid terminal output |
| `--samples N` | `2` | keep at 2. A claim in both samples is far more trustworthy |
| `--start` / `--end` | full video | you only need one section (`2:05` or `125s` both accepted) |
| `--question` | reads `notes/question.txt` | the one thing Jonathan most needs answered |
| `--model NAME` | auto-discover | force one model instead of the fallback chain |

## Notes

- `--no-whisper` throughout. No transcription fallback. If a video has no caption
  track and audio genuinely matters, add Whisper deliberately for that one video,
  not by default.
- First run inside Cowork, confirm the sandbox can reach
  `generativelanguage.googleapis.com`. If a run reports a network error rather than
  an API error, egress to that host is blocked and the Gemini pass has to run
  somewhere with access (a Mac terminal, for instance).
