// ==========================================
// CẤU HÌNH KẾT NỐI AI VÀ GOOGLE SHEETS
// ==========================================
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbycJi3rk9OBLRQt79jYZb-VCawHB1NeIOlIUD-3E6fjPrY_2WvDXNP50ZikYidHAoUNyw/exec";
const KV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSrXGUBLFQJJy2lIJ_O1u_8iHupsFVt8BPYmLzgAMPI0E3hecCanmaUJ831RvgF-A/pub?gid=1073726209&single=true&output=csv";

// ==========================================
// ĐĂNG NHẬP GOOGLE (XÁC THỰC TÀI KHOẢN NHẬP LIỆU)
// ==========================================
const GOOGLE_CLIENT_ID = "311965248456-01ts8h9g6tuj0slob58n8vrfm091c4u7.apps.googleusercontent.com";

// ==========================================
// BỘ TỪ ĐIỂN XÉT TUYỂN
// ==========================================
const DICT_KHU_VUC = { "KV 01": 0.75, "KV 02-NT": 0.5, "KV 02": 0.25, "KV 03": 0 };
const DICT_DOI_TUONG = { "Không ưu tiên": 0, "ĐT 01": 2, "ĐT 02": 2, "ĐT 03": 2, "ĐT 04": 2, "ĐT 05": 1, "ĐT 06": 1, "ĐT 07": 1 };

const DICT_TO_HOP = {
    "A00": ["diem_toan", "diem_vatli", "diem_hoahoc"], "A01": ["diem_toan", "diem_vatli", "diem_tienganh"],
    "A02": ["diem_toan", "diem_vatli", "diem_sinhhoc"], "C00": ["diem_nguvan", "diem_lichsu", "diem_dialy"],
    "C01": ["diem_nguvan", "diem_toan", "diem_vatli"], "C02": ["diem_nguvan", "diem_toan", "diem_hoahoc"],
    "C03": ["diem_nguvan", "diem_toan", "diem_lichsu"], "C04": ["diem_nguvan", "diem_toan", "diem_dialy"],
    "D01": ["diem_toan", "diem_nguvan", "diem_tienganh"], "D04": ["diem_nguvan", "diem_toan", "diem_tiengtrung"],
    "D09": ["diem_toan", "diem_lichsu", "diem_tienganh"], "D10": ["diem_toan", "diem_dialy", "diem_tienganh"],
    "D14": ["diem_nguvan", "diem_lichsu", "diem_tienganh"], "D15": ["diem_nguvan", "diem_dialy", "diem_tienganh"],
    "D45": ["diem_nguvan", "diem_dialy", "diem_tiengtrung"], "D65": ["diem_nguvan", "diem_lichsu", "diem_tiengtrung"],
    "X01": ["diem_nguvan", "diem_toan", "diem_gdktpl"], "X02": ["diem_toan", "diem_nguvan", "diem_tinhoc"],
    "X06": ["diem_toan", "diem_vatli", "diem_tinhoc"], "X10": ["diem_toan", "diem_hoahoc", "diem_tinhoc"],
    "X25": ["diem_toan", "diem_tienganh", "diem_gdktpl"], "X26": ["diem_toan", "diem_tienganh", "diem_tinhoc"],
    "X37": ["diem_toan", "diem_gdktpl", "diem_tiengtrung"]
};

const DICT_NGANH = {
    "CNTT - ĐHKTS": ["A00", "A01", "A02", "C01", "C02", "D01", "X02", "X06", "X10", "X26"],
    "Quản trị kinh doanh": ["A00", "A01", "D01", "D09", "D10", "D45", "D65", "X01", "X25", "X37"],
    "Ngôn ngữ Anh": ["A01", "C03", "C04", "D01", "D09", "D10", "D14", "D15", "X25", "X26"],
    "Ngôn ngữ Trung Quốc": ["A01", "C00", "C03", "C04", "D01", "D04", "D45", "D65", "X01", "X37"],
    "Quản trị dịch vụ du lịch và lữ hành": ["A01", "C00", "C03", "C04", "D01", "D04", "D45", "D65", "X25", "X37"]
};

