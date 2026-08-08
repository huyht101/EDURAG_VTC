import os
from dotenv import load_dotenv
load_dotenv()
# pyrefly: ignore [missing-import]
import google.generativeai as genai

def main():
    api_key = os.getenv("GOOGLE_API_KEY")
    genai.configure(api_key=api_key)
    print("Danh sách các model LLM khả dụng cho API Key của bạn:")
    try:
        models = genai.list_models()
        for m in models:
            if 'generateContent' in m.supported_generation_methods:
                print(f" - {m.name}")
    except Exception as error:
        print(f"Lỗi: error_type={type(error).__name__}")

if __name__ == "__main__":
    if os.environ.get("RAG_MANUAL_LIVE_CONFIRM") != "true":
        raise SystemExit("Refusing provider call without RAG_MANUAL_LIVE_CONFIRM=true.")
    main()
