import os, json, requests
from dotenv import load_dotenv
load_dotenv()
key = os.getenv("HUGGINGFACE_API_KEY")
model = os.getenv("HF_MODEL","mistralai/Mixtral-8x7B-Instruct-v0.1")
url = "https://router.huggingface.co/v1/generate"
headers = {"Authorization": f"Bearer {key}", "Content-Type":"application/json"}
payload = {"model": model, "inputs": "User: Hello\nAssistant:", "parameters": {"max_new_tokens": 32}, "options":{"wait_for_model":True}}
r = requests.post(url, headers=headers, json=payload, timeout=60)
print("STATUS:", r.status_code)
try:
    print(json.dumps(r.json(), indent=2, ensure_ascii=False))
except:
    print("BODY:", r.text)
