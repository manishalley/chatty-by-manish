# backend/app.py
import os
import json
import time
from flask import Flask, request, jsonify, send_file
from dotenv import load_dotenv
import requests
from datetime import datetime, timedelta

load_dotenv()
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
DEFAULT_GROQ_MODEL = os.getenv("GROQ_MODEL", "openai/gpt-oss-20b")
APP_TOKEN = os.getenv("APP_TOKEN", "")  # simple auth token you should set

HF_URL = "https://api.groq.com/openai/v1/chat/completions"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.abspath(os.path.join(BASE_DIR, "..", "frontend"))
CONV_PATH = os.path.abspath(os.path.join(BASE_DIR, "conversation.json"))

app = Flask(__name__, static_folder=FRONTEND_DIR, static_url_path="/")

# in-memory rate limit store: {ip: {"count":int, "reset":timestamp}}
RATE_LIMIT = {}
RATE_LIMIT_MAX = int(os.getenv("RATE_LIMIT_MAX", "30"))   # requests
RATE_LIMIT_WINDOW = int(os.getenv("RATE_LIMIT_WINDOW", "60"))  # seconds

# in-memory conversation for current session (will also be saved to file)
conversation_history = [
    {"role": "system", "content": "You are a helpful assistant."}
]

def save_conversation_to_file():
    try:
        existing = []
        if os.path.isfile(CONV_PATH):
            with open(CONV_PATH, "r", encoding="utf-8") as f:
                try:
                    existing = json.load(f)
                except Exception:
                    existing = []
        existing.append({
            "timestamp": datetime.utcnow().isoformat() + "Z",
            "conversation": conversation_history
        })
        with open(CONV_PATH, "w", encoding="utf-8") as f:
            json.dump(existing, f, ensure_ascii=False, indent=2)
    except Exception as e:
        print("Warning: could not save conversation:", e)

def check_rate_limit(client_ip):
    now = time.time()
    rec = RATE_LIMIT.get(client_ip)
    if rec:
        if now > rec["reset"]:
            # window expired — reset
            RATE_LIMIT[client_ip] = {"count": 1, "reset": now + RATE_LIMIT_WINDOW}
            return True, 1
        else:
            if rec["count"] >= RATE_LIMIT_MAX:
                return False, rec["reset"] - now
            else:
                rec["count"] += 1
                return True, RATE_LIMIT_MAX - rec["count"]
    else:
        RATE_LIMIT[client_ip] = {"count": 1, "reset": now + RATE_LIMIT_WINDOW}
        return True, RATE_LIMIT_MAX - 1

def call_groq_chat(messages, model=DEFAULT_GROQ_MODEL, max_tokens=400, temp=0.7):
    if not GROQ_API_KEY:
        return "[No GROQ_API_KEY set in backend/.env]"

    headers = {"Authorization": f"Bearer {GROQ_API_KEY}", "Content-Type": "application/json"}
    payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temp}
    try:
        r = requests.post(HF_URL, headers=headers, json=payload, timeout=60)
    except requests.exceptions.RequestException as e:
        return f"[Network error contacting Groq: {e}]"

    if r.status_code != 200:
        try:
            body = r.json()
        except Exception:
            body = r.text
        return f"[Groq Error {r.status_code}: {body}]"

    data = r.json()
    try:
        return data["choices"][0]["message"]["content"]
    except Exception:
        return f"[Unexpected Groq response shape: {data}]"

@app.route("/chat", methods=["POST"])
def chat():
    client_ip = request.remote_addr or "unknown"
    allowed, info = check_rate_limit(client_ip)
    if not allowed:
        return jsonify({"reply": f"[Rate limit exceeded — try again in {int(info)}s]"}), 429

    # Simple auth: client must send X-APP-TOKEN header that matches APP_TOKEN (if set)
    client_token = request.headers.get("X-APP-TOKEN", "")
    if APP_TOKEN:
        if not client_token or client_token != APP_TOKEN:
            return jsonify({"reply": "[Unauthorized — missing or invalid app token]"}), 401

    body = request.get_json(force=True)
    user_msg = (body.get("message") or "").strip()
    if not user_msg:
        return jsonify({"reply": "Please type a message."})

    # optional overrides from client
    model = body.get("model") or DEFAULT_GROQ_MODEL
    persona = body.get("persona")  # if present, set/replace system message
    if persona:
        # replace system role in conversation_history
        if conversation_history and conversation_history[0].get("role") == "system":
            conversation_history[0]["content"] = persona
        else:
            conversation_history.insert(0, {"role":"system","content": persona})

    # append user
    conversation_history.append({"role":"user","content": user_msg})

    # call Groq (blocking). We will simulate streaming on frontend.
    reply = call_groq_chat(conversation_history, model=model, max_tokens=400, temp=0.6)

    # append assistant reply and save
    conversation_history.append({"role":"assistant","content": reply})
    save_conversation_to_file()

    return jsonify({
        "reply": reply,
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "model": model
    })

@app.route("/conversation.json", methods=["GET"])
def get_conversation_file():
    # serve the saved conversation file if it exists
    if os.path.isfile(CONV_PATH):
        return send_file(CONV_PATH, mimetype="application/json", as_attachment=True, download_name="conversation.json")
    return jsonify({"error":"No conversation file found."}), 404

@app.route("/")
def index():
    return app.send_static_file("index.html")

if __name__ == "__main__":
    print("Using Groq model (default):", DEFAULT_GROQ_MODEL)
    print("Frontend path:", FRONTEND_DIR)
    print("Conversation file:", CONV_PATH)
    app.run(host="127.0.0.1", port=5000, debug=True)
