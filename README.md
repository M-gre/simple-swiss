# Swiss Tournament

A single-page Swiss-style tournament runner. Go to [m-gre.github.io/simple-swiss](https://m-gre.github.io/simple-swiss/) to use it.

## Run locally
Open `index.html` in a browser.

## Features
- Match format: single game, best of 3 (default) or best of 5
- Enter results by clicking the winner, then picking the game score (e.g. 2–1); single games can also be drawn
- Automatic Swiss pairing with rematch avoidance and at most one bye per player until everyone has had one
- Live standings with W-L record (W-D-L when there are draws), games won-lost and tiebreakers
- Drop / re-add players mid-tournament, with an optional forfeit for an unfinished match
- JSON export & import for backup
- Works on phones; print-friendly stylesheet

## Tiebreakers
Players on the same score are ranked by:
1. **Buchholz**: the average of their opponents' scores (full, cut-1 or median, chosen at the start). Byes are ignored, as in Magic tournaments.
2. **Game win %** (best of 3 / 5 only): share of games won. A bye counts as a clean match win (e.g. 2–0).

Players still tied after both share first place.
