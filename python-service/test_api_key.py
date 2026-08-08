import asyncio
import os
async def main():
    from dotenv import load_dotenv
    from llama_index.embeddings.gemini import GeminiEmbedding

    load_dotenv()
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        raise RuntimeError("GOOGLE_API_KEY is required for this explicit live check.")
    
    try:
        # Khởi tạo y hệt trong hệ thống
        embed_model = GeminiEmbedding(
            model_name="models/embedding-001",
            api_key=api_key
        )
        print("Khởi tạo model thành công, đang thử tạo embedding...")
        
        # Test lấy embedding
        result = await embed_model.aget_text_embedding("Xin chào Việt Nam")
        print(f"✅ THÀNH CÔNG! Độ dài vector: {len(result)}")
        
    except Exception as error:
        print(f"❌ LỖI: error_type={type(error).__name__}")
        raise

if __name__ == "__main__":
    if os.environ.get("RAG_MANUAL_LIVE_CONFIRM") != "true":
        raise SystemExit("Refusing provider call without RAG_MANUAL_LIVE_CONFIRM=true.")
    asyncio.run(main())
