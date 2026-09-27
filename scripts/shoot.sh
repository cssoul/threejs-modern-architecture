#!/usr/bin/env bash
# One-shot visual verification for a modern-architecture-growth project.
#
# Usage:
#   scripts/shoot.sh <url> <progress-0-1000> <out.png> [width] [height] [hour-label] [view-label]
#     e.g.  scripts/shoot.sh http://127.0.0.1:5173 560 /tmp/mid.png
#           scripts/shoot.sh http://127.0.0.1:5173 1000 /tmp/dusk.png 1440 900 黄昏 全景
#           scripts/shoot.sh http://127.0.0.1:5173 1000 /tmp/done.png 420 820
#
# Requires the `agent-browser` CLI on PATH.
#
# Traps this script exists to avoid:
#
#  1. agent-browser reuses ONE page context, so a second top-level `const`
#     throws "Identifier has already been declared" and the whole snippet
#     silently dies. Wrap every `eval` in an IIFE.
#
#  2. React renders asynchronously (input events flush sync-ish, clicks do not).
#     Reading `.transport time` in the *same* eval that clicked the play button
#     or dispatched `input` can return the PREVIOUS frame, so you "confirm" a
#     seek that never happened. Every read here happens in its own eval after a
#     sleep.
#
#  3. If the dev server died after the page was opened, `agent-browser open`
#     still "succeeds" but the page is blank: screenshots come back all-white
#     and every `querySelector` returns null ("no timeline", "?"). Probe with a
#     cheap eval and reopen from scratch when the probe fails.
#
#  4. Switching hour costs a PMREM rebuild + full repaint; the on-demand
#     renderer needs `needsFrame` (done inside applyTime) plus a couple of
#     seconds before the new sky is on screen.
#
#  5. `set viewport` MUST land BEFORE the build finishes, never after. The
#     framing value `baseHalfH` is computed once inside `frame()` — which runs
#     as the LAST build stage. `resize()` only rewrites left/right and never
#     recomputes `baseHalfH`, so a late viewport change leaves every preset /
#     focus framing stale. Hence: open -> set viewport -> sleep, in that order.
set -uo pipefail

URL="${1:?url required}"
PROGRESS="${2:-1000}"
OUT="${3:-/tmp/shot.png}"
WIDTH="${4:-1440}"
HEIGHT="${5:-900}"
HOUR="${6:-}"
VIEW="${7:-}"

# ---- open + probe ----------------------------------------------------------
probe() { agent-browser eval "(()=>!!document.querySelector('.transport'))()" 2>/dev/null; }
open_page() {
  agent-browser close >/dev/null 2>&1
  agent-browser open "$URL" >/dev/null 2>&1
  agent-browser set viewport "$WIDTH" "$HEIGHT" >/dev/null 2>&1
  sleep 6
}
open_page
tries=0
while [ "$(probe)" != "true" ]; do
  tries=$((tries+1))
  if [ "$tries" -ge 3 ]; then
    echo "ERROR: page did not come up at $URL (is the dev server running?)" >&2
    exit 1
  fi
  echo "page blank (dev server likely restarted) — reopening (try $tries)…" >&2
  open_page
done

# ---- hide the floating chrome ----------------------------------------------
# The brief card / control groups / transport bar / orbit hint all float ON TOP
# of the full-bleed canvas. Hiding them does not change the canvas size. The
# canvas is 100% x 100% of the viewport now, so NO cropping is needed.
agent-browser eval "(()=>{
  if(!document.getElementById('shoot-hide')) {
    const s=document.createElement('style');
    s.id='shoot-hide';
    s.textContent='.brief,.controls,.transport,.orbit-hint{display:none!important}';
    document.head.appendChild(s);
  }
  return 'overlays hidden';
})()"
sleep 1

# ---- pause, then let React flush -------------------------------------------
agent-browser eval "(()=>{
  const p=document.querySelector('.transport .play');
  if(p && p.textContent.trim()==='\u2161') p.click();
  return 'pause requested';
})()"
sleep 1

# ---- seek -------------------------------------------------------------------
agent-browser eval "(()=>{
  const el=document.querySelector('.timeline input');
  const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
  set.call(el,'${PROGRESS}');
  el.dispatchEvent(new Event('input',{bubbles:true}));
  return 'seek requested';
})()"
sleep 2

# ---- optional hour + view switches ------------------------------------------
pick() { # $1 = group index (0=time, 1=view), $2 = button label
  agent-browser eval "(()=>{
    const gs=[...document.querySelectorAll('.controls .control-group')];
    const b=[...gs[$1].querySelectorAll('button')].find(x=>x.textContent.trim()==='$2');
    if(!b) return 'MISSING';
    b.click();
    return b.textContent;
  })()"
}
if [ -n "$VIEW" ]; then
  echo -n "view: "; pick 1 "$VIEW"; sleep 3
fi
if [ -n "$HOUR" ]; then
  echo -n "hour: "; pick 0 "$HOUR"; sleep 4   # PMREM rebuild + repaint
fi

# ---- verify AFTER the flush — the only trustworthy frame read ----------------
echo -n 'frame: '
agent-browser eval "(()=>document.querySelector('.transport time')?.textContent||'?')()"

sleep 1
agent-browser screenshot "$OUT"

# ---- stats only stabilise once the render loop has been idle past its window;
#      reading right after a seek gives renderFps 0 on a perfectly healthy scene.
sleep 3
echo -n 'stats: '
agent-browser eval "(()=>document.querySelector('.three-scene')?.dataset.renderStats||'none')()"
echo
echo 'warnings/errors:'
agent-browser console | grep -viE 'vite\] conn|React DevTools' || true
echo "saved: $OUT"
