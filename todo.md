# BrowserBrain repair checklist

- [ ] Inspect browser console and network logs for the no-answer failure.
- [ ] Confirm the generated model runtime is actually reachable from the deployed browser app.
- [ ] Replace fragile remote model loading with a reliable client-side loading strategy and explicit retry/error states.
- [ ] Make the generation adapter compatible with both WebLLM streams and the WASM fallback.
- [ ] Tighten the prompt and add deterministic fallback behavior when a model cannot initialize.
- [ ] Generate and integrate an original friendly assistant mark suitable for BrowserBrain.
- [ ] Verify prompt submission, streamed answer rendering, web context, mobile layout, and build checks.
- [ ] Save a checkpoint and push the repair to GitHub.
- [ ] Inspect the current commit author, committer, and GitHub CLI identity.
- [ ] Configure Git with the user's verified GitHub name and email.
- [ ] Rewrite only task-created commits if attribution is incorrect.
- [ ] Confirm whether a force push is required before changing the remote.
- [ ] Verify the corrected author identity on GitHub after the push.
