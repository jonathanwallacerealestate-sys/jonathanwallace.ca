# Photo Vision — Listing photo extraction

Takes the photos attached to a deal card and extracts everything visible
that could populate the listing-form data sheet.

## Flow

```
  Photos in /data/listing-forms/<id>/photos/
         │
         ▼
  analyzePhoto(buffer, ctx) per photo
         │   (one Anthropic vision call,
         │    one prompt that does classification + extraction)
         ▼
  Per-photo JSON: { classification, fields: {...}, descriptive: "..." }
         │
         ▼
  mergeResults([ ...perPhoto ])
         │   (vote/majority per field, collect evidence list,
         │    build a combined descriptive paragraph)
         ▼
  Suggestions: [{ field, value, confidence, evidence: [...filenames] }]
```

## The contract

`analyzePhoto(buffer, ctx)` — takes a `Buffer` of an image, returns a
`Promise<PerPhotoResult>`. Does not throw: errors are caught and returned
as `{ ok: false, error }`.

`mergeResults(perPhotoList)` — takes an array of per-photo results and
returns a `MergedSuggestions` payload suitable for the UI.

## Why one big prompt instead of category modules (for now)

- Fewer API round-trips (1 per photo instead of 6+)
- Cheaper and faster at 20–60-photo scale
- Easier to tune with real photos in-hand

If any one category (roof condition banding, bath piece-count) becomes a
reliability problem, split that category into its own module under
`categories/` and call it in addition to the generalist pass — the
dispatcher pattern already anticipates it.

## Model

`claude-haiku-4-5-20251001` — the model the rest of server.js uses.
Vision-capable, fast, cheap.

## Correction feedback loop (planned, not built)

When Jonathan rejects a suggestion, we'll append his corrected value to a
per-field examples file and inject a few-shot block into the prompt on
the next run. For the MVP this file isn't written yet; rejections are
logged but don't change behavior. Hook point is already in place.
