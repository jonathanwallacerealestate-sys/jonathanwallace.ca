# youtube-to-skill

A Claude skill that turns a YouTube tutorial into a new, owned Claude skill. See
`SKILL.md` for the full workflow. This README is only about getting the skill into
your library and the one thing to verify in Cowork.

## Installing it into your skill library

This folder is self-contained. To use it as a skill, save the whole
`youtube-to-skill/` directory into your skill library (the same place your other
skills live, for example `~/.claude/skills/youtube-to-skill/`). Once it is there,
Claude can trigger it by description, or you can invoke it by name.

The copy in this website repo is the versioned source of truth. The copy in your
skill library is what runs. Keep them in sync when you change one.

## What it needs

- `GEMINI_API_KEY` in the environment (free key at
  https://aistudio.google.com/apikey). See `SKILL.md`.
- `skill-creator` in the library (already present).
- Optional, Mac only: the `/watch` skill, for the second independent reader.

## The one thing to verify in Cowork

The Gemini pass calls `generativelanguage.googleapis.com`. The first time you run
it inside Cowork, confirm the sandbox can reach that host. If a run fails with a
network error rather than an API error, egress is blocked there and the Gemini
pass has to run somewhere with access, such as a Mac terminal. Everything else in
the skill works regardless.

## Layout

```
youtube-to-skill/
  SKILL.md                        the workflow Claude follows
  README.md                       this file
  scripts/gemini_review.py        Gemini server-side reviewer (zero dependencies)
  assets/claude-pass.template.md  template for the optional /watch reading
  assets/SPEC.template.md         template for the reconciled, labelled spec
  notes/                          created per video; holds the passes, SPEC, and
                                  question.txt; becomes the built skill's provenance
```