// ĐÃ CẬP NHẬT: RÚT PHIẾU ĐK KHỎI CHUNG, CHO VÀO TIÊN QUYẾT CỦA MỌI ĐỐI TƯỢNG
const DICT_HO_SO = {
    // ĐÃ BỎ "doc_khaisinh" (Bản sao Giấy khai sinh) khỏi danh sách "chung": checkbox này không còn tồn tại
    // trong index.html (form chỉ còn 4 ô: doc_phieu_dk, doc_syll, doc_cccd, doc_anhthe). Trước đây để sót
    // entry này khiến document.getElementById('doc_khaisinh') trả về null -> autoCheckAdmission() ném lỗi
    // TypeError ngay giữa chừng -> traffic-light-box bị kẹt mãi ở chữ "Analyzing..." mặc định.
    // LƯU Ý: "name" ở đây PHẢI khớp CHÍNH XÁC (kể cả hoa/thường) với chuỗi mà app_fixed_final.js
    // dùng làm key lưu/đọc trong dataList (row[doc.name.toUpperCase()]) và khi tick/gỡ tick checkbox
    // (row[key] === "TRUE"). Đổi "name" ở đây sẽ tự động đổi theo ở MỌI nơi hiển thị (live box, bảng
    // danh sách, modal chi tiết) vì tất cả giờ đều tra cứu qua DICT_HO_SO — không cần sửa gì trong
    // app_fixed_final.js nữa. Nhưng KHÔNG được đổi tuỳ tiện: nếu đổi "name" của 1 mục đã có dữ liệu
    // cũ lưu trên Google Sheet (cột tương ứng đặt theo tên CŨ), dữ liệu cũ sẽ không còn khớp được nữa.
    // "short": nhãn NGẮN dùng làm tiêu đề cột (<th>) trong bảng danh sách rút gọn — vì bảng đó hẹp,
    // không đủ chỗ cho tên đầy đủ. Tuỳ chọn: nếu bỏ trống, cột sẽ tự lấy "name" đầy đủ làm tiêu đề.
    // "order": số thứ tự cột hiển thị trong bảng danh sách + modal chi tiết (số nhỏ hiện trước). Cùng
    // 1 doc.id thì phải ghi CÙNG 1 số "order" ở mọi chỗ xuất hiện (doc đó có thể là tiên quyết của
    // nhiều đối tượng). Không bắt buộc phải liền mạch 1,2,3... — chỉ cần đúng thứ tự tương đối.
    // Đây là NGUỒN DUY NHẤT cho tiêu đề cột + thứ tự cột hồ sơ — index.html không còn khai báo tay
    // <th> nào cho các cột hồ sơ nữa, JS tự sinh khi tải trang (renderHoSoTableHeaders() trong
    // app_fixed_final.js), và renderTable() cũng tự sinh ô ✔/✘ theo đúng thứ tự này.
    chung: [
        { id: "doc_syll", name: "Sơ yếu lý lịch", short: "SƠ YẾU LÝ LỊCH", order: 2 },
        { id: "doc_cccd", name: "Bản sao ID", short: "BẢN SAO CCCD", order: 3 }, // ĐÃ SỬA: "name" khớp đúng key "BẢN SAO ID" đang dùng trong app_fixed_final.js (trước đây ghi "Bản sao CCCD" -> tra cứu sai). "short" giữ nguyên chữ cũ trên cột/nhãn cho quen mắt người dùng.
        { id: "doc_anhthe", name: "Ảnh thẻ", short: "ẢNH THẺ", order: 4 }
    ],
    tien_quyet: {
        "Tốt nghiệp THPT": [ { id: "doc_phieu_dk", name: "Phiếu đăng ký dự tuyển", short: "PHIẾU ĐĂNG KÝ", order: 1 }, { id: "doc_bang_thpt", name: "Bản sao Bằng THPT/Giấy báo điểm", short: "BẰNG THPT", order: 5 }, { id: "doc_hocba_thpt", name: "Bản sao Học bạ THPT", short: "HỌC BẠ THPT", order: 6 } ],
        "Tốt nghiệp Trung cấp sau 2022": [ { id: "doc_phieu_dk", name: "Phiếu đăng ký dự tuyển", short: "PHIẾU ĐĂNG KÝ", order: 1 }, { id: "doc_bang_tc", name: "Bản sao Bằng Trung cấp", short: "BẰNG TC", order: 7 }, { id: "doc_diem_tc", name: "Bảng điểm Trung cấp", short: "ĐIỂM TC", order: 8 }, { id: "doc_ktvh_thpt", name: "Bằng THPT/GCN đủ KL KTVH THPT", short: "GCN KTVH", order: 9 } ],
        "Tốt nghiệp Cao đẳng": [ { id: "doc_phieu_dk", name: "Phiếu đăng ký dự tuyển", short: "PHIẾU ĐĂNG KÝ", order: 1 }, { id: "doc_bang_cd", name: "Bằng Cao đẳng", short: "BẰNG CĐ", order: 13 }, { id: "doc_diem_cd", name: "Bảng điểm Cao đẳng", short: "ĐIỂM CĐ", order: 14 } ],
        "Tốt nghiệp Đại học": [ { id: "doc_phieu_dk", name: "Phiếu đăng ký dự tuyển", short: "PHIẾU ĐĂNG KÝ", order: 1 }, { id: "doc_bang_dh", name: "Bằng Đại học", short: "BẰNG ĐH", order: 15 }, { id: "doc_diem_dh", name: "Bảng điểm Đại học", short: "ĐIỂM ĐH", order: 16 } ],
        // ĐÃ SỬA: "Bản sao Bằng TC trước 2022" / "Bảng điểm TC trước 2022" -> đổi "TC" thành "Trung cấp"
        // đầy đủ, khớp đúng key "BẢN SAO BẰNG TRUNG CẤP TRƯỚC 2022" / "BẢNG ĐIỂM TRUNG CẤP TRƯỚC 2022"
        // đang dùng trong app_fixed_final.js (trước đây viết tắt "TC" -> tra cứu sai, checklist trong
        // modal/bảng danh sách luôn hiện trống hoặc báo thiếu oan cho 2 mục này).
        "Tốt nghiệp Trung cấp trước 2022": [ { id: "doc_phieu_dk", name: "Phiếu đăng ký dự tuyển", short: "PHIẾU ĐĂNG KÝ", order: 1 }, { id: "doc_gcn_gdpt", name: "GCN hoàn thành CT GDPT", short: "GCN GDPT", order: 12 }, { id: "doc_bang_tc_truoc", name: "Bản sao Bằng Trung cấp trước 2022", short: "BẰNG TC (<2022)", order: 10 }, { id: "doc_diem_tc_truoc", name: "Bảng điểm Trung cấp trước 2022", short: "ĐIỂM TC (<2022)", order: 11 } ],
        // ĐÃ SỬA LỖI CHÍNH TẢ: "short" của doc_diem_tc_truoc ở nhóm này trước đây viết sai hoa/thường
        // ("ĐIểm TC (<2022)") trong khi cùng đúng "id" này ở nhóm "Tốt nghiệp Trung cấp trước 2022" phía
        // trên lại viết đúng ("ĐIỂM TC (<2022)") -> đã đồng bộ lại cho khớp 100% (dù logic dedupe theo id
        // trong ALL_HO_SO_DOCS đã tự lấy giá trị xuất hiện trước nên không gây lỗi hiển thị thực tế, nhưng
        // để sai chính tả tồn tại trong code dễ gây nhầm lẫn khi đọc/sửa sau này).
        "Trung học nghề": [ { id: "doc_phieu_dk", name: "Phiếu đăng ký dự tuyển", short: "PHIẾU ĐĂNG KÝ", order: 1 }, { id: "doc_gcn_gdpt", name: "GCN hoàn thành CT GDPT", short: "GCN GDPT", order: 12 }, { id: "doc_bang_tc_truoc", name: "Bản sao Bằng Trung cấp trước 2022", short: "BẰNG TC (<2022)", order: 10 }, { id: "doc_diem_tc_truoc", name: "Bảng điểm Trung cấp trước 2022", short: "ĐIỂM TC (<2022)", order: 11 } ]
    }
};
