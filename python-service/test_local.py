import asyncio
import os
import sys
sys.stdout.reconfigure(encoding='utf-8')

# Thêm đường dẫn hiện tại vào sys.path để import từ services
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

async def main():
    from dotenv import load_dotenv
    from llama_index.core.schema import Document
    from llama_index.core.node_parser import MarkdownNodeParser, SentenceSplitter
    from services.parser import parse_document

    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))
    file_path = r"..\file ảnh scan.pdf"
    if not os.path.exists(file_path):
        print(f"File {file_path} không tồn tại.")
        return

    print(f"--- BẮT ĐẦU PARSE FILE: {file_path} ---")
    
    # 1. Parse Document
    pages = await parse_document(file_path)
    print(f"-> Đã parse thành công {len(pages)} pages.")
    if not pages:
        return

    print("\n--- BẮT ĐẦU CHUNKING ---")
    documents = [Document(text=p["text"]) for p in pages]
    
    # 2. Markdown Node Parser
    markdown_parser = MarkdownNodeParser()
    md_nodes = markdown_parser.get_nodes_from_documents(documents)
    print(f"-> MarkdownNodeParser tạo ra {len(md_nodes)} chunks")
    
    # 3. Sentence Splitter
    splitter = SentenceSplitter(chunk_size=500, chunk_overlap=50)
    final_nodes = splitter.get_nodes_from_documents(md_nodes)
    print(f"-> SentenceSplitter tạo ra {len(final_nodes)} chunks cuối cùng")

    print("\n--- KẾT QUẢ CHUNK (3 chunk đầu) ---")
    for i, node in enumerate(final_nodes[:3]):
        print(f"\n[Chunk {i+1}]")
        print(f"- Metadata được trích xuất: {node.metadata}")
        print(f"- Text Content:\n{node.get_content()[:200]}...")

if __name__ == "__main__":
    if os.environ.get("RAG_MANUAL_LIVE_CONFIRM") != "true":
        raise SystemExit("Refusing manual parser run without RAG_MANUAL_LIVE_CONFIRM=true.")
    asyncio.run(main())
