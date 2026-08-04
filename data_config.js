// ==========================================
// CẤU HÌNH KẾT NỐI AI VÀ GOOGLE SHEETS
// ==========================================
const WEB_APP_URL = "https://script.google.com/macros/s/AKfycbxzIuSm2Gn1tYzEv0A1GXLF72QLQl2ZbGjk1NcGymGLrE1vd5Hhf1vuF-5EqHlgU3k/exec";
const KV_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSrXGUBLFQJJy2lIJ_O1u_8iHupsFVt8BPYmLzgAMPI0E3hecCanmaUJ831RvgF-A/pub?gid=1073726209&single=true&output=csv";

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

const DICT_HO_SO = {
    chung: [
        { id: "doc_phieu_dk", name: "Phiếu đăng ký dự tuyển" }, { id: "doc_syll", name: "Sơ yếu lý lịch" },
        { id: "doc_cccd", name: "Bản sao CCCD" }, { id: "doc_khaisinh", name: "Bản sao Giấy khai sinh" },
        { id: "doc_anhthe", name: "Ảnh thẻ" }
    ],
    tien_quyet: {
        "Tốt nghiệp THPT": [ { id: "doc_bang_thpt", name: "Bản sao Bằng THPT/Giấy báo điểm" }, { id: "doc_hocba_thpt", name: "Bản sao Học bạ THPT" } ],
        "Tốt nghiệp Trung cấp sau 2022": [ { id: "doc_bang_tc", name: "Bản sao Bằng Trung cấp" }, { id: "doc_diem_tc", name: "Bảng điểm Trung cấp" }, { id: "doc_ktvh_thpt", name: "Bằng THPT/GCN đủ KL KTVH THPT" } ],
        "Tốt nghiệp Cao đẳng": [ { id: "doc_bang_cd", name: "Bằng Cao đẳng" }, { id: "doc_diem_cd", name: "Bảng điểm Cao đẳng" } ],
        "Tốt nghiệp Đại học": [ { id: "doc_bang_dh", name: "Bằng Đại học" }, { id: "doc_diem_dh", name: "Bảng điểm Đại học" } ],
        "Tốt nghiệp Trung cấp trước 2022": [ { id: "doc_gcn_gdpt", name: "GCN hoàn thành CT GDPT" }, { id: "doc_bang_tc_truoc", name: "Bản sao Bằng TC trước 2022" }, { id: "doc_diem_tc_truoc", name: "Bảng điểm TC trước 2022" } ],
        "Trung học nghề": [ { id: "doc_gcn_gdpt", name: "GCN hoàn thành CT GDPT" }, { id: "doc_bang_tc_truoc", name: "Bản sao Bằng TC trước 2022" }, { id: "doc_diem_tc_truoc", name: "Bảng điểm TC trước 2022" } ]
    }
};
