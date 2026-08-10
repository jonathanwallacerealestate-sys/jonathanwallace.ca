#!/usr/bin/env python3
"""
gemini_review.py  --  Step 6 of the "YouTube to Agent" pipeline.

Sends a YouTube URL DIRECTLY to Gemini as a video part. Gemini fetches the
video server-side -- nothing is downloaded on this machine, so this works
even where YouTube itself is network-blocked.

Design choices (all deliberate, see SPEC / the brief):
  * ZERO third-party dependencies. Pure stdlib (urllib + json). Nothing to
    `pip install`, nothing to break. Runs on macOS or Linux with Python 3.8+.
  * Model fallback chain across the current Gemini *flash-tier* models. The
    chain is not hard-assumed: the script calls ListModels first and keeps
    only flash models that actually exist for your key and support
    generateContent, ordered by a preference list. Model names change --
    discovery means the script self-corrects instead of dying on a rename.
  * --fps 1 by default (raise it only for fast on-screen typing).
  * --samples 2 by default: it runs the whole review TWICE and keeps both.
    A claim that shows up in BOTH samples is far more trustworthy than one
    that appears in only one.
  * Optional --start / --end window (e.g. you only need one section).

Output: notes/gemini-pass.md, with every sample clearly separated.

Usage:
  export GEMINI_API_KEY=...            # free key from aistudio.google.com/apikey
  python3 scripts/gemini_review.py "https://www.youtube.com/watch?v=XXXX"

  # only review 2:05 -> 3:20, and bump fps for fast typing:
  python3 scripts/gemini_review.py URL --start 2:05 --end 3:20 --fps 2

  # attach the specific question you need answered (also read from
  # notes/question.txt automatically if present):
  python3 scripts/gemini_review.py URL --question "How do I wire the webhook?"
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request

API_ROOT = "https://generativelanguage.googleapis.com/v1beta"

# Preference order for the flash-tier fallback chain. This is only a *preference*
# -- the script intersects it with what ListModels actually returns for your key,
# and appends any other flash models it discovers. Verify names occasionally at
# https://ai.google.dev/gemini-api/docs/models  (names/availability drift).
PREFERRED_FLASH = [
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-2.0-flash",
    "gemini-2.0-flash-lite",
    "gemini-flash-latest",
]

# The six points every reading in this pipeline must cover (same as Claude's
# pass in Step 5). Kept identical on purpose so the two readings are comparable.
SIX_POINTS = """\
Review this video as a careful technical reader building a reusable skill from
it. Report ONLY what you actually observe on screen or hear said -- do not fill
gaps from general knowledge, and say "not shown" rather than guessing. Numbers
(durations, counts, timestamps) are unreliable from video, so treat them as
approximate; NAMED things (commands, tool names, exact strings, file paths,
error messages, config keys/values) are the reliable part -- capture those
verbatim, character for character.

Cover these six points, as headed sections:

1. WHAT IT TEACHES -- one paragraph: what is the video actually teaching / building?

2. STEP-BY-STEP BUILD -- the build as demonstrated, in order, each step a
   concrete action.

3. EXACT COMMANDS / CONFIG / STRINGS -- every command typed, every config value
   set, every exact string shown on screen. Quote them verbatim in code spans.

4. ASSUMED TOOLS / DEPENDENCIES -- tools or dependencies the video relies on but
   never installs on screen (they were already present).

5. STATED PREREQUISITES / ASIDES -- anything the presenter says in passing that
   assumes prior setup ("you'll want to have already done X"). Call these out --
   they are often the single most valuable lines in the whole video.

6. UNCLEAR / AMBIGUOUS / PRESENTER-SPECIFIC -- anything ambiguous, or that looks
   specific to this presenter's machine/account rather than generally true.
