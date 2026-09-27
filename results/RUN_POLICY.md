## Run policy

Each system was run once per room. One bedroom run per system failed on a provider rate limit (HTTP 429) before producing any images and was restarted once; no run was redone for quality reasons. The staging-single-photo family run delivered 3 of 4 photos: one photo failed the system's own quality check and was not rerun, so it is counted as absent per PROTOCOL.md ("Absent angles"). Per-photo delivery status is in `results/<system>/images/<room>/notes.json`.
