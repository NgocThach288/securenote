#!/usr/bin/env python3
"""SecureNote - runs on localhost. Python standard library only (no pip install needed)."""
import hashlib, json, mimetypes, os, re, secrets, sqlite3, time
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

BASE = os.path.dirname(os.path.abspath(__file__))
STATIC = os.path.join(BASE, "static")
DB = os.path.join(BASE, "data.db")
HOST = os.environ.get("HOST", "127.0.0.1")   # set HOST=0.0.0.0 to let other devices on your LAN reach it
PORT = int(os.environ.get("PORT", "8000"))
now = lambda: int(time.time())
pbk = lambda pw, salt: hashlib.pbkdf2_hmac("sha256", pw.encode(), salt.encode(), 100000).hex()

def db():
    c = sqlite3.connect(DB, timeout=10)
    c.row_factory = sqlite3.Row
    return c

def init():
    c = db()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY, ct TEXT, salt TEXT, pw TEXT,
      state TEXT DEFAULT 'Unread', created INT, expires INT, cip TEXT, cua TEXT, size INT,
      read_at INT, rip TEXT, rua TEXT, fails INT DEFAULT 0, vkey TEXT);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT, note_id TEXT,
      ts INT, ip TEXT, ua TEXT, ev TEXT, warn INT DEFAULT 0);""")
    cols = [r[1] for r in c.execute("PRAGMA table_info(notes)")]
    if "vkey" not in cols: c.execute("ALTER TABLE notes ADD COLUMN vkey TEXT")
    for old, new in (("Chưa đọc", "Unread"), ("Đã đọc", "Read"), ("Hết hạn", "Expired"), ("Đã hủy", "Destroyed")):
        c.execute("UPDATE notes SET state=? WHERE state=?", (new, old))
    c.commit(); c.close()

class H(BaseHTTPRequestHandler):
    server_version = "SecureNote"
    def log_message(self, *a): pass

    # ---------- helpers ----------
    def ip(self): return self.client_address[0]
    def ua(self): return (self.headers.get("User-Agent") or "")[:200]
    def is_local(self):
        host = (self.headers.get("Host") or "").rsplit(":", 1)[0].strip("[]")
        return (self.ip() in ("127.0.0.1", "::1") and host in ("localhost", "127.0.0.1", "::1")
                and "X-Forwarded-For" not in self.headers)
    def send_(self, code, data, ctype):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers(); self.wfile.write(data)
    def js(self, obj, code=200): self.send_(code, json.dumps(obj, ensure_ascii=False).encode(), "application/json; charset=utf-8")
    def body(self):
        n = int(self.headers.get("Content-Length") or 0)
        if n > 300000: return {}
        try: return json.loads(self.rfile.read(n) or b"{}")
        except Exception: return {}
    def ev(self, c, nid, e, w=0):
        c.execute("INSERT INTO events(note_id,ts,ip,ua,ev,warn) VALUES(?,?,?,?,?,?)", (nid, now(), self.ip(), self.ua(), e, w))

    # ---------- routing ----------
    def do_GET(self): self.route("GET")
    def do_POST(self): self.route("POST")
    def do_DELETE(self): self.route("DELETE")
    def route(self, m):
        p = urlparse(self.path).path
        try:
            if p.startswith("/api/"): return self.api(m, p)
            if m != "GET": return self.js({"error": "method"}, 405)
            return self.static(p)
        except Exception as e:
            print("Error:", e); self.js({"error": "server"}, 500)

    def static(self, p):
        if p == "/": f = "index.html"
        elif p == "/admin":
            if not self.is_local():
                return self.send_(403, ("The admin page can only be opened on the machine running the server (http://localhost:%d/admin)." % PORT).encode(), "text/plain; charset=utf-8")
            f = "admin.html"
        elif re.fullmatch(r"/n/[a-f0-9]+", p): f = "note.html"
        elif p.startswith(("/css/", "/js/")): f = p.lstrip("/")
        else: return self.send_(404, b"Not found", "text/plain")
        fp = os.path.normpath(os.path.join(STATIC, f))
        if not fp.startswith(STATIC) or not os.path.isfile(fp): return self.send_(404, b"Not found", "text/plain")
        ct = mimetypes.guess_type(fp)[0] or "application/octet-stream"
        self.send_(200, open(fp, "rb").read(), ct + ("; charset=utf-8" if ct.startswith(("text/", "application/javascript")) else ""))

    def api(self, m, p):
        c = db()
        try:
            c.execute("UPDATE notes SET ct=NULL,state='Expired' WHERE state='Unread' AND expires<?", (now(),))
            # ----- create note (content is encrypted in the browser) -----
            if p == "/api/notes" and m == "POST":
                b = self.body(); data = str(b.get("data") or "")
                if not re.fullmatch(r"[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+", data) or len(data) > 120000:
                    return self.js({"error": "Invalid or too large data"}, 400)
                if c.execute("SELECT COUNT(*) FROM notes WHERE cip=? AND created>?", (self.ip(), now() - 60)).fetchone()[0] >= 10:
                    return self.js({"error": "Too many notes, try again in a minute"}, 429)
                try: exp = int(b.get("expire"))
                except Exception: exp = 86400
                if exp not in (3600, 86400, 604800, 2592000): exp = 86400
                salt = pw = None
                if b.get("password"): salt = secrets.token_hex(8); pw = pbk(str(b["password"])[:200], salt)
                nid = secrets.token_hex(8)
                c.execute("INSERT INTO notes(id,ct,salt,pw,state,created,expires,cip,cua,size) VALUES(?,?,?,?,'Unread',?,?,?,?,?)",
                          (nid, data, salt, pw, now(), now() + exp, self.ip(), self.ua(), len(data)))
                self.ev(c, nid, "Note created" + (" (password protected)" if pw else ""))
                return self.js({"id": nid})
            # ----- recipient: info / read / event -----
            mm = re.fullmatch(r"/api/n/([a-f0-9]+)/(info|read|event)", p)
            if mm:
                nid, a = mm.groups()
                n = c.execute("SELECT * FROM notes WHERE id=?", (nid,)).fetchone()
                if not n: return self.js({"error": "gone"}, 404)
                if a == "event" and m == "POST":
                    b = self.body()
                    if (n["state"] == "Read" and n["vkey"] and secrets.compare_digest(n["vkey"], str(b.get("key") or ""))
                            and now() - (n["read_at"] or 0) < 7200
                            and c.execute("SELECT COUNT(*) FROM events WHERE note_id=?", (nid,)).fetchone()[0] < 300):
                        self.ev(c, nid, str(b.get("ev") or "?")[:120], 1 if b.get("warn") else 0)
                    return self.js({"ok": True})
                live = n["state"] == "Unread"
                if a == "info" and m == "GET":
                    self.ev(c, nid, "Page opened (not yet revealed)", 0 if live else 1)
                    return self.js({"pw": bool(n["pw"])}) if live else self.js({"error": "gone"}, 410)
                if a == "read" and m == "POST":
                    if not live:
                        self.ev(c, nid, "Tried to open a destroyed note", 1); return self.js({"error": "gone"}, 410)
                    b = self.body()
                    if n["pw"] and not secrets.compare_digest(pbk(str(b.get("password") or ""), n["salt"]), n["pw"]):
                        f = n["fails"] + 1
                        if f >= 5:
                            c.execute("UPDATE notes SET ct=NULL,state='Destroyed',fails=? WHERE id=?", (f, nid))
                            self.ev(c, nid, "Wrong password 5 times, note destroyed", 1)
                            return self.js({"error": "Too many wrong passwords, the note has been destroyed", "gone": True}, 410)
                        c.execute("UPDATE notes SET fails=? WHERE id=?", (f, nid)); self.ev(c, nid, "Wrong password", 1)
                        return self.js({"error": "Wrong password"}, 401)
                    vk = secrets.token_hex(16)
                    cur = c.execute("UPDATE notes SET ct=NULL,state='Read',read_at=?,rip=?,rua=?,vkey=? WHERE id=? AND state='Unread'",
                                    (now(), self.ip(), self.ua(), vk, nid))
                    if cur.rowcount == 0: return self.js({"error": "gone"}, 410)
                    self.ev(c, nid, "Read, note destroyed")
                    return self.js({"data": n["ct"], "key": vk, "ip": self.ip()})
            # ----- admin (localhost only) -----
            if p.startswith("/api/admin/"):
                if not self.is_local(): return self.js({"error": "Localhost access only"}, 403)
                if p == "/api/admin/notes" and m == "GET":
                    rows = c.execute("""SELECT id,state,created,expires,size,cip,cua,read_at,rip,rua,fails,
                        (SELECT COUNT(*) FROM events e WHERE e.note_id=notes.id AND e.ev LIKE 'Page opened%') AS views
                        FROM notes ORDER BY created DESC LIMIT 300""").fetchall()
                    return self.js({"notes": [dict(r) for r in rows]})
                if p == "/api/admin/cleanup" and m == "POST":
                    c.execute("DELETE FROM events WHERE note_id IN (SELECT id FROM notes WHERE state!='Unread')")
                    c.execute("DELETE FROM notes WHERE state!='Unread'"); return self.js({"ok": True})
                mm = re.fullmatch(r"/api/admin/notes/([a-f0-9]+)(/events)?", p)
                if mm and mm.group(2) and m == "GET":
                    rows = c.execute("SELECT ts,ip,ua,ev,warn FROM events WHERE note_id=? ORDER BY id DESC LIMIT 200", (mm.group(1),)).fetchall()
                    return self.js({"events": [dict(r) for r in rows]})
                if mm and not mm.group(2) and m == "DELETE":
                    c.execute("DELETE FROM events WHERE note_id=?", (mm.group(1),)); c.execute("DELETE FROM notes WHERE id=?", (mm.group(1),))
                    return self.js({"ok": True})
            return self.js({"error": "not_found"}, 404)
        finally:
            c.commit(); c.close()

if __name__ == "__main__":
    init()
    print("SecureNote is running:")
    print("  Create notes : http://localhost:%d/" % PORT)
    print("  Admin page   : http://localhost:%d/admin   (this machine only)" % PORT)
    print("Press Ctrl+C to stop.")
    ThreadingHTTPServer((HOST, PORT), H).serve_forever()