"""


def http_json(url, payload=None, timeout=600):
    """POST json (or GET when payload is None). Returns parsed JSON dict.
    Raises RuntimeError with the server body on non-2xx so callers can fall
    back to the next model instead of crashing."""
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST" if data is not None else "GET",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", "replace")
        raise RuntimeError(f"HTTP {e.code}: {body}") from None
    except urllib.error.URLError as e:
        raise RuntimeError(f"network error: {e.reason}") from None


def parse_offset(s):
    """Accept 90, '90', '90s', '1:30', '1:02:03' -> 'NNNs' duration string."""
    if s is None:
        return None
    s = str(s).strip()
    if s.endswith("s") and s[:-1].replace(".", "", 1).isdigit():
        return s
    if ":" in s:
        parts = [float(p) for p in s.split(":")]
        secs = 0.0
        for p in parts:
            secs = secs * 60 + p
        return f"{int(round(secs))}s"
    return f"{int(round(float(s)))}s"


def discover_flash_models(api_key):
    """Return the fallback chain: preferred flash models that actually exist for
    this key and support generateContent, followed by any other flash models
    discovered. Falls back to the raw preference list if ListModels fails."""
    try:
        data = http_json(f"{API_ROOT}/models?key={api_key}&pageSize=1000", timeout=60)
    except RuntimeError as e:
        print(f"  ! ListModels failed ({e}); using preferred names as-is.", file=sys.stderr)
        return list(PREFERRED_FLASH)

    available = {}
    for m in data.get("models", []):
        name = m.get("name", "").split("/")[-1]  # "models/gemini-2.5-flash" -> "gemini-2.5-flash"
        methods = m.get("supportedGenerationMethods", []) or m.get("supportedActions", [])
        if "generateContent" in methods:
            available[name] = m

    chain = [n for n in PREFERRED_FLASH if n in available]
    extras = sorted(
        n for n in available
        if "flash" in n and n not in chain and "thinking" not in n
    )
    chain.extend(extras)
    if not chain:  # nothing flash-y found; try preferred blindly
        chain = list(PREFERRED_FLASH)
    return chain


def build_payload(url, question, fps, start_off, end_off):
    video_meta = {"fps": fps}
    if start_off:
        video_meta["startOffset"] = start_off
    if end_off:
        video_meta["endOffset"] = end_off

    prompt = SIX_POINTS
    if question:
        prompt = (
            f"The person building this skill needs, above all, this answered:\n"
            f"    {question}\n\n"
            f"Keep that question front of mind throughout, then:\n\n" + SIX_POINTS
        )

    return {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {"fileData": {"fileUri": url}, "videoMetadata": video_meta},
                    {"text": prompt},
                ],
            }
        ],
        "generationConfig": {"temperature": 0.4, "maxOutputTokens": 8192},
    }


def run_one(api_key, chain, payload):
    """Try each model in the fallback chain until one returns text.
    Returns (model_used, text). Raises RuntimeError if all fail."""
    last_err = None
    for model in chain:
        url = f"{API_ROOT}/models/{model}:generateContent?key={api_key}"
        try:
            resp = http_json(url, payload)
        except RuntimeError as e:
            last_err = f"{model}: {e}"
            print(f"  ! {model} failed, trying next -> {str(e)[:160]}", file=sys.stderr)
            time.sleep(1.5)
            continue
        try:
            cand = resp["candidates"][0]
            text = "".join(p.get("text", "") for p in cand["content"]["parts"]).strip()
        except (KeyError, IndexError):
            fr = (resp.get("candidates") or [{}])[0].get("finishReason", "?")
            last_err = f"{model}: no text (finishReason={fr}, raw={json.dumps(resp)[:300]})"
            print(f"  ! {model} returned no text (finishReason={fr}), trying next", file=sys.stderr)
            continue
        if text:
            return model, text
        last_err = f"{model}: empty text"
    raise RuntimeError(f"all models in chain failed. last: {last_err}")


def main():
    ap = argparse.ArgumentParser(description="Gemini server-side video review (Step 6).")
    ap.add_argument("url", help="YouTube URL (Gemini fetches it server-side)")
    ap.add_argument("--question", default=None, help="the question you need answered")
    ap.add_argument("--fps", type=float, default=1.0, help="frames/sec sampled (default 1; raise for fast typing)")
    ap.add_argument("--samples", type=int, default=2, help="how many times to run (default 2)")
    ap.add_argument("--start", default=None, help="start offset, e.g. 2:05 or 125s")
    ap.add_argument("--end", default=None, help="end offset, e.g. 3:20 or 200s")
    ap.add_argument("--model", default=None, help="force a single model instead of discovering the chain")
    ap.add_argument("--out", default=None, help="output path (default: notes/gemini-pass.md next to this script's project)")
    args = ap.parse_args()

    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        sys.exit("ERROR: set GEMINI_API_KEY (get a free key at https://aistudio.google.com/apikey)")

    # default output: <pipeline>/notes/gemini-pass.md  (script lives in <pipeline>/scripts/)
    here = os.path.dirname(os.path.abspath(__file__))
    out_path = args.out or os.path.join(os.path.dirname(here), "notes", "gemini-pass.md")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)

    # question can also come from notes/question.txt (written by you or the pipeline)
    question = args.question
    if not question:
        qfile = os.path.join(os.path.dirname(here), "notes", "question.txt")
        if os.path.exists(qfile):
            with open(qfile) as f:
                question = f.read().strip() or None

    start_off = parse_offset(args.start)
    end_off = parse_offset(args.end)

    if args.model:
        chain = [args.model]
    else:
        print("Discovering current flash-tier models for your key ...", file=sys.stderr)
        chain = discover_flash_models(api_key)
    print(f"Fallback chain: {chain}", file=sys.stderr)

    payload = build_payload(args.url, question, args.fps, start_off, end_off)

    header = [
        "# Gemini pass  (Step 6 -- server-side reading)",
        "",
        f"- URL: {args.url}",
        f"- Window: {args.start or 'full'} -> {args.end or 'full'}",
        f"- fps: {args.fps}   samples: {args.samples}",
        f"- Question: {question or '(none supplied)'}",
        f"- Model fallback chain: {', '.join(chain)}",
        "",
        "> Two independent samples below. A claim in BOTH is far more trustworthy",
        "> than one in only a single sample. Numbers are decoration; named things",
        "> (commands, tool names, exact strings) are the reliable part.",
        "",
    ]
    sections = ["\n".join(header)]

    for i in range(1, args.samples + 1):
        print(f"Sample {i}/{args.samples} ...", file=sys.stderr)
        try:
            model_used, text = run_one(api_key, chain, payload)
        except RuntimeError as e:
            sys.exit(f"ERROR on sample {i}: {e}")
        sections.append(
            f"\n\n{'='*70}\n## SAMPLE {i}  (model: {model_used})\n{'='*70}\n\n{text}\n"
        )
        print(f"  ok  sample {i} via {model_used} ({len(text)} chars)", file=sys.stderr)

    with open(out_path, "w") as f:
        f.write("".join(sections))
    print(f"\nWrote {args.samples} sample(s) -> {out_path}")


if __name__ == "__main__":
    main()
