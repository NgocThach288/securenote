SECURENOTE - LOCALHOST (self-destructing notes, Privnote style)

REQUIREMENTS: Python 3.8+. No extra packages needed.

RUN
  Windows   : double-click run.bat
  Mac/Linux : ./run.sh   (or: python3 server.py)
Then open:
  Create notes : http://localhost:8000/
  Admin        : http://localhost:8000/admin   (this machine only, no account needed)

STRUCTURE
  server.py             server + SQLite database (data.db is created automatically)
  static/index.html     create-note page        static/js/create.js
  static/note.html      recipient page          static/js/note.js
  static/admin.html     admin page              static/js/admin.js
  static/css/style.css  shared styles           static/js/common.js

OPTIONS
  PORT=9000 python server.py        change the port
  HOST=0.0.0.0 python server.py     allow other devices on your LAN (admin stays local-only)

WHAT THE READER PAGE DOES
- The note is drawn on a canvas, so the text is not in the page and cannot be selected or copied.
- Copy, cut, right-click, drag, save, print, view-source and DevTools shortcuts are blocked.
- When the window loses focus, the tab is switched, or a screenshot key is pressed
  (PrintScreen, Win+Shift+S, Cmd+Shift+3/4/5), the note is hidden and the clipboard is cleared.
- The reader's IP, the time and the note id are watermarked across the note and move every second.
- Optional viewing timer (30 s / 1 min / 5 min / none): the note is wiped from the screen when it ends.
- Every blocked action or screenshot attempt is logged and appears in the admin page.

IMPORTANT LIMITS (be honest with your users)
- A web page cannot truly prevent screenshots. A photo taken with another phone, a screen recorder,
  or a screenshot tool that does not trigger the signals above cannot be stopped.
  The moving watermark and the logs are there to deter and to trace leaks.
- Notes are end-to-end encrypted (AES-GCM) in the browser; the key is the part after # in the link.
- The admin sees times, IPs, devices, status and events, but never the note contents.
- Use http://localhost (or HTTPS). Plain http://192.168.x.x does not allow in-browser encryption.
- Delete data.db to wipe all data.
