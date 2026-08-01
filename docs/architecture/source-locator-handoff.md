# Source locator handoff — OPTIONAL/LATER (PROPOSED)

## Trạng thái và mục tiêu

`sourceLocator` chưa phải contract đã chốt và không thuộc CURRENT/MVP. Mục tiêu đề xuất là định vị chính xác vùng citation trên trang PDF/tài liệu. CURRENT fallback vẫn là `pageNumber` (khi đáng tin cậy) kết hợp `sourceText`; giá trị `sourceLocator: null` không chứng minh capability highlight đã hoàn thành.

Luồng dự kiến, chỉ triển khai sau khi contract được duyệt:

```text
Python parser/geometry
→ verified fixtures
→ versioned Python–Node contract
→ Qdrant payload
→ Node citation snapshot
→ OpenAPI
→ FE highlighting
```

## Quyết định còn mở

- Một `box` hay `boxes[]`; citation nhiều dòng/nhiều vùng biểu diễn thế nào.
- Pixel, PDF point hay tọa độ normalized; origin top-left hay bottom-left.
- Shape `x`, `y`, `width`, `height`, kiểu số và phạm vi hợp lệ.
- Page 0-based hay 1-based; khuyến nghị đồng bộ public `pageNumber` 1-based nhưng đây vẫn là proposal.
- Page rotation; CropBox so với MediaBox.
- Geometry từ native text so với OCR và provenance tương ứng.
- `locatorVersion` để Node/Python/FE từ chối shape không tương thích.
- Fallback khi parser không có geometry: locator null, giữ page/source text, không ước lượng box.

## Fixtures và acceptance trước implementation

- Native-text PDF có geometry đã xác minh bằng render overlay.
- Citation nhiều dòng/multiple boxes.
- Trang xoay và khác biệt CropBox/MediaBox.
- OCR fallback có page/provenance rõ ràng.
- Citation hợp lệ nhưng không có locator.
- Visual geometry verification cùng unit/contract fixtures cho unit, origin, page convention và version.

Chỉ sau khi các fixture trên PASS mới version contract Python–Node, lưu payload/snapshot và công khai OpenAPI. Không thêm `char_coords`, bounding box ước lượng, MySQL field hoặc FE highlight riêng lẻ trước bước đó.
