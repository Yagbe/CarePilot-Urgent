# Sharing this repo safely on GitHub

## Keep secrets out of the repo

- **Never commit `.env`** — It’s in `.gitignore`; it holds API keys and passwords. Only commit `.env.example` with placeholders (no real keys).
- **Check before pushing** — Run `git status` and make sure `.env` and `*.db` are not staged. If you ever committed a secret, rotate the key immediately and remove it from history (e.g. `git filter-branch` or BFG Repo-Cleaner).

## Your rights when the repo is public

- **Public repo ≠ giving away the code.** By default, others can *view* your code, but you still hold the copyright. The **LICENSE** file in this repo states “All rights reserved” so people know they can’t use or copy it without your permission.
- **Optional: make the repo private** if you don’t want anyone to see the code. You can switch it to public later when you’re ready.

## What to do before pushing

1. Confirm `.env` is not tracked: `git check-ignore .env` should output `.env`.
2. Use `.env.example` as the template; leave `OPENAI_API_KEY=` and `GEMINI_API_KEY=` empty in the committed file.
3. Don’t commit real databases (e.g. `carepilot.db` with real patient data); `*.db` is in `.gitignore`.

## If you want to allow reuse (e.g. open source)

You can replace **LICENSE** with an open license (e.g. MIT or Apache 2.0). That explicitly allows others to use and modify your code, usually with attribution. Until you do that, the current “All rights reserved” applies.
